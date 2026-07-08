import {describe, expect, it} from 'vitest';
import type {MapSkeleton} from '../src/bigmap/Skeleton';
import {buildPlaneIndex, countInBounds, forEachInBounds} from '../src/bigmap/PlaneIndex';
import type {ViewportBounds} from '../src/types/Settings';

/** Minimal skeleton over explicit points, all on (area 1, z 0) unless given. */
function skeletonOf(points: {x: number; y: number; area?: number; z?: number}[]): MapSkeleton {
    const n = points.length;
    const sk: MapSkeleton = {
        count: n,
        x: new Int32Array(n), y: new Int32Array(n), z: new Int32Array(n),
        area: new Int32Array(n), env: new Int32Array(n), id: new Int32Array(n),
        exits: new Int32Array(n * 12).fill(-1),
        areaNames: {}, areaGridMode: {}, customEnvColors: {},
    };
    points.forEach((p, i) => {
        sk.x[i] = p.x;
        sk.y[i] = p.y;
        sk.z[i] = p.z ?? 0;
        sk.area[i] = p.area ?? 1;
        sk.id[i] = i + 1;
    });
    return sk;
}

function collect(sk: MapSkeleton, areaId: number, z: number, b: ViewportBounds): number[] {
    const p = buildPlaneIndex(sk, areaId, z);
    const out: number[] = [];
    forEachInBounds(sk, p, b, i => out.push(i));
    return out.sort((a, c) => a - c);
}

function bruteForce(sk: MapSkeleton, areaId: number, z: number, b: ViewportBounds): number[] {
    const out: number[] = [];
    for (let i = 0; i < sk.count; i++) {
        if (sk.area[i] === areaId && sk.z[i] === z &&
            sk.x[i] >= b.minX && sk.x[i] <= b.maxX &&
            sk.y[i] >= b.minY && sk.y[i] <= b.maxY) out.push(i);
    }
    return out;
}

describe('PlaneIndex', () => {
    it('matches brute force on a randomized dense plane', () => {
        // Deterministic LCG so failures reproduce.
        let seed = 42;
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const pts = Array.from({length: 2000}, () => ({
            x: Math.floor(rnd() * 500) - 250,
            y: Math.floor(rnd() * 500) - 250,
        }));
        const sk = skeletonOf(pts);
        const p = buildPlaneIndex(sk, 1, 0);
        expect(p.indices.length).toBe(2000);

        for (let t = 0; t < 25; t++) {
            const cx = Math.floor(rnd() * 500) - 250;
            const cy = Math.floor(rnd() * 500) - 250;
            const w = Math.floor(rnd() * 200), h = Math.floor(rnd() * 200);
            const b = {minX: cx - w, maxX: cx + w, minY: cy - h, maxY: cy + h};
            expect(collect(sk, 1, 0, b)).toEqual(bruteForce(sk, 1, 0, b));
            expect(countInBounds(p, b)).toBeGreaterThanOrEqual(bruteForce(sk, 1, 0, b).length);
        }
    });

    it('filters by area and z', () => {
        const sk = skeletonOf([
            {x: 0, y: 0}, {x: 1, y: 1, area: 2}, {x: 2, y: 2, z: 1},
        ]);
        const everything = {minX: -10, maxX: 10, minY: -10, maxY: 10};
        expect(collect(sk, 1, 0, everything)).toEqual([0]);
        expect(collect(sk, 2, 0, everything)).toEqual([1]);
        expect(collect(sk, 1, 1, everything)).toEqual([2]);
    });

    it('handles an empty plane and a single room', () => {
        const sk = skeletonOf([{x: 5, y: 5}]);
        const empty = buildPlaneIndex(sk, 99, 0);
        expect(empty.indices.length).toBe(0);
        expect(countInBounds(empty, {minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9})).toBe(0);

        const single = buildPlaneIndex(sk, 1, 0);
        expect(single.indices.length).toBe(1);
        expect(collect(sk, 1, 0, {minX: 5, maxX: 5, minY: 5, maxY: 5})).toEqual([0]);
        expect(collect(sk, 1, 0, {minX: 6, maxX: 7, minY: 5, maxY: 5})).toEqual([]);
    });

    it('is exact at cell boundaries (the edge-popping bug class)', () => {
        // 129-wide row → cell size 2, so odd x-coords sit at cell boundaries.
        const pts = Array.from({length: 130}, (_, i) => ({x: i, y: 0}));
        const sk = skeletonOf(pts);
        const p = buildPlaneIndex(sk, 1, 0);
        expect(p.cs).toBeGreaterThan(1);
        for (let lo = 0; lo < 20; lo++) {
            const b = {minX: lo, maxX: lo + 7, minY: 0, maxY: 0};
            expect(collect(sk, 1, 0, b)).toEqual(bruteForce(sk, 1, 0, b));
        }
        // Bounds entirely left/right of the plane.
        expect(collect(sk, 1, 0, {minX: -50, maxX: -1, minY: 0, maxY: 0})).toEqual([]);
        expect(collect(sk, 1, 0, {minX: 200, maxX: 300, minY: 0, maxY: 0})).toEqual([]);
    });

    it('handles negative coordinates', () => {
        const sk = skeletonOf([{x: -100, y: -100}, {x: -50, y: -50}, {x: 0, y: 0}]);
        expect(collect(sk, 1, 0, {minX: -110, maxX: -49, minY: -110, maxY: -49})).toEqual([0, 1]);
    });
});
