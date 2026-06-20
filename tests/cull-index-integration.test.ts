import {describe, it, expect} from "vitest";
import {SceneManager} from "../src/rendering/SceneManager";
import {Camera} from "../src/camera/Camera";
import {buildCullingVisibilityMap} from "../src/export/clipSceneToViewport";
import {createSettings} from "../src/types/Settings";
import {createTestMapReader} from "./helpers";
import type {Shape} from "../src/scene/Shape";

/**
 * Integration: prove the spatial-index cull (SceneManager.buildCullEntries +
 * CullIndex, driven through the camera viewport) returns exactly the shapes the
 * canonical predicate {@link buildCullingVisibilityMap} marks visible — on a
 * real scene built from the test fixture. This is the guard that the index's
 * entry bounds match the old linear-scan bounds.
 */
describe("SceneManager spatial-index cull — parity with the predicate", () => {
    function setup(areaId: number, z: number) {
        const reader = createTestMapReader();
        const settings = createSettings();
        const camera = new Camera(800, 600);
        const sm = new SceneManager(camera, settings, reader);
        const area = reader.getArea(areaId)!;
        const plane = area.getPlane(z)!;
        sm.rebuild(area, plane, z);
        return {settings, camera, sm, result: sm.lastResult!};
    }

    /** Shapes the predicate marks visible for the given camera viewport. */
    function predicateVisible(result: ReturnType<typeof setup>["result"], camera: Camera, settings: ReturnType<typeof createSettings>): Set<Shape> {
        const vp = camera.getCullingViewport(settings.cullingBounds);
        const map = buildCullingVisibilityMap(result, vp, settings);
        const out = new Set<Shape>();
        for (const [shape, vis] of map) if (vis) out.add(shape);
        return out;
    }

    function setsEqual(a: Set<Shape>, b: Set<Shape>): boolean {
        if (a.size !== b.size) return false;
        for (const x of a) if (!b.has(x)) return false;
        return true;
    }

    it("matches the predicate across zoom levels and pan positions", () => {
        const {settings, camera, sm, result} = setup(1, 0);

        const configs = [
            {zoom: 1, x: 0, y: 0},
            {zoom: 0.3, x: 0, y: 0},
            {zoom: 2, x: -100, y: -50},
            {zoom: 0.1, x: 200, y: 200},
            {zoom: 1.5, x: -300, y: 100},
            {zoom: 0.05, x: 0, y: 0}, // zoomed way out: everything visible
        ];

        for (const cfg of configs) {
            camera.zoom = cfg.zoom;
            camera.position = {x: cfg.x, y: cfg.y};
            const fromIndex = sm.cullInteractive();
            const fromPredicate = predicateVisible(result, camera, settings);
            expect(setsEqual(fromIndex, fromPredicate)).toBe(true);
        }
    });

    it("returns every managed shape when culling is disabled", () => {
        const {settings, camera, sm} = setup(1, 0);
        camera.zoom = 2;
        camera.position = {x: -500, y: -500}; // viewport far from content
        settings.cullingEnabled = false;
        const visible = sm.cullInteractive();
        expect(visible.size).toBe(sm.managedShapes().size);
        expect(visible.size).toBeGreaterThan(0);
    });

    it("hides content panned fully off-screen", () => {
        const {settings, camera, sm} = setup(1, 0);
        settings.cullingEnabled = true;
        camera.zoom = 1;
        // Pan so the world origin (where the fixture rooms cluster) is far
        // off the top-left of the viewport.
        camera.position = {x: -100000, y: -100000};
        expect(sm.cullInteractive().size).toBe(0);
    });
});
