import {describe, expect, it} from 'vitest';
import {MapRenderer} from '../src/rendering/MapRenderer';
import {SvgExporter} from '../src/export/SvgExporter';
import {createSettings} from '../src/types/Settings';
import MapReader from '../src/reader/MapReader';
import SkeletonMapReader from '../src/bigmap/SkeletonMapReader';
import {buildSkeleton} from '../src/bigmap/buildSkeleton';
import {isViewportDataSource} from '../src/reader/ViewportDataSource';
import testMap from './fixtures/test-map.json';
import testEnvs from './fixtures/test-envs.json';

function fixtures(): {map: MapData.Map; envs: MapData.Env[]} {
    return {
        map: JSON.parse(JSON.stringify(testMap)) as MapData.Map,
        envs: JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[],
    };
}

function skeletonReader(): SkeletonMapReader {
    const {map, envs} = fixtures();
    return new SkeletonMapReader(buildSkeleton(map, envs));
}

function exportArea(reader: MapReader | SkeletonMapReader, areaId: number, z = 0): string {
    const renderer = new MapRenderer(reader, createSettings());
    renderer.drawArea(areaId, z);
    return renderer.export(new SvgExporter());
}

describe('SkeletonMapReader', () => {
    it('is detected as a ViewportDataSource; MapReader is not', () => {
        expect(isViewportDataSource(skeletonReader())).toBe(true);
        const {map, envs} = fixtures();
        expect(isViewportDataSource(new MapReader(map, envs))).toBe(false);
    });

    it('negates y to renderer space, matching MapReader', () => {
        const {map, envs} = fixtures();
        const plain = new MapReader(fixtures().map, envs);
        const reader = skeletonReader();
        // Int32Array columns normalise -0 to +0; treat them as equal.
        const n = (v: number) => (v === 0 ? 0 : v);
        for (const area of map) {
            for (const room of area.rooms) {
                expect(n(reader.getRoom(room.id).y)).toBe(n(plain.getRoom(room.id).y));
                expect(n(reader.getRoom(room.id).x)).toBe(n(plain.getRoom(room.id).x));
            }
        }
    });

    it('returns complete rooms by id, with detail rooms overriding the synth', () => {
        const {map} = fixtures();
        map[0].rooms[0].roomChar = '@';
        map[0].rooms[0].userData = {shop: 'yes'};
        const reader = new SkeletonMapReader(buildSkeleton(map));
        const detailed = reader.getRoom(map[0].rooms[0].id);
        expect(detailed.roomChar).toBe('@'); // came from the detail override
        expect(detailed.userData).toEqual({shop: 'yes'});

        const synth = reader.getRoom(map[0].rooms[1].id);
        expect(synth.name).toBe(map[0].rooms[1].name);
        expect(synth.exits).toEqual(map[0].rooms[1].exits);
    });

    it('setViewport narrows plane rooms and bumps version only on real change', () => {
        const reader = skeletonReader();
        const area = reader.getArea(1);
        const all = area.getPlane(0).getRooms().length;
        expect(all).toBeGreaterThan(0);

        const v0 = area.getVersion();
        const r1 = reader.getRoom(1); // renderer space
        reader.setViewport({minX: r1.x, maxX: r1.x, minY: r1.y, maxY: r1.y});
        expect(area.getVersion()).toBe(v0 + 1);
        const narrowed = area.getPlane(0).getRooms();
        expect(narrowed.length).toBeLessThan(all);
        expect(narrowed.some(r => r.id === 1)).toBe(true);

        // Same bounds again → no version bump.
        reader.setViewport({minX: r1.x, maxX: r1.x, minY: r1.y, maxY: r1.y});
        expect(area.getVersion()).toBe(v0 + 1);
    });

    it('getPlaneRoomCount / estimateVisibleCount report plane totals and upper bounds', () => {
        const reader = skeletonReader();
        const total = reader.getArea(1).getPlane(0).getRooms().length;
        expect(reader.getPlaneRoomCount(1, 0)).toBe(total);
        const b = {minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9};
        expect(reader.estimateVisibleCount(1, 0, b)).toBeGreaterThanOrEqual(total);

        let visited = 0;
        reader.forEachInBounds(1, 0, b, () => visited++);
        expect(visited).toBe(total);
    });

    it('pairs link exits among visible rooms; off-viewport targets stay drawable one-way', () => {
        const reader = skeletonReader();
        const area = reader.getArea(1);
        const full = area.getLinkExits(0);
        expect(full.length).toBeGreaterThan(0);

        // Narrow to a single room: its exits to now-hidden neighbours become
        // one-way half-exits (only aDir or bDir set), and the far endpoint is
        // still resolvable through getRoom().
        const r1 = reader.getRoom(1);
        reader.setViewport({minX: r1.x, maxX: r1.x, minY: r1.y, maxY: r1.y});
        const narrowed = area.getLinkExits(0);
        expect(narrowed.length).toBeGreaterThan(0);
        expect(narrowed.length).toBeLessThan(full.length);
        for (const e of narrowed) {
            expect(reader.getRoom(e.a)).toBeDefined();
            expect(reader.getRoom(e.b)).toBeDefined();
        }
    });

    it('suppresses cardinal exits for grid areas', () => {
        const {map} = fixtures();
        const reader = new SkeletonMapReader(buildSkeleton(map, [], {gridAreas: [1]}));
        expect(reader.getArea(1).getLinkExits(0)).toEqual([]);
        expect(Object.keys(reader.getRoom(1).exits)).toHaveLength(0);
    });

    it('plane bounds cover the full plane regardless of viewport (fitArea contract)', () => {
        const reader = skeletonReader();
        const before = reader.getArea(1).getPlane(0).getBounds();
        reader.setViewport({minX: 0, maxX: 0, minY: 0, maxY: 0});
        expect(reader.getArea(1).getPlane(0).getBounds()).toEqual(before);
    });

    it('renders the same SVG as the concrete MapReader for plain rooms', () => {
        // Restrict to skeleton-representable content: strip visual detail so the
        // comparison isolates the synthesised-room path.
        const {map, envs} = fixtures();
        for (const area of map) {
            for (const r of area.rooms) {
                r.roomChar = '';
                r.customLines = {};
                r.specialExits = {};
                r.stubs = [];
                r.doors = {};
                delete r.exitLocks;
            }
        }
        const plainSvg = exportArea(new MapReader(JSON.parse(JSON.stringify(map)), envs), 1);
        const skeletonSvg = exportArea(new SkeletonMapReader(buildSkeleton(map, envs)), 1);
        // Same elements, order-insensitive: the skeleton reader emits rooms in
        // spatial-bucket order rather than JSON order, which is fine — parity
        // is about geometry and styling, not serialisation sequence.
        const norm = (svg: string) => svg.split(/(?=<)/).map(s => s.trim()).filter(Boolean).sort();
        expect(norm(skeletonSvg)).toEqual(norm(plainSvg));
    });

    it('renders detail rooms (symbols, special exits) through the detail override', () => {
        const {map, envs} = fixtures();
        const svg = exportArea(new SkeletonMapReader(buildSkeleton(map, envs)), 1);
        expect(svg).toContain('<svg');
        // Fixture area 1 has roomChar symbols that only the detail path carries.
        const withChar = map[0].rooms.find(r => r.roomChar);
        if (withChar) expect(svg).toContain(withChar.roomChar);
    });

    it('exposes labels per plane', () => {
        const reader = skeletonReader();
        const labels = reader.getArea(1).getPlane(0).getLabels();
        expect(labels.length).toBe((testMap as MapData.Map)[0].labels.filter(l => l.Z === 0).length);
    });
});
