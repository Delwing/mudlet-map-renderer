import { describe, it, expect } from 'vitest';
import { createTestMapReader } from './helpers';

describe('MapReader', () => {
    describe('loading', () => {
        it('loads all rooms', () => {
            const reader = createTestMapReader();
            const rooms = reader.getRooms();
            expect(rooms.length).toBe(19); // 16 in area 1, 3 in area 2
        });

        it('loads both areas', () => {
            const reader = createTestMapReader();
            const areas = reader.getAreas();
            expect(areas.length).toBe(2);
        });
    });

    describe('getRoom', () => {
        it('returns room by id', () => {
            const reader = createTestMapReader();
            const room = reader.getRoom(1);
            expect(room).toBeDefined();
            expect(room.name).toBe('Village Center');
            expect(room.x).toBe(0);
        });

        it('inverts y coordinates on load', () => {
            const reader = createTestMapReader();
            // Room 2 has y: 2 in fixture (Mudlet: north = +y), becomes y: -2 after inversion for canvas
            const room = reader.getRoom(2);
            expect(room.y).toBe(-2);
        });

        it('returns undefined for nonexistent room', () => {
            const reader = createTestMapReader();
            expect(reader.getRoom(999)).toBeUndefined();
        });
    });

    describe('getArea', () => {
        it('returns area by id', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            expect(area).toBeDefined();
            expect(area.getAreaName()).toBe('Test Village');
        });

        it('area has correct z-levels', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            const levels = area.getZLevels();
            // Rooms are at z=0, z=-1, z=1 in fixture (y-inversion doesn't affect z)
            expect(levels).toContain(0);
            expect(levels).toContain(-1);
            expect(levels).toContain(1);
        });

        it('planes contain correct rooms', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            const plane0 = area.getPlane(0);
            expect(plane0).toBeDefined();
            const roomIds = plane0!.getRooms().map(r => r.id);
            // z=0 rooms: 1,2,3,4,5,6,7,8,12
            expect(roomIds).toContain(1);
            expect(roomIds).toContain(12);
            expect(roomIds).not.toContain(9); // z=-1
            expect(roomIds).not.toContain(10); // z=1
        });

        it('returns undefined for nonexistent area', () => {
            const reader = createTestMapReader();
            expect(reader.getArea(999)).toBeUndefined();
        });
    });

    describe('colors', () => {
        it('returns color value for known env', () => {
            const reader = createTestMapReader();
            expect(reader.getColorValue(1)).toBe('rgb(128,128,128)');
            expect(reader.getColorValue(2)).toBe('rgb(200,160,40)');
        });

        it('returns default color for unknown env', () => {
            const reader = createTestMapReader();
            const color = reader.getColorValue(999);
            expect(color).toBe('rgb(114, 1, 0)');
        });

        it('returns dark symbol color for light backgrounds', () => {
            const reader = createTestMapReader();
            // env 1: [128,128,128] luminance ~0.5 > 0.41 → dark symbol
            const symbolColor = reader.getSymbolColor(1);
            expect(symbolColor).toContain('25');
        });

        it('returns light symbol color for dark backgrounds', () => {
            const reader = createTestMapReader();
            // env 3: [30,120,30] luminance ~0.29 < 0.41 → light symbol
            const symbolColor = reader.getSymbolColor(3);
            expect(symbolColor).toContain('225');
        });
    });

    describe('exploration', () => {
        it('decorateWithExploration creates exploration areas', () => {
            const reader = createTestMapReader();
            reader.decorateWithExploration(new Set([1, 2, 3]));
            expect(reader.isExplorationEnabled()).toBe(true);
        });

        it('exploration filters rooms in planes', () => {
            const reader = createTestMapReader();
            reader.decorateWithExploration(new Set([1, 2]));
            const area = reader.getArea(1);
            const plane = area.getPlane(0);
            const rooms = plane!.getRooms();
            const roomIds = rooms.map(r => r.id);
            expect(roomIds).toContain(1);
            expect(roomIds).toContain(2);
            expect(roomIds).not.toContain(3);
        });

        it('addVisitedRoom works', () => {
            const reader = createTestMapReader();
            reader.decorateWithExploration(new Set([1]));
            expect(reader.hasVisitedRoom(1)).toBe(true);
            expect(reader.hasVisitedRoom(2)).toBe(false);

            const isNew = reader.addVisitedRoom(2);
            expect(isNew).toBe(true);
            expect(reader.hasVisitedRoom(2)).toBe(true);

            const isNewAgain = reader.addVisitedRoom(2);
            expect(isNewAgain).toBe(false);
        });

        it('clearExplorationDecoration restores all rooms', () => {
            const reader = createTestMapReader();
            reader.decorateWithExploration(new Set([1]));
            reader.clearExplorationDecoration();
            expect(reader.isExplorationEnabled()).toBe(false);

            const area = reader.getArea(1);
            const plane = area.getPlane(0);
            // Should have all z=0 rooms back
            expect(plane!.getRooms().length).toBeGreaterThan(1);
        });
    });

    describe('area exits', () => {
        it('detects link exits within an area', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            const exits = area.getLinkExits(0);
            // Should have paired exits for room connections on z=0
            expect(exits.length).toBeGreaterThan(0);
        });

        it('exit pairs have correct room ids', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            const exits = area.getLinkExits(0);
            // Room 1 ↔ Room 2 (north/south) should be a paired exit
            const r1r2 = exits.find(e =>
                (e.a === 1 && e.b === 2) || (e.a === 2 && e.b === 1)
            );
            expect(r1r2).toBeDefined();
        });
    });

    describe('plane bounds', () => {
        it('computes bounds from room positions', () => {
            const reader = createTestMapReader();
            const area = reader.getArea(1);
            const plane = area.getPlane(0);
            const bounds = plane!.getBounds();
            expect(bounds.minX).toBeLessThanOrEqual(0);
            expect(bounds.maxX).toBeGreaterThanOrEqual(0);
        });
    });
});
