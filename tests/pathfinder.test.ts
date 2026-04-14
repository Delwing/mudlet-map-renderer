import { describe, it, expect } from 'vitest';
import PathFinder from '../src/PathFinder';
import { createTestMapReader } from './helpers';

describe('PathFinder', () => {
    describe('dijkstra', () => {
        it('finds direct path between adjacent rooms', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            const path = pf.findPath(1, 2);
            expect(path).toEqual([1, 2]);
        });

        it('finds multi-hop path', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // 6 → 2 → 1 → 3
            const path = pf.findPath(6, 3);
            expect(path).not.toBeNull();
            expect(path![0]).toBe(6);
            expect(path![path!.length - 1]).toBe(3);
            expect(path!).toContain(1); // must go through center
        });

        it('returns [from] when from === to', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            expect(pf.findPath(1, 1)).toEqual([1]);
        });

        it('returns null for disconnected rooms', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // Room 12 has no exits
            const path = pf.findPath(1, 12);
            expect(path).toBeNull();
        });

        it('returns null for nonexistent rooms', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            expect(pf.findPath(1, 999)).toBeNull();
            expect(pf.findPath(999, 1)).toBeNull();
        });

        it('finds path across areas via cross-area exits', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // Room 5 (area 1) → south → Room 20 (area 2)
            const path = pf.findPath(1, 20);
            expect(path).not.toBeNull();
            expect(path!).toContain(5);
            expect(path!).toContain(20);
        });

        it('finds path using special exits', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // Room 4 has special exit "climb tree" → room 10
            const path = pf.findPath(4, 10);
            expect(path).not.toBeNull();
            expect(path![0]).toBe(4);
            expect(path![path!.length - 1]).toBe(10);
        });

        it('respects exit weights when choosing paths', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // Room 8 has exitWeight ne=5 (heavy), so path from 8 to 1 should still work
            const path = pf.findPath(8, 1);
            expect(path).not.toBeNull();
            expect(path![0]).toBe(8);
            expect(path![path!.length - 1]).toBe(1);
        });

        it('finds path through up/down exits', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            // 1 → up → 10 (Rooftop)
            const path = pf.findPath(1, 10);
            expect(path).not.toBeNull();
            // Direct path: 1 → 10
            expect(path!.length).toBeLessThanOrEqual(3);
        });

        it('caches results', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            const path1 = pf.findPath(1, 6);
            const path2 = pf.findPath(1, 6);
            expect(path1).toEqual(path2);
        });
    });

    describe('astar', () => {
        it('finds same path as dijkstra for simple cases', () => {
            const reader = createTestMapReader();
            const dijkstra = new PathFinder(reader, 'dijkstra');
            const astar = new PathFinder(reader, 'astar');

            const dPath = dijkstra.findPath(6, 3);
            const aPath = astar.findPath(6, 3);
            expect(aPath).not.toBeNull();
            expect(aPath!.length).toBe(dPath!.length);
            expect(aPath![0]).toBe(6);
            expect(aPath![aPath!.length - 1]).toBe(3);
        });

        it('returns null for disconnected rooms', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'astar');
            expect(pf.findPath(1, 12)).toBeNull();
        });

        it('finds cross-area path', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'astar');
            const path = pf.findPath(1, 21);
            expect(path).not.toBeNull();
            expect(path![path!.length - 1]).toBe(21);
        });
    });

    describe('algorithm switching', () => {
        it('clears cache when switching algorithm', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            expect(pf.algorithm).toBe('dijkstra');

            pf.findPath(1, 6); // populate cache

            pf.setAlgorithm('astar');
            expect(pf.algorithm).toBe('astar');

            // Should still find valid path (from fresh computation)
            const path = pf.findPath(1, 6);
            expect(path).not.toBeNull();
        });

        it('no-op when setting same algorithm', () => {
            const reader = createTestMapReader();
            const pf = new PathFinder(reader, 'dijkstra');
            pf.findPath(1, 2); // populate cache
            pf.setAlgorithm('dijkstra'); // same algo, cache should remain
            // Still works
            expect(pf.findPath(1, 2)).toEqual([1, 2]);
        });
    });
});
