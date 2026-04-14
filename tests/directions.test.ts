import { describe, it, expect } from 'vitest';
import { movePoint, movePointCircle, movePointRoundedRect } from '../src/directions';

describe('movePoint', () => {
    it('returns same point for non-planar direction', () => {
        expect(movePoint(5, 5, 'up')).toEqual({ x: 5, y: 5 });
        expect(movePoint(5, 5, 'down')).toEqual({ x: 5, y: 5 });
        expect(movePoint(5, 5, 'in')).toEqual({ x: 5, y: 5 });
        expect(movePoint(5, 5, 'out')).toEqual({ x: 5, y: 5 });
        expect(movePoint(5, 5, undefined)).toEqual({ x: 5, y: 5 });
    });

    it('moves north (y decreases)', () => {
        expect(movePoint(0, 0, 'north')).toEqual({ x: 0, y: -1 });
    });

    it('moves south (y increases)', () => {
        expect(movePoint(0, 0, 'south')).toEqual({ x: 0, y: 1 });
    });

    it('moves east (x increases)', () => {
        expect(movePoint(0, 0, 'east')).toEqual({ x: 1, y: 0 });
    });

    it('moves west (x decreases)', () => {
        expect(movePoint(0, 0, 'west')).toEqual({ x: -1, y: 0 });
    });

    it('moves diagonals correctly', () => {
        expect(movePoint(0, 0, 'northeast')).toEqual({ x: 1, y: -1 });
        expect(movePoint(0, 0, 'northwest')).toEqual({ x: -1, y: -1 });
        expect(movePoint(0, 0, 'southeast')).toEqual({ x: 1, y: 1 });
        expect(movePoint(0, 0, 'southwest')).toEqual({ x: -1, y: 1 });
    });

    it('respects custom distance', () => {
        expect(movePoint(0, 0, 'north', 0.3)).toEqual({ x: 0, y: -0.3 });
        expect(movePoint(0, 0, 'east', 2)).toEqual({ x: 2, y: 0 });
    });

    it('works from non-origin point', () => {
        expect(movePoint(3, 4, 'north', 1)).toEqual({ x: 3, y: 3 });
        expect(movePoint(3, 4, 'southeast', 1)).toEqual({ x: 4, y: 5 });
    });

    it('opposite directions cancel out', () => {
        const start = { x: 5, y: 7 };
        const pairs: [MapData.direction, MapData.direction][] = [
            ['north', 'south'], ['east', 'west'],
            ['northeast', 'southwest'], ['northwest', 'southeast'],
        ];
        for (const [a, b] of pairs) {
            const mid = movePoint(start.x, start.y, a, 3);
            const end = movePoint(mid.x, mid.y, b, 3);
            expect(end.x).toBeCloseTo(start.x);
            expect(end.y).toBeCloseTo(start.y);
        }
    });
});

describe('movePointCircle', () => {
    it('returns same point for non-planar direction', () => {
        expect(movePointCircle(0, 0, 'up')).toEqual({ x: 0, y: 0 });
        expect(movePointCircle(0, 0, undefined)).toEqual({ x: 0, y: 0 });
    });

    it('cardinal directions land on axis at radius distance', () => {
        const r = 0.3;
        const east = movePointCircle(0, 0, 'east', r);
        expect(east.x).toBeCloseTo(r);
        expect(east.y).toBeCloseTo(0);

        const north = movePointCircle(0, 0, 'north', r);
        expect(north.x).toBeCloseTo(0);
        expect(north.y).toBeCloseTo(-r);
    });

    it('diagonal directions land at radius distance from center', () => {
        const r = 1;
        const ne = movePointCircle(0, 0, 'northeast', r);
        const dist = Math.sqrt(ne.x * ne.x + ne.y * ne.y);
        expect(dist).toBeCloseTo(r);
        expect(ne.x).toBeGreaterThan(0);
        expect(ne.y).toBeLessThan(0);
    });

    it('all 8 directions land on the circle perimeter', () => {
        const r = 2;
        const dirs: MapData.direction[] = [
            'north', 'south', 'east', 'west',
            'northeast', 'northwest', 'southeast', 'southwest',
        ];
        for (const dir of dirs) {
            const p = movePointCircle(0, 0, dir, r);
            const dist = Math.sqrt(p.x * p.x + p.y * p.y);
            expect(dist).toBeCloseTo(r, 5);
        }
    });
});

describe('movePointRoundedRect', () => {
    it('returns same point for non-planar direction', () => {
        expect(movePointRoundedRect(0, 0, 'up')).toEqual({ x: 0, y: 0 });
    });

    it('cardinal directions match movePoint (flat edge)', () => {
        const d = 0.3;
        const cr = 0.06;
        expect(movePointRoundedRect(0, 0, 'north', d, cr)).toEqual(movePoint(0, 0, 'north', d));
        expect(movePointRoundedRect(0, 0, 'east', d, cr)).toEqual(movePoint(0, 0, 'east', d));
    });

    it('falls back to movePoint when cornerRadius is 0', () => {
        expect(movePointRoundedRect(0, 0, 'northeast', 0.3, 0)).toEqual(movePoint(0, 0, 'northeast', 0.3));
    });

    it('diagonal points are closer to center than rectangle corners', () => {
        const d = 0.3;
        const cr = 0.06;
        const rect = movePoint(0, 0, 'northeast', d);
        const rounded = movePointRoundedRect(0, 0, 'northeast', d, cr);
        const rectDist = Math.sqrt(rect.x * rect.x + rect.y * rect.y);
        const roundedDist = Math.sqrt(rounded.x * rounded.x + rounded.y * rounded.y);
        expect(roundedDist).toBeLessThan(rectDist);
    });

    it('larger corner radius pulls diagonal point further in', () => {
        const d = 0.3;
        const small = movePointRoundedRect(0, 0, 'northeast', d, 0.03);
        const large = movePointRoundedRect(0, 0, 'northeast', d, 0.1);
        const smallDist = Math.sqrt(small.x * small.x + small.y * small.y);
        const largeDist = Math.sqrt(large.x * large.x + large.y * large.y);
        expect(largeDist).toBeLessThan(smallDist);
    });
});
