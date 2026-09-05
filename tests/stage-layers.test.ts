import {afterEach, describe, expect, it, vi} from 'vitest';
import {MapRenderer} from '../src/rendering/MapRenderer';
import {KonvaRenderBackend} from '../src/rendering/KonvaRenderBackend';
import {createSettings} from '../src/types/Settings';
import {Blueprint} from '../src/style';
import SkeletonMapReader from '../src/bigmap/SkeletonMapReader';
import {buildSkeleton} from '../src/bigmap/buildSkeleton';
import {createTestMapReader} from './helpers';
import testMap from './fixtures/test-map.json';
import testEnvs from './fixtures/test-envs.json';

/** Konva warns above this; see Stage.add / MAX_LAYERS_NUMBER in konva/lib/Stage.js. */
const KONVA_MAX_LAYERS = 5;

afterEach(() => vi.restoreAllMocks());

describe('stage layer budget', () => {
    it("stays within Konva's advisory layer count and warns about nothing", () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const renderer = new MapRenderer(createTestMapReader(), createSettings());
        const backend = renderer.backend as KonvaRenderBackend;
        renderer.drawArea(1, 0);

        // background, scene (link+room), position, overlay, topLabel.
        expect(backend.stage.getLayers().length).toBe(5);
        expect(backend.stage.getLayers().length).toBeLessThanOrEqual(KONVA_MAX_LAYERS);
        const layerWarnings = warn.mock.calls
            .map(args => String(args[0]))
            .filter(msg => msg.includes('Recommended maximum number of layers'));
        expect(layerWarnings).toEqual([]);
        renderer.destroy();
    });

    it('orders the background groups LOD-under-grid, below the scene', () => {
        const renderer = new MapRenderer(createTestMapReader(), createSettings());
        const backend = renderer.backend as KonvaRenderBackend;

        expect(backend.lodGroup.getParent()).toBe(backend.backgroundLayer);
        expect(backend.gridGroup.getParent()).toBe(backend.backgroundLayer);
        expect(backend.lodGroup.zIndex()).toBeLessThan(backend.gridGroup.zIndex());
        // Background under the scene, top labels above the overlay.
        expect(backend.backgroundLayer.zIndex()).toBeLessThan(backend.roomLayer.zIndex());
        expect(backend.topLabelLayer.zIndex()).toBeGreaterThan(backend.overlayLayer.zIndex());
        renderer.destroy();
    });
});

describe('shared background layer isolation', () => {
    /** Renderer whose plane exceeds the LOD budget, so the raster underlay paints. */
    function makeRasterRenderer() {
        const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
        const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
        const reader = new SkeletonMapReader(buildSkeleton(map, envs));
        const renderer = new MapRenderer(reader, {...createSettings(), lodEnabled: true, lodRoomBudget: 4});
        renderer.camera.setSize(800, 600);
        return renderer;
    }

    it('keeps the LOD image when the grid rebuilds and when the style changes', () => {
        const renderer = makeRasterRenderer();
        const backend = renderer.backend as KonvaRenderBackend;
        renderer.drawArea(1, 0);

        expect(backend.lodGroup.visible()).toBe(true);
        expect(backend.lodGroup.getChildren().length).toBe(1);

        // Grid rebuilds as the camera pans; it must not reach into the sibling
        // LOD group while doing so.
        renderer.camera.panToMapPoint(500, 500);
        expect(backend.lodGroup.getChildren().length).toBe(1);

        // setStyle re-creates the grid's RecordingLayerNode, whose constructor
        // calls destroyChildren() — scoped to the grid group, not the layer.
        renderer.setStyle(Blueprint);
        expect(backend.lodGroup.getChildren().length).toBe(1);
        renderer.destroy();
    });

    it('toggles only the LOD group when leaving raster mode, leaving the grid visible', async () => {
        const renderer = makeRasterRenderer();
        const backend = renderer.backend as KonvaRenderBackend;
        renderer.drawArea(1, 0);
        expect(backend.lodGroup.visible()).toBe(true);

        renderer.setZoom(10); // vector mode → LOD hidden
        // The mode flip rides a queueMicrotask-scheduled refresh.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(backend.lodGroup.visible()).toBe(false);
        expect(backend.gridGroup.visible()).toBe(true);
        expect(backend.backgroundLayer.visible()).toBe(true);
        renderer.destroy();
    });
});
