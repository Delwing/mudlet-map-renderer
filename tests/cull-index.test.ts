import {describe, it, expect} from 'vitest';
import {CullIndex, projectBounds, type CullIndexEntry} from '../src/render/CullIndex';
import {IDENTITY_TRANSFORM, type CoordFn} from '../src/coord/CoordFn';
import type {Shape} from '../src/scene/Shape';
import type {ViewportBounds} from '../src/types/Settings';

/** Deterministic LCG so failures reproduce exactly. */
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/** A shape identity — the index only ever compares by reference. */
function shape(id: number): Shape {
    return {__id: id} as unknown as Shape;
}

/** Brute-force reference: the exact predicate buildCullingVisibilityMap uses. */
function bruteForce(entries: CullIndexEntry[], vp: ViewportBounds): Set<Shape> {
    const out = new Set<Shape>();
    for (const e of entries) {
        if (e.maxX >= vp.minX && e.minX <= vp.maxX && e.maxY >= vp.minY && e.minY <= vp.maxY) {
            out.add(e.shape);
        }
    }
    return out;
}

function setsEqual(a: Set<Shape>, b: Set<Shape>): boolean {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

/**
 * Generate `n` random entries. `spread` controls how far rooms scatter;
 * `bigChance` injects occasional huge shapes (long exits) to exercise the
 * oversized bucket.
 */
function randomEntries(rng: () => number, n: number, spread: number, bigChance = 0): CullIndexEntry[] {
    const out: CullIndexEntry[] = [];
    for (let i = 0; i < n; i++) {
        const cx = (rng() - 0.5) * spread;
        const cy = (rng() - 0.5) * spread;
        const big = rng() < bigChance;
        const w = big ? spread * (0.2 + rng() * 0.6) : 0.2 + rng() * 1.5;
        const h = big ? spread * (0.2 + rng() * 0.6) : 0.2 + rng() * 1.5;
        out.push({shape: shape(i), minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2});
    }
    return out;
}

function randomViewport(rng: () => number, spread: number): ViewportBounds {
    const cx = (rng() - 0.5) * spread * 1.4;
    const cy = (rng() - 0.5) * spread * 1.4;
    const w = 0.5 + rng() * spread; // from tiny to whole-map
    const h = 0.5 + rng() * spread;
    return {minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2};
}

describe('CullIndex', () => {
    it('matches brute force on small scenes (linear fallback path)', () => {
        const rng = makeRng(1);
        const entries = randomEntries(rng, 50, 40);
        const index = new CullIndex();
        index.build(entries);
        for (let t = 0; t < 200; t++) {
            const vp = randomViewport(rng, 40);
            expect(setsEqual(index.queryVisible(vp), bruteForce(entries, vp))).toBe(true);
        }
    });

    it('matches brute force on large gridded scenes', () => {
        const rng = makeRng(2);
        const entries = randomEntries(rng, 5000, 300);
        const index = new CullIndex();
        index.build(entries);
        for (let t = 0; t < 300; t++) {
            const vp = randomViewport(rng, 300);
            expect(setsEqual(index.queryVisible(vp), bruteForce(entries, vp))).toBe(true);
        }
    });

    it('matches brute force with oversized shapes spanning many cells', () => {
        const rng = makeRng(3);
        const entries = randomEntries(rng, 2000, 200, 0.08);
        const index = new CullIndex();
        index.build(entries);
        for (let t = 0; t < 300; t++) {
            const vp = randomViewport(rng, 200);
            expect(setsEqual(index.queryVisible(vp), bruteForce(entries, vp))).toBe(true);
        }
    });

    it('returns everything for a viewport covering the whole map', () => {
        const rng = makeRng(4);
        const entries = randomEntries(rng, 1000, 100);
        const index = new CullIndex();
        index.build(entries);
        const all: ViewportBounds = {minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6};
        expect(index.queryVisible(all).size).toBe(1000);
    });

    it('returns nothing for a viewport far outside the map', () => {
        const rng = makeRng(5);
        const entries = randomEntries(rng, 1000, 100);
        const index = new CullIndex();
        index.build(entries);
        const far: ViewportBounds = {minX: 1e5, maxX: 1e5 + 10, minY: 1e5, maxY: 1e5 + 10};
        expect(index.queryVisible(far).size).toBe(0);
    });

    it('handles edge-touching boxes inclusively (matches predicate)', () => {
        // A box whose max edge exactly equals the viewport min edge must count.
        const s = shape(0);
        const entries: CullIndexEntry[] = [{shape: s, minX: 0, minY: 0, maxX: 5, maxY: 5}];
        const index = new CullIndex();
        index.build(entries);
        const touching: ViewportBounds = {minX: 5, maxX: 10, minY: 5, maxY: 10};
        expect(index.queryVisible(touching).has(s)).toBe(true);
    });

    it('exposes all indexed shapes', () => {
        const rng = makeRng(6);
        const entries = randomEntries(rng, 400, 50);
        const index = new CullIndex();
        index.build(entries);
        expect(index.getAllShapes().size).toBe(400);
    });

    it('projectBounds is identity for the identity transform', () => {
        expect(projectBounds(1, 2, 3, 4, IDENTITY_TRANSFORM)).toEqual({minX: 1, minY: 2, maxX: 3, maxY: 4});
    });

    it('projectBounds takes the min/max of transformed corners', () => {
        // 90° rotation: (x,y) -> (-y, x). Corners of [0,0]-[2,4] map to a rotated box.
        const rot90: CoordFn = (x, y) => ({x: -y, y: x});
        const b = projectBounds(0, 0, 2, 4, rot90);
        // Use +0 normalisation: Math.max can yield -0, which is numerically 0.
        expect(b.minX).toBe(-4);
        expect(b.minY).toBe(0);
        expect(b.maxX + 0).toBe(0);
        expect(b.maxY).toBe(2);
    });

    it('matches brute force end-to-end through a warped (projected) transform', () => {
        // Build entries in world space, project to scene space, index in scene
        // space, and verify against a scene-space brute force.
        const rng = makeRng(7);
        const iso: CoordFn = (x, y) => ({x: (x - y) * 0.5, y: (x + y) * 0.25});
        const world = randomEntries(rng, 3000, 200);
        const scene: CullIndexEntry[] = world.map(e => {
            const b = projectBounds(e.minX, e.minY, e.maxX, e.maxY, iso);
            return {shape: e.shape, ...b};
        });
        const index = new CullIndex();
        index.build(scene);
        for (let t = 0; t < 300; t++) {
            const vp = randomViewport(rng, 200);
            expect(setsEqual(index.queryVisible(vp), bruteForce(scene, vp))).toBe(true);
        }
    });
});
