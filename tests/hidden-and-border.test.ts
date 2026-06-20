import {describe, expect, it} from "vitest";
import {computeRoomColors} from "../src/scene/RoomStyle";
import {layoutRoom} from "../src/scene/elements/RoomLayout";
import {
    isRoomHidden, getRoomBorderColor, getRoomBorderThickness,
} from "../src/scene/RoomFlags";
import {hiddenAwareLens} from "../src/lens/hiddenAwareLens";
import {ALL_VISIBLE} from "../src/lens/RoomLens";
import {createSettings} from "../src/types/Settings";
import type {IMapReader} from "../src/reader/MapReader";
import type {IExit} from "../src/reader/Exit";
import type {RectShape, CircleShape} from "../src/scene/Shape";

// Minimal reader: rooms in these tests carry no env colour of interest, so a
// fixed env colour keeps the assertions about overrides unambiguous.
const reader: IMapReader = {
    getArea: () => undefined as never,
    getAreas: () => [],
    getRooms: () => [],
    getRoom: () => undefined as never,
    getColorValue: () => "rgb(10, 20, 30)",
    getSymbolColor: () => "rgb(200, 200, 200)",
};

function makeRoom(userData: Record<string, string> = {}): MapData.Room {
    return {
        id: 1, area: 1, x: 0, y: 0, z: 0, areaId: "1",
        weight: 0, roomChar: "", name: "r", env: 1,
        userData, customLines: {}, stubs: [], hash: "h",
        exits: {} as never, doors: {}, specialExits: {},
    };
}

describe("RoomFlags", () => {
    it("reads the hidden flag from the Mudlet fallback userData key (case-insensitive)", () => {
        expect(isRoomHidden(makeRoom())).toBe(false);
        expect(isRoomHidden(makeRoom({"system.fallback_hidden": "true"}))).toBe(true);
        expect(isRoomHidden(makeRoom({"system.fallback_hidden": "TRUE"}))).toBe(true);
        expect(isRoomHidden(makeRoom({"system.fallback_hidden": "false"}))).toBe(false);
    });

    it("reads and clamps the border colour and thickness", () => {
        expect(getRoomBorderColor(makeRoom())).toBeUndefined();
        expect(getRoomBorderColor(makeRoom({"room.ui_borderColor": "#ff0000"}))).toBe("#ff0000");
        // Mudlet's Qt #AARRGGBB → CSS: opaque alpha dropped, else moved to the end.
        expect(getRoomBorderColor(makeRoom({"room.ui_borderColor": "#ff16c02a"}))).toBe("#16c02a");
        expect(getRoomBorderColor(makeRoom({"room.ui_borderColor": "#8016c02a"}))).toBe("#16c02a80");
        expect(getRoomBorderColor(makeRoom({"room.ui_borderColor": "red"}))).toBe("red");
        expect(getRoomBorderThickness(makeRoom({"room.ui_borderThickness": "3"}))).toBe(3);
        expect(getRoomBorderThickness(makeRoom({"room.ui_borderThickness": "99"}))).toBe(10);
        expect(getRoomBorderThickness(makeRoom({"room.ui_borderThickness": "0"}))).toBe(1);
        expect(getRoomBorderThickness(makeRoom({"room.ui_borderThickness": "x"}))).toBeUndefined();
    });
});

describe("computeRoomColors — per-room border override", () => {
    it("overrides the stroke colour with the room's border colour", () => {
        const settings = createSettings();
        const colors = computeRoomColors(
            makeRoom({"room.ui_borderColor": "#ff8800"}), reader, settings,
        );
        expect(colors.strokeColor).toBe("#ff8800");
    });

    it("scales border width by the room's border thickness", () => {
        const settings = createSettings();
        const colors = computeRoomColors(
            makeRoom({"room.ui_borderThickness": "4"}), reader, settings,
        );
        expect(colors.borderWidth).toBeCloseTo(settings.lineWidth * 4);
    });

    it("draws a per-room border even when global borders are off", () => {
        const settings = createSettings();
        settings.borders = false;
        const colors = computeRoomColors(
            makeRoom({"room.ui_borderColor": "red"}), reader, settings,
        );
        expect(colors.strokeColor).toBe("red");
        expect(colors.borderWidth).toBeGreaterThan(0);
    });
});

describe("layoutRoom — faded hidden rooms", () => {
    it("bakes opacity into the body fill and stroke when faded", () => {
        const settings = createSettings();
        const room = makeRoom();
        const normal = layoutRoom(room, reader, settings, {flatPipeline: true});
        const faded = layoutRoom(room, reader, settings, {flatPipeline: true, fade: 0.35});

        const body = (s: typeof normal) =>
            s.children.find(c => c.type === "rect" || c.type === "circle") as RectShape | CircleShape;

        const normalFill = body(normal).paint.fill as string;
        const fadedFill = body(faded).paint.fill as string;

        expect(normalFill).not.toContain("rgba");
        expect(fadedFill).toContain("rgba");
        expect(fadedFill).toContain("0.35");
    });
});

describe("layoutRoom — dashed hidden rooms", () => {
    it("draws a dashed border at full opacity (no fade)", () => {
        const settings = createSettings();
        const dashed = layoutRoom(makeRoom(), reader, settings, {flatPipeline: true, dashedBorder: true});

        const body = dashed.children.find(c => c.type === "rect" || c.type === "circle") as RectShape | CircleShape;
        expect(body.paint.fill as string).not.toContain("rgba"); // full opacity, no fade
        expect(body.paint.dash?.length ?? 0).toBeGreaterThan(0);
        expect(body.paint.strokeWidth ?? 0).toBeGreaterThan(0);
    });
});

describe("hiddenAwareLens", () => {
    const exit: IExit = {a: 1, b: 2, zIndex: [0]};
    const visibleRoom = makeRoom();
    const hiddenRoom = makeRoom({"system.fallback_hidden": "true"});

    it("returns the lens unchanged when not in hide mode", () => {
        expect(hiddenAwareLens(ALL_VISIBLE, false)).toBe(ALL_VISIBLE);
    });

    it("treats hidden rooms as not visible in hide mode", () => {
        const lens = hiddenAwareLens(ALL_VISIBLE, true);
        expect(lens.isVisible(visibleRoom)).toBe(true);
        expect(lens.isVisible(hiddenRoom)).toBe(false);
    });

    it("hides any exit touching a hidden room", () => {
        const lens = hiddenAwareLens(ALL_VISIBLE, true);
        expect(lens.getExitTreatment!(exit, visibleRoom, visibleRoom)).toBe("full");
        expect(lens.getExitTreatment!(exit, visibleRoom, hiddenRoom)).toBe("hidden");
        expect(lens.getExitTreatment!(exit, hiddenRoom, hiddenRoom)).toBe("hidden");
    });
});
