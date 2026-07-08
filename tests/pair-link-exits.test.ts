import {describe, expect, it} from 'vitest';
import {pairLinkExits} from '../src/reader/Area';

function room(id: number, exits: Partial<Record<MapData.direction, number>>, z = 0): MapData.Room {
    return {
        id, area: 1, x: 0, y: 0, z, areaId: '1', weight: 1, roomChar: '',
        name: `Room ${id}`, userData: {}, customLines: {}, stubs: [], hash: '', env: 1,
        exits: exits as Record<MapData.direction, number>, doors: {}, specialExits: {},
    };
}

describe('pairLinkExits', () => {
    it('pairs opposite-direction half-exits into one bidirectional exit', () => {
        const exits = pairLinkExits([room(1, {south: 2}), room(2, {north: 1})]);
        const values = Array.from(exits.values());
        expect(values).toHaveLength(1);
        expect(values[0]).toMatchObject({a: 1, b: 2, aDir: 'south', bDir: 'north', zIndex: [0, 0]});
    });

    it('falls back to one-way when the neighbour has no matching opposite exit', () => {
        const exits = pairLinkExits([room(1, {south: 2}), room(2, {})]);
        const values = Array.from(exits.values());
        expect(values).toHaveLength(1);
        expect(values[0].aDir).toBe('south');
        expect(values[0].bDir).toBeUndefined();
    });

    it('skips self-referencing exits and pairs multiple distinct directions between the same pair', () => {
        const exits = pairLinkExits([
            room(1, {south: 2, up: 2, out: 1}), // 'out: 1' is a self-exit — must be dropped
            room(2, {north: 1, down: 1}),
        ]);
        for (const e of exits.values()) expect(e.a === e.b).toBe(false);
        expect(exits.size).toBe(2); // south/north pair + up/down pair, self-exit excluded
    });

    it('carries each half-exit z into zIndex, not the target room z', () => {
        const exits = pairLinkExits([room(1, {up: 2}, 0), room(2, {down: 1}, 1)]);
        const values = Array.from(exits.values());
        expect(values[0].zIndex).toEqual([0, 1]);
    });
});
