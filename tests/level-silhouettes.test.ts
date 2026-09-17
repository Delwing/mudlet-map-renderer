import {describe, it, expect} from "vitest";
import {ScenePipeline} from "../src/ScenePipeline";
import {createSettings} from "../src/types/Settings";
import type {Settings} from "../src/types/Settings";
import {clipSceneToViewport} from "../src/export/clipSceneToViewport";
import type {CircleShape, RectShape} from "../src/scene/Shape";
import {createTestMapReader} from "./helpers";
import {hexToRgba} from "../src/utils/color";

// Fixture area 1 ("Test Village") has 13 rooms on z=0, 1 on z=1, 2 on z=-1.
function build(z: number, configure: (s: Settings) => void = () => {}) {
    const reader = createTestMapReader();
    const settings = createSettings();
    configure(settings);
    const area = reader.getArea(1)!;
    const plane = area.getPlane(z)!;
    const result = new ScenePipeline(reader, settings).buildScene(area, plane, z);
    return {reader, settings, area, result};
}

const bodies = (refs: {shape: {type: string}}[]) =>
    refs.map(r => r.shape).filter((s): s is RectShape | CircleShape => s.type === "rect" || s.type === "circle");

describe("level silhouettes", () => {
    it("emits nothing by default", () => {
        const {result} = build(0);
        expect(result.silhouetteShapeRefs).toEqual([]);
    });

    it("draws the level below, shifted by the offset, with no hit info", () => {
        const {result, area} = build(0, s => {
            s.levelSilhouettes.below = true;
            s.levelSilhouettes.exits = false;
        });
        const below = area.getPlane(-1)!.getRooms();
        const shapes = bodies(result.silhouetteShapeRefs) as RectShape[];
        expect(shapes).toHaveLength(below.length);

        const {offsetX, offsetY} = createSettings().levelSilhouettes;
        const half = createSettings().roomSize / 2;
        for (const room of below) {
            expect(shapes.some(s =>
                Math.abs(s.x - (room.x + offsetX - half)) < 1e-9 &&
                Math.abs(s.y - (room.y + offsetY - half)) < 1e-9,
            )).toBe(true);
        }
        for (const s of shapes) {
            expect(s.hit).toBeUndefined();
            expect(s.layer).toBe("link");
            expect(s.paint.fill).toMatch(/^rgba\(.*0\.35\)$/);
        }
    });

    it("draws the level above shifted the opposite way, and paints under the current level", () => {
        const {result, area} = build(0, s => {
            s.levelSilhouettes.above = true;
        });
        const above = area.getPlane(1)!.getRooms();
        const shapes = bodies(result.silhouetteShapeRefs) as RectShape[];
        expect(shapes).toHaveLength(above.length);
        const half = createSettings().roomSize / 2;
        expect(shapes[0].x).toBeCloseTo(above[0].x - 0.2 - half);
        expect(shapes[0].y).toBeCloseTo(above[0].y - 0.2 - half);

        // First on the link layer: everything from the current level draws over it.
        const n = result.silhouetteShapeRefs.length;
        expect(result.sceneShapes.link.slice(0, n)).toEqual(result.silhouetteShapeRefs.map(r => r.shape));
    });

    it("respects depth and fades farther levels", () => {
        // From z=1, depth 2 reaches z=0 (k=1) and z=-1 (k=2).
        const {result, area} = build(1, s => {
            s.levelSilhouettes.below = true;
            s.levelSilhouettes.exits = false;
            s.levelSilhouettes.depth = 2;
        });
        const shapes = bodies(result.silhouetteShapeRefs);
        const near = area.getPlane(0)!.getRooms().length;
        const far = area.getPlane(-1)!.getRooms().length;
        expect(shapes).toHaveLength(near + far);
        // Farthest level first, at alpha * falloff.
        expect(shapes[0].paint.fill).toMatch(/0\.21\)$/);
        expect(shapes[shapes.length - 1].paint.fill).toMatch(/0\.35\)$/);
    });

    it("follows the room shape and draws exits between silhouette rooms", () => {
        const {result} = build(1, s => {
            s.levelSilhouettes.below = true;
            s.roomShape = "circle";
        });
        const shapes = result.silhouetteShapeRefs.map(r => r.shape);
        expect(shapes.filter(s => s.type === "rect")).toHaveLength(0);
        expect(shapes.filter(s => s.type === "circle").length).toBeGreaterThan(0);
        expect(shapes.filter(s => s.type === "line").length).toBeGreaterThan(0);
    });

    it("keeps each room's environment colour when useRoomColors is on", () => {
        const {result, area, reader, settings} = build(0, s => {
            s.levelSilhouettes.below = true;
            s.levelSilhouettes.useRoomColors = true;
        });
        const below = area.getPlane(-1)!.getRooms();
        const shapes = bodies(result.silhouetteShapeRefs) as RectShape[];
        expect(shapes).toHaveLength(below.length);
        const expected = below.map(r => hexToRgba(reader.getColorValue(r.env), 0.35)).sort();
        expect(shapes.map(s => s.paint.fill).sort()).toEqual(expected);
        for (const s of result.silhouetteShapeRefs.map(r => r.shape)) {
            if (s.type === "line") expect(s.paint.stroke).toBe(hexToRgba(settings.lineColor, 0.35));
        }
    });

    it("is culled with the rest of the scene", () => {
        const {result, settings} = build(0, s => {
            s.levelSilhouettes.below = true;
        });
        const clipped = clipSceneToViewport(result, {minX: 1e6, maxX: 1e6 + 1, minY: 1e6, maxY: 1e6 + 1}, settings);
        for (const ref of result.silhouetteShapeRefs) {
            expect(clipped.link).not.toContain(ref.shape);
        }
    });
});
