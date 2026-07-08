import {describe, expect, it} from 'vitest';
import {computeLodMode} from '../src/rendering/lod/lodDecision';

const base = {stageWidth: 800, stageHeight: 600, roomBudget: 16000, exitBudget: 12000};

describe('computeLodMode', () => {
    it('is vector when the plane fits both budgets, at any zoom', () => {
        for (const scale of [0.001, 0.1, 1, 10, 100]) {
            expect(computeLodMode({...base, planeRoomCount: 12000, scale})).toBe('vector');
        }
    });

    it('steps vector -> roomsOnly -> raster as zoom decreases on a huge plane', () => {
        const huge = {...base, planeRoomCount: 1_000_000};
        // Thresholds: sqrt(W*H/budget) — exitBudget (12000) trips at a HIGHER
        // scale (more zoomed in, ~6.32) than roomBudget (16000, ~5.48), so
        // there's a scale band where only exits have dropped.
        expect(computeLodMode({...huge, scale: 100})).toBe('vector');
        expect(computeLodMode({...huge, scale: 6.0})).toBe('roomsOnly'); // below the exit threshold (~6.32), still above the room threshold (~5.48)
        expect(computeLodMode({...huge, scale: 5})).toBe('raster'); // past both
    });

    it('never enters roomsOnly when exitBudget is omitted', () => {
        const huge = {stageWidth: 800, stageHeight: 600, roomBudget: 16000, planeRoomCount: 1_000_000};
        for (const scale of [100, 6.5, 5, 1]) {
            expect(computeLodMode({...huge, scale})).not.toBe('roomsOnly');
        }
    });

    it('is monotonic: vector -> roomsOnly -> raster in one direction as scale decreases', () => {
        const huge = {...base, planeRoomCount: 1_000_000};
        const order = {vector: 0, roomsOnly: 1, raster: 2};
        let last = 0;
        for (let scale = 100; scale > 0.1; scale -= 0.5) {
            const mode = computeLodMode({...huge, scale});
            expect(order[mode]).toBeGreaterThanOrEqual(last);
            last = order[mode];
        }
    });

    it('respects an exitBudget above roomBudget by never overriding the raster decision', () => {
        // Misconfigured (exitBudget > roomBudget): raster still wins once the
        // plane exceeds roomBudget, since that check runs first.
        const huge = {...base, exitBudget: 20000, planeRoomCount: 1_000_000};
        expect(computeLodMode({...huge, scale: 5})).toBe('raster');
    });
});
