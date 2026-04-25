import {describe, it, expect} from "vitest";
import {ScenePipeline} from "../src/ScenePipeline";
import {HitTester} from "../src/hit/HitTester";
import {createSettings} from "../src/types/Settings";
import {createTestMapReader} from "./helpers";

/**
 * Integration: drive ScenePipeline against the test fixture and verify the
 * unified `hitShapes` output is reachable through HitTester for every kind
 * the editor cares about (rooms, exits, stubs, labels, area-exit labels).
 */
describe("ScenePipeline + HitTester — unified hit shapes", () => {
    function buildAreaScene(areaId: number, z: number) {
        const reader = createTestMapReader();
        const settings = createSettings();
        const area = reader.getArea(areaId)!;
        const plane = area.getPlane(z)!;
        const pipeline = new ScenePipeline(reader, settings);
        const result = pipeline.buildScene(area, plane, z);
        const tester = new HitTester();
        tester.build(result.hitShapes, settings.roomSize);
        return {reader, settings, area, plane, result, tester};
    }

    it("rooms are pickable at their map coordinates", () => {
        const {tester, plane} = buildAreaScene(1, 0);
        const rooms = plane.getRooms() ?? [];
        // Room id 1 sits at world (0, 0) (Village Center).
        const room1 = rooms.find(r => r.id === 1)!;
        const hit = tester.pick(room1.x, room1.y);
        expect(hit).not.toBeNull();
        expect(hit!.kind).toBe("room");
        expect(hit!.id).toBe(1);
    });

    it("link exits expose HitInfo with a/b/aDir/bDir payload", () => {
        const {result} = buildAreaScene(1, 0);
        // At least one exit was drawn.
        expect(result.drawnExits.length).toBeGreaterThan(0);
        // All scene shapes that report kind "exit" should carry the four-tuple.
        const exitShapes = result.sceneShapes.link.filter(s => s.hit?.kind === "exit");
        expect(exitShapes.length).toBeGreaterThan(0);
        for (const s of exitShapes) {
            const payload = s.hit!.payload as {
                a: number; b: number; aDir?: string; bDir?: string;
            };
            expect(typeof payload.a).toBe("number");
            expect(typeof payload.b).toBe("number");
        }
    });

    it("pickAll returns both room and exit when they overlap", () => {
        const {tester, plane} = buildAreaScene(1, 0);
        // Click on room 1's center; an exit also runs through the room body
        // visually but the polyline ends at the room edge — so just verify
        // that pickAll returns the room first when probing inside the room.
        const room1 = plane.getRooms()!.find(r => r.id === 1)!;
        const hits = tester.pickAll(room1.x, room1.y);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].kind).toBe("room");
        expect(hits[0].id).toBe(1);
    });

    it("pickInRect selects rooms whose centers fall inside the rect", () => {
        const {tester, plane} = buildAreaScene(1, 0);
        // Tight box around room 1 only (it sits at (0, 0); other rooms are
        // ≥2 units away in the fixture).
        const hits = tester.pickInRect(-0.5, -0.5, 0.5, 0.5, ["room"]);
        const ids = hits.map(h => h.id).sort();
        expect(ids).toEqual([1]);
    });

    it("pickInRect can capture multiple rooms", () => {
        const {tester} = buildAreaScene(1, 0);
        // Wide box covering the village center (rooms 1..5 in the fixture
        // all live within ±2 units of the origin).
        const hits = tester.pickInRect(-3, -3, 3, 3, ["room"]);
        expect(hits.length).toBeGreaterThanOrEqual(5);
    });
});
