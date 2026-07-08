import {describe, expect, it} from 'vitest';
import {buildSkeleton, hasVisualDetail} from '../src/bigmap/buildSkeleton';
import {SKELETON_DIRS} from '../src/bigmap/Skeleton';
import testMap from './fixtures/test-map.json';
import testEnvs from './fixtures/test-envs.json';

function fixtureMap(): MapData.Map {
    return JSON.parse(JSON.stringify(testMap)) as MapData.Map;
}

function fixtureEnvs(): MapData.Env[] {
    return JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
}

describe('buildSkeleton', () => {
    it('packs every room of every area into parallel columns', () => {
        const map = fixtureMap();
        const sk = buildSkeleton(map, fixtureEnvs());
        const total = map.reduce((n, a) => n + a.rooms.length, 0);
        expect(sk.count).toBe(total);
        expect(sk.x.length).toBe(total);
        expect(sk.exits.length).toBe(total * 12);

        // Every fixture room appears at its slot with raw coordinates.
        const rooms = map.flatMap(a => a.rooms);
        for (let i = 0; i < total; i++) {
            const r = rooms[i];
            expect(sk.id[i]).toBe(r.id);
            expect(sk.x[i]).toBe(r.x);
            expect(sk.y[i]).toBe(r.y); // RAW map space — no negation
            expect(sk.z[i]).toBe(r.z);
            expect(sk.area[i]).toBe(r.area);
            expect(sk.env[i]).toBe(r.env);
        }
    });

    it('packs exits row-major with -1 for missing directions', () => {
        const map = fixtureMap();
        const sk = buildSkeleton(map);
        const room = map[0].rooms[0]; // slot 0: has north/east/south/west/up
        for (let d = 0; d < 12; d++) {
            const dir = SKELETON_DIRS[d];
            const expected = room.exits[dir] ?? -1;
            expect(sk.exits[d]).toBe(expected);
        }
    });

    it('promotes only rooms with visual detail, cloned from the input', () => {
        const map = fixtureMap();
        const plain = map.flatMap(a => a.rooms).filter(r => !hasVisualDetail(r));
        const detailed = map.flatMap(a => a.rooms).filter(hasVisualDetail);
        expect(plain.length).toBeGreaterThan(0);
        expect(detailed.length).toBeGreaterThan(0);

        const sk = buildSkeleton(map);
        const ids = (sk.detailRooms ?? []).map(r => r.id);
        expect(ids.sort((a, b) => a - b)).toEqual(detailed.map(r => r.id).sort((a, b) => a - b));
        for (const r of plain) expect(ids).not.toContain(r.id);

        // Clone: mutating the skeleton's copy must not touch the input.
        const original = detailed[0];
        const detail = sk.detailRooms!.find(r => r.id === original.id)!;
        detail.y = 999;
        expect(original.y).not.toBe(999);
    });

    it('honours a custom isDetailRoom override', () => {
        const sk = buildSkeleton(fixtureMap(), [], {isDetailRoom: r => r.id === 3});
        expect((sk.detailRooms ?? []).map(r => r.id)).toEqual([3]);
    });

    it('records grid areas from options', () => {
        const sk = buildSkeleton(fixtureMap(), [], {gridAreas: [2]});
        expect(sk.areaGridMode[2]).toBe(true);
        expect(sk.areaGridMode[1]).toBeUndefined();
    });

    it('maps env colors and area names', () => {
        const sk = buildSkeleton(fixtureMap(), fixtureEnvs());
        expect(sk.customEnvColors[1]).toEqual({r: 128, g: 128, b: 128});
        expect(sk.areaNames[1]).toBe((testMap as MapData.Map)[0].areaName);
    });

    it('collects labels with their area id and names/userData columns', () => {
        const map = fixtureMap();
        map[0].rooms[1].userData = {sector: 'town'};
        const sk = buildSkeleton(map);
        expect(sk.labels!.length).toBeGreaterThan(0);
        expect(sk.labels![0].areaId).toBe(1);
        expect(sk.names![0]).toBe(map[0].rooms[0].name);
        expect(sk.userData).toContainEqual({id: map[0].rooms[1].id, data: {sector: 'town'}});
    });
});

describe('hasVisualDetail', () => {
    it('is false for a plain room and true per criterion', () => {
        const base: MapData.Room = {
            id: 1, area: 1, x: 0, y: 0, z: 0, areaId: '1', weight: 1, roomChar: '',
            name: '', userData: {}, customLines: {}, stubs: [], hash: '', env: 1,
            exits: {} as Record<MapData.direction, number>, doors: {}, specialExits: {},
        };
        expect(hasVisualDetail(base)).toBe(false);
        expect(hasVisualDetail({...base, roomChar: 'X'})).toBe(true);
        expect(hasVisualDetail({...base, stubs: [1]})).toBe(true);
        expect(hasVisualDetail({...base, doors: {north: 1}})).toBe(true);
        expect(hasVisualDetail({...base, specialExits: {enter: 5}})).toBe(true);
        expect(hasVisualDetail({...base, exitLocks: [2]})).toBe(true);
    });
});
