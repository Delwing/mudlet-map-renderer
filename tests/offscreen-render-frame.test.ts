import {describe, it, expect} from 'vitest';
import {renderFrame, type FrameInput} from '../src/rendering/offscreen/renderFrame';
import {ScenePipeline} from '../src/ScenePipeline';
import {createSettings} from '../src/types/Settings';
import type {RectShape, ImageShape} from '../src/scene/Shape';
import {createTestMapReader} from './helpers';

interface RecordedCall {
    type: 'call' | 'set';
    name: string;
    args: unknown[];
}

/** Proxy-based recording 2D context — logs every method call and property set. */
function recordingCtx(): CanvasRenderingContext2D & {calls: RecordedCall[]} {
    const calls: RecordedCall[] = [];
    const proxy = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'calls') return calls;
            return (...args: unknown[]) => {
                calls.push({type: 'call', name: String(prop), args});
                return undefined;
            };
        },
        set(_t, prop, value) {
            calls.push({type: 'set', name: String(prop), args: [value]});
            return true;
        },
    });
    return proxy as unknown as CanvasRenderingContext2D & {calls: RecordedCall[]};
}

const camera = {scale: 1, offsetX: 0, offsetY: 0};
const bigViewport = {minX: -1000, maxX: 1000, minY: -1000, maxY: 1000};

function rect(): RectShape {
    return {type: 'rect', x: 0, y: 0, width: 1, height: 1, paint: {fill: '#ffffff'}, layer: 'room'};
}

describe('renderFrame', () => {
    it('fills the background before drawing anything', () => {
        const ctx = recordingCtx();
        const input: FrameInput = {
            scene: null,
            overlays: [],
            camera,
            viewport: bigViewport,
            settings: {...createSettings(), backgroundColor: '#123456'},
            width: 100,
            height: 80,
        };
        renderFrame(ctx, input);
        const firstSet = ctx.calls.find(c => c.type === 'set' && c.name === 'fillStyle');
        expect(firstSet?.args[0]).toBe('#123456');
        const fillRect = ctx.calls.find(c => c.type === 'call' && c.name === 'fillRect');
        expect(fillRect?.args).toEqual([0, 0, 100, 80]);
    });

    it('renders a real scene built from the test map', () => {
        const reader = createTestMapReader();
        const settings = createSettings();
        const pipeline = new ScenePipeline(reader, settings);
        const area = reader.getArea(1)!;
        const plane = area.getPlane(0)!;
        const result = pipeline.buildScene(area, plane, 0);

        const ctx = recordingCtx();
        renderFrame(ctx, {
            scene: {
                link: {shapes: result.sceneShapes.link, bounds: result.sceneShapes.link.map(() => null)},
                room: {shapes: result.sceneShapes.room, bounds: result.sceneShapes.room.map(() => null)},
                topLabel: result.sceneShapes.topLabel,
                transform: {kind: 'identity'},
            },
            overlays: [],
            camera,
            viewport: bigViewport,
            settings,
            width: 400,
            height: 300,
        });

        // Rooms render as rects (default roomShape) — there must be draw calls.
        const rectCalls = ctx.calls.filter(c => c.type === 'call' && c.name === 'rect').length;
        expect(rectCalls).toBeGreaterThan(0);
    });

    it('culls shapes outside the viewport when culling is enabled', () => {
        const inside = rect();
        const outside = rect();
        const scene = {
            link: {shapes: [] as RectShape[], bounds: [] as (null | {x: number; y: number; width: number; height: number})[]},
            room: {
                shapes: [inside, outside],
                bounds: [
                    {x: 0, y: 0, width: 1, height: 1},
                    {x: 500, y: 500, width: 1, height: 1},
                ],
            },
            topLabel: [],
            transform: {kind: 'identity' as const},
        };
        const viewport = {minX: -10, maxX: 10, minY: -10, maxY: 10};

        const culled = recordingCtx();
        renderFrame(culled, {scene, overlays: [], camera, viewport, settings: {...createSettings(), cullingEnabled: true}, width: 100, height: 100});
        const uncull = recordingCtx();
        renderFrame(uncull, {scene, overlays: [], camera, viewport, settings: {...createSettings(), cullingEnabled: false}, width: 100, height: 100});

        const rectCount = (c: ReturnType<typeof recordingCtx>) => c.calls.filter(x => x.type === 'call' && x.name === 'rect').length;
        expect(rectCount(culled)).toBe(1);
        expect(rectCount(uncull)).toBe(2);
    });

    it('draws image shapes when the factory resolves a source, skips them otherwise', () => {
        const img: ImageShape = {type: 'image', x: 0, y: 0, width: 2, height: 2, src: 'data:image/png;base64,AAAA', layer: 'room'};
        const scene = {
            link: {shapes: [] as ImageShape[], bounds: [] as (null | {x: number; y: number; width: number; height: number})[]},
            room: {shapes: [img], bounds: [null as null]},
            topLabel: [],
            transform: {kind: 'identity' as const},
        };
        const base = {scene, overlays: [], camera, viewport: bigViewport, settings: createSettings(), width: 50, height: 50};

        const resolved = recordingCtx();
        renderFrame(resolved, {...base, imageFactory: () => ({} as unknown as CanvasImageSource)});
        expect(resolved.calls.some(c => c.type === 'call' && c.name === 'drawImage')).toBe(true);

        const missing = recordingCtx();
        renderFrame(missing, {...base, imageFactory: () => null});
        expect(missing.calls.some(c => c.type === 'call' && c.name === 'drawImage')).toBe(false);
    });
});
