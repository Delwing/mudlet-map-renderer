import {describe, it, expect, vi} from 'vitest';
import {MapState} from '../src/MapState';
import {ScenePipeline} from '../src/ScenePipeline';
import {MapRenderer, type InteractiveBackend} from '../src/rendering/MapRenderer';
import {OffscreenCanvasBackend, type WorkerTransport} from '../src/rendering/offscreen/OffscreenCanvasBackend';
import type {MainToWorkerMessage, SceneMessage} from '../src/rendering/offscreen/protocol';
import {createSettings} from '../src/types/Settings';
import type {Style} from '../src/style/Style';
import {createTestMapReader} from './helpers';

function fakeTransport(): {transport: WorkerTransport; messages: MainToWorkerMessage[]} {
    const messages: MainToWorkerMessage[] = [];
    return {
        transport: {postMessage: (m) => messages.push(m)},
        messages,
    };
}

function last<T extends MainToWorkerMessage['type']>(
    messages: MainToWorkerMessage[],
    type: T,
): Extract<MainToWorkerMessage, {type: T}> | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].type === type) return messages[i] as Extract<MainToWorkerMessage, {type: T}>;
    }
    return undefined;
}

describe('OffscreenCanvasBackend (main thread)', () => {
    it('posts a scene + overlays + camera when an area is drawn', () => {
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport, messages} = fakeTransport();
        new OffscreenCanvasBackend(state, undefined, {transport});

        state.setArea(1, 0);

        const scene = last(messages, 'scene') as SceneMessage | undefined;
        expect(scene).toBeDefined();
        expect(scene!.link.shapes.length).toBeGreaterThan(0);
        expect(scene!.room.shapes.length).toBeGreaterThan(0);
        // bounds array is index-aligned with shapes.
        expect(scene!.link.bounds.length).toBe(scene!.link.shapes.length);
        expect(scene!.room.bounds.length).toBe(scene!.room.shapes.length);
        expect(scene!.transform.kind).toBe('identity');

        expect(last(messages, 'overlays')).toBeDefined();
        expect(last(messages, 'camera')).toBeDefined();
    });

    it('scene shape counts match a direct ScenePipeline build (identity style)', () => {
        const reader = createTestMapReader();
        const settings = createSettings();
        const state = new MapState(reader, settings);
        const {transport, messages} = fakeTransport();
        new OffscreenCanvasBackend(state, undefined, {transport});
        state.setArea(1, 0);

        const pipeline = new ScenePipeline(reader, settings);
        const area = reader.getArea(1)!;
        const result = pipeline.buildScene(area, area.getPlane(0)!, 0);

        const scene = last(messages, 'scene') as SceneMessage;
        expect(scene.link.shapes.length).toBe(result.sceneShapes.link.length);
        expect(scene.room.shapes.length).toBe(result.sceneShapes.room.length);
    });

    it('keeps drawn-geometry snapshots and hit-testing synchronous', () => {
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport} = fakeTransport();
        const backend = new OffscreenCanvasBackend(state, undefined, {transport});
        state.setArea(1, 0);

        expect(backend.getDrawnExits().length).toBeGreaterThan(0);
        expect(backend.coordinateTransform(5, 7)).toEqual({x: 5, y: 7});
    });

    it('serializes a warping style as an affine transform', () => {
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport, messages} = fakeTransport();
        const backend = new OffscreenCanvasBackend(state, undefined, {transport});
        state.setArea(1, 0);

        const iso: Style = {
            transform: (s) => s,
            worldToScene: (x, y) => ({x: x + y, y: y - x}),
            sceneToWorld: (x, y) => ({x: (x - y) / 2, y: (x + y) / 2}),
        };
        backend.setStyle(iso);

        const scene = last(messages, 'scene') as SceneMessage;
        expect(scene.transform.kind).toBe('affine');
    });

    it('exposes live-effect methods and no-ops safely without a container', () => {
        // The Konva overlay stage needs a DOM container (covered by the browser
        // E2E). Headless, addLiveEffect must not throw or attach.
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport} = fakeTransport();
        const backend = new OffscreenCanvasBackend(state, undefined, {transport});
        const effect = {attach: vi.fn(), updateViewport: vi.fn(), destroy: vi.fn()};
        backend.addLiveEffect('fx', effect);
        expect(effect.attach).not.toHaveBeenCalled();
        expect(() => backend.removeLiveEffect('fx')).not.toThrow();
    });

    it('MapRenderer routes live effects to the backend by capability', () => {
        const addLiveEffect = vi.fn();
        const removeLiveEffect = vi.fn();
        const fake = {addLiveEffect, removeLiveEffect} as unknown as InteractiveBackend;
        const renderer = new MapRenderer(createTestMapReader(), createSettings(), undefined, () => fake);
        const effect = {attach: vi.fn(), updateViewport: vi.fn(), destroy: vi.fn()};
        renderer.addLiveEffect('fx', effect);
        renderer.removeLiveEffect('fx');
        expect(addLiveEffect).toHaveBeenCalledWith('fx', effect);
        expect(removeLiveEffect).toHaveBeenCalledWith('fx');
    });

    it('exportCanvas returns undefined (worker owns the canvas)', () => {
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport} = fakeTransport();
        const backend = new OffscreenCanvasBackend(state, undefined, {transport});
        expect(backend.exportCanvas()).toBeUndefined();
    });

    it('re-posts overlays on highlight changes without rebuilding the scene', () => {
        const state = new MapState(createTestMapReader(), createSettings());
        const {transport, messages} = fakeTransport();
        new OffscreenCanvasBackend(state, undefined, {transport});
        state.setArea(1, 0);

        const sceneCountBefore = messages.filter(m => m.type === 'scene').length;
        const overlayCountBefore = messages.filter(m => m.type === 'overlays').length;

        state.addHighlight(1, '#ff0000');

        expect(messages.filter(m => m.type === 'overlays').length).toBeGreaterThan(overlayCountBefore);
        expect(messages.filter(m => m.type === 'scene').length).toBe(sceneCountBefore);
    });
});
