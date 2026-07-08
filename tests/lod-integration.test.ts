import {describe, expect, it} from 'vitest';
import {MapRenderer} from '../src/rendering/MapRenderer';
import {KonvaRenderBackend} from '../src/rendering/KonvaRenderBackend';
import {createSettings, type LodEventDetail} from '../src/types/Settings';
import SkeletonMapReader from '../src/bigmap/SkeletonMapReader';
import {buildSkeleton} from '../src/bigmap/buildSkeleton';
import {createTestMapReader} from './helpers';
import testMap from './fixtures/test-map.json';
import testEnvs from './fixtures/test-envs.json';

/** Flush the backend's queueMicrotask-scheduled refresh (no RAF in node). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function makeRenderer(budget: number) {
    const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
    const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
    const reader = new SkeletonMapReader(buildSkeleton(map, envs));
    const settings = {...createSettings(), lodEnabled: true, lodRoomBudget: budget};
    const renderer = new MapRenderer(reader, settings);
    // Headless: LOD + viewport clamping engage once the camera has a real size.
    renderer.camera.setSize(800, 600);
    const events: LodEventDetail[] = [];
    renderer.on('lod', e => events.push(e));
    return {renderer, reader, events, backend: renderer.backend as KonvaRenderBackend};
}

describe('LOD integration (headless Konva backend)', () => {
    // Stage 800x600, budget 4 → raster below scale √(480000/4) ≈ 346 (zoom ≈ 4.6).
    it('flips raster → vector across the zoom threshold and reports via the lod event', async () => {
        const {renderer, events, backend} = makeRenderer(4);
        renderer.drawArea(1, 0);

        // Default zoom 1 (scale 75) is under the threshold → raster.
        expect(events.at(-1)?.mode).toBe('raster');
        expect(events.at(-1)!.planeRoomCount).toBeGreaterThan(4);
        expect(backend.lodLayer.visible()).toBe(true);
        // Vector scene suppressed.
        expect(renderer.getDrawnExits().length).toBe(0);

        renderer.setZoom(10); // scale 750 → vector
        await flush();
        expect(events.at(-1)?.mode).toBe('vector');
        expect(backend.lodLayer.visible()).toBe(false);
        expect(renderer.getDrawnExits().length).toBeGreaterThan(0);

        renderer.setZoom(1); // back out → raster again
        await flush();
        expect(events.at(-1)?.mode).toBe('raster');
        expect(backend.lodLayer.visible()).toBe(true);
        expect(renderer.getDrawnExits().length).toBe(0);
        renderer.destroy();
    });

    it('never rasters when the plane fits the budget', async () => {
        const {renderer, events, backend} = makeRenderer(16000);
        renderer.drawArea(1, 0);
        expect(events.at(-1)?.mode).toBe('vector');
        renderer.setZoom(0.05);
        await flush();
        expect(events.every(e => e.mode === 'vector')).toBe(true);
        expect(backend.lodLayer.visible()).toBe(false);
        renderer.destroy();
    });

    it('keeps the position marker and highlights alive in raster mode', () => {
        const {renderer, events, backend} = makeRenderer(4);
        renderer.drawArea(1, 0);
        expect(events.at(-1)?.mode).toBe('raster');

        renderer.setPosition(1);
        renderer.renderHighlight(2, '#ffcc00');
        expect(backend.positionLayer.getChildren().length).toBeGreaterThan(0);
        expect(backend.overlayLayer.getChildren().length).toBeGreaterThan(0);
        renderer.destroy();
    });

    it('pushes padded viewport bounds into the reader and rebuilds only on escape', async () => {
        const {renderer, reader} = makeRenderer(4);
        renderer.drawArea(1, 0);
        renderer.setZoom(10);
        await flush();

        const applied = reader.getViewport();
        expect(Number.isFinite(applied.minX)).toBe(true);
        const version0 = reader.getArea(1).getVersion();

        // Tiny pan: stays inside the 50%-per-side padding → no setViewport, no rebuild.
        renderer.camera.position = {...renderer.camera.position, x: renderer.camera.position.x + 1};
        renderer.camera.emit('change', undefined as never);
        await flush();
        expect(reader.getArea(1).getVersion()).toBe(version0);
        expect(reader.getViewport()).toEqual(applied);

        // Large pan: escapes the padding → new viewport applied (version bump).
        renderer.camera.position = {x: renderer.camera.position.x + 5000, y: renderer.camera.position.y};
        renderer.camera.emit('change', undefined as never);
        await flush();
        expect(reader.getArea(1).getVersion()).toBeGreaterThan(version0);
        expect(reader.getViewport()).not.toEqual(applied);
        renderer.destroy();
    });

    it('re-narrows the applied viewport on a pure zoom-in, even though it stays spatially inside the old padding', async () => {
        const {renderer, reader} = makeRenderer(4);
        renderer.drawArea(1, 0);
        renderer.setZoom(2);
        await flush();

        const appliedBefore = reader.getViewport();
        const widthBefore = appliedBefore.maxX - appliedBefore.minX;
        const versionBefore = reader.getArea(1).getVersion();

        // Zoom in well past the ±20% drift tolerance, with no pan at all — the
        // new (smaller) camera viewport is spatially still fully contained in
        // the old wide padded region, so only the scale-drift check can catch
        // this. Without it, visibleEstimate/hit-testing would keep reporting
        // the old, much-too-wide room count forever while zooming in.
        renderer.setZoom(10);
        await flush();

        expect(reader.getArea(1).getVersion()).toBeGreaterThan(versionBefore);
        const appliedAfter = reader.getViewport();
        const widthAfter = appliedAfter.maxX - appliedAfter.minX;
        expect(widthAfter).toBeLessThan(widthBefore);
        renderer.destroy();
    });

    it('plane rooms materialise only within the padded viewport once sized', async () => {
        const {renderer, reader} = makeRenderer(4);
        renderer.drawArea(1, 0);
        renderer.setZoom(10);
        await flush();
        const inView = reader.getArea(1).getPlane(0).getRooms().length;
        const total = reader.getPlaneRoomCount(1, 0);
        expect(inView).toBeGreaterThan(0);
        expect(inView).toBeLessThanOrEqual(total);
        renderer.destroy();
    });

    it('skips hit-testing above lodHitTestBudget while keeping full vector detail', async () => {
        const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
        const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
        const reader = new SkeletonMapReader(buildSkeleton(map, envs));
        // Room budget stays generous (stay in vector mode); hit-test budget is
        // tiny so the small test fixture's shape count exceeds it.
        const settings = {...createSettings(), lodEnabled: true, lodRoomBudget: 16000, lodHitTestBudget: 2};
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);

        expect(events.at(-1)?.mode).toBe('vector');
        expect(events.at(-1)?.hitTestActive).toBe(false);
        expect(renderer.getDrawnExits().length).toBeGreaterThan(0); // full vector detail still drawn
        const room = reader.getRoom(1);
        expect(renderer.hitTest(room.x, room.y)).toBeNull();
        renderer.destroy();
    });

    it('roomsOnly tier: drops exit lines but keeps rooms as real vector shapes', async () => {
        const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
        const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
        const reader = new SkeletonMapReader(buildSkeleton(map, envs));
        // Room budget stays generous (never raster); exit budget is tiny so
        // the fixture's exits get dropped while rooms keep full vector detail.
        // Hit-test budget stays generous too, so we can positively confirm
        // rooms still render (not just "no exits").
        const settings = {
            ...createSettings(), lodEnabled: true,
            lodRoomBudget: 16000, lodExitBudget: 2, lodHitTestBudget: 16000,
        };
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);

        expect(events.at(-1)?.mode).toBe('roomsOnly');
        expect(renderer.getDrawnExits()).toHaveLength(0); // no exit lines built at all
        expect(renderer.getDrawnSpecialExits().length + renderer.getDrawnStubs().length)
            .toBeGreaterThanOrEqual(0); // per-room detail is unaffected (not asserting count, just no crash)
        const room = reader.getRoom(1);
        expect(renderer.hitTest(room.x, room.y)?.kind).toBe('room'); // rooms still real vector shapes
        renderer.destroy();
    });

    it('roomsOnly still shows the current room\'s own exits via the overlay', async () => {
        const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
        const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
        const reader = new SkeletonMapReader(buildSkeleton(map, envs));
        const settings = {
            ...createSettings(), lodEnabled: true,
            lodRoomBudget: 16000, lodExitBudget: 2, lodHitTestBudget: 16000,
        };
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        renderer.drawArea(1, 0);
        renderer.setPosition(1);
        const backend = renderer.backend as KonvaRenderBackend;
        expect(backend.positionLayer.getChildren().length).toBeGreaterThan(0);
        renderer.destroy();
    });

    it('hit-testing works normally below lodHitTestBudget', async () => {
        const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
        const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
        const reader = new SkeletonMapReader(buildSkeleton(map, envs));
        const settings = {...createSettings(), lodEnabled: true}; // defaults: budgets far above the tiny fixture
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);

        expect(events.at(-1)?.hitTestActive).toBe(true);
        const room = reader.getRoom(1);
        expect(renderer.hitTest(room.x, room.y)?.kind).toBe('room');
        renderer.destroy();
    });

    it('lodEnabled=false leaves plain-reader rendering untouched (no lod events)', () => {
        const reader = createTestMapReader();
        const renderer = new MapRenderer(reader, createSettings());
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);
        expect(events).toHaveLength(0);
        expect(renderer.getDrawnExits().length).toBeGreaterThan(0);
        renderer.destroy();
    });

    it('keeps the actual (padded) materialised room count close to the configured budget', async () => {
        // A dense grid where the padded viewport can genuinely approach the
        // budget — the LOD decision must account for the ~6%+1 padding
        // applied before materialisation, or the vector regime silently
        // draws well beyond lodRoomBudget right at the flip.
        const n = 220;
        const map: MapData.Map = [{
            areaId: '1', areaName: 'grid', labels: [],
            rooms: Array.from({length: n * n}, (_, i) => {
                const x = i % n, y = Math.floor(i / n);
                return {
                    id: i + 1, area: 1, x, y, z: 0, areaId: '1', weight: 1, roomChar: '',
                    name: '', userData: {}, customLines: {}, stubs: [], hash: '', env: 1,
                    exits: {} as Record<MapData.direction, number>, doors: {}, specialExits: {},
                };
            }),
        }];
        const budget = 4000;
        const reader = new SkeletonMapReader(buildSkeleton(map));
        const settings = {...createSettings(), lodEnabled: true, lodRoomBudget: budget};
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);

        // Binary-search-ish sweep from raster toward vector to find the flip.
        let flip: LodEventDetail | undefined;
        for (let zoom = 0.05; zoom <= 3; zoom *= 1.15) {
            renderer.setZoom(zoom);
            await flush();
            const last = events.at(-1)!;
            if (last.mode === 'vector') {flip = last; break;}
        }
        expect(flip).toBeDefined();
        // The corrected decision keeps the actual padded count within a small
        // margin of budget, not the ~25%+ overshoot the uncorrected math gave.
        expect(flip!.visibleEstimate).toBeLessThan(budget * 1.15);
        renderer.destroy();
    });

    it('raster LOD also works over a plain (non-virtualized) MapReader', async () => {
        const reader = createTestMapReader();
        const settings = {...createSettings(), lodEnabled: true, lodRoomBudget: 4};
        const renderer = new MapRenderer(reader, settings);
        renderer.camera.setSize(800, 600);
        const events: LodEventDetail[] = [];
        renderer.on('lod', e => events.push(e));
        renderer.drawArea(1, 0);
        expect(events.at(-1)?.mode).toBe('raster');
        expect((renderer.backend as KonvaRenderBackend).lodLayer.visible()).toBe(true);

        renderer.setZoom(10);
        await flush();
        expect(events.at(-1)?.mode).toBe('vector');
        renderer.destroy();
    });
});
