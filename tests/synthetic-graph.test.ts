import { describe, it, expect } from 'vitest';
import { MapGraph } from '../src/MapGraph';
import type { Edge, SyntheticGraphInput } from '../src/MapGraph';
import PathFinder from '../src/PathFinder';
import { createTestMapReader } from './helpers';

/**
 * Phase 6 validation: pathfinding can be exercised end-to-end against a
 * hand-crafted graph with no MapReader / JSON fixture in the loop.
 *
 * Layout — a 5-node line graph with a shortcut, all on the z=0 plane:
 *
 *     (1) ── 1 ──> (2) ── 1 ──> (3) ── 1 ──> (4) ── 1 ──> (5)
 *      └────── 10 ──────────────> (5)              ^
 *                                                   │
 *      (6, isolated)
 *
 * Edge weights make the linear path (1→2→3→4→5, total = 4) cheaper than
 * the direct shortcut (1→5, weight 10).
 */
function lineWithShortcut(): SyntheticGraphInput {
    const rooms = [
        { id: 1, x: 0, y: 0, z: 0 },
        { id: 2, x: 1, y: 0, z: 0 },
        { id: 3, x: 2, y: 0, z: 0 },
        { id: 4, x: 3, y: 0, z: 0 },
        { id: 5, x: 4, y: 0, z: 0 },
        { id: 6, x: 99, y: 99, z: 0 }, // disconnected
    ];
    const edges = new Map<number, Edge[]>([
        [1, [{ id: 2, weight: 1 }, { id: 5, weight: 10 }]],
        [2, [{ id: 3, weight: 1 }]],
        [3, [{ id: 4, weight: 1 }]],
        [4, [{ id: 5, weight: 1 }]],
    ]);
    return { rooms, edges };
}

describe('MapGraph.fromSynthetic', () => {
    it('builds adjacency from raw {rooms, edges}', () => {
        const g = MapGraph.fromSynthetic(lineWithShortcut());
        const adj = g.getAdj();
        expect([...adj.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(adj.get(1)!.map(e => e.id).sort((a, b) => a - b)).toEqual([2, 5]);
        expect(adj.get(6)!.length).toBe(0);
    });

    it('skips edges to unknown room ids', () => {
        const g = MapGraph.fromSynthetic({
            rooms: [{ id: 1, x: 0, y: 0, z: 0 }],
            edges: new Map([[1, [{ id: 999, weight: 1 }]]]),
        });
        expect(g.getAdj().get(1)!.length).toBe(0);
    });

    it('computes minEdgeWeight and maxEdgeDistance from inputs', () => {
        const g = MapGraph.fromSynthetic(lineWithShortcut());
        // Min weight: 1. Max distance: 4 (between 1 and 5 along x).
        expect(g.getMinEdgeWeight()).toBe(1);
        expect(g.getMaxEdgeDistance()).toBe(4);
    });

    it('graphDefinition mirrors adj for node-dijkstra', () => {
        const g = MapGraph.fromSynthetic(lineWithShortcut());
        const def = g.getGraphDefinition();
        expect(def['1']).toEqual({ '2': 1, '5': 10 });
        expect(def['6']).toEqual({});
    });

    it('returns synthetic rooms via getRoom (without MapReader)', () => {
        const g = MapGraph.fromSynthetic(lineWithShortcut());
        expect(g.getRoom(3)).toEqual({ id: 3, x: 2, y: 0, z: 0 });
        expect(g.getRoom(999)).toBeUndefined();
    });
});

describe('PathFinder with synthetic MapGraph', () => {
    it('dijkstra finds the cheaper multi-hop path over the heavy shortcut', () => {
        const graph = MapGraph.fromSynthetic(lineWithShortcut());
        const pf = new PathFinder(graph, 'dijkstra');
        // 1→2→3→4→5 (cost 4) beats the 1→5 shortcut (cost 10).
        expect(pf.findPath(1, 5)).toEqual([1, 2, 3, 4, 5]);
    });

    it('astar agrees with dijkstra on the synthetic graph', () => {
        const graph = MapGraph.fromSynthetic(lineWithShortcut());
        const a = new PathFinder(graph, 'astar');
        const d = new PathFinder(graph, 'dijkstra');
        expect(a.findPath(1, 5)).toEqual(d.findPath(1, 5));
    });

    it('returns null for the disconnected node', () => {
        const graph = MapGraph.fromSynthetic(lineWithShortcut());
        expect(new PathFinder(graph, 'dijkstra').findPath(1, 6)).toBeNull();
        expect(new PathFinder(graph, 'astar').findPath(1, 6)).toBeNull();
    });

    it('two PathFinders can share one MapGraph', () => {
        const graph = MapGraph.fromSynthetic(lineWithShortcut());
        const a = new PathFinder(graph, 'dijkstra');
        const b = new PathFinder(graph, 'astar');
        const pa = a.findPath(1, 5);
        const pb = b.findPath(1, 5);
        expect(pa).not.toBeNull();
        expect(pb).not.toBeNull();
        expect(pa![pa!.length - 1]).toBe(5);
        expect(pb![pb!.length - 1]).toBe(5);
    });
});

describe('PathFinder accepts a pre-built MapGraph from a real reader', () => {
    it('produces identical results to the MapReader-based constructor', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);

        const fromReader = new PathFinder(reader, 'dijkstra');
        const fromGraph = new PathFinder(graph, 'dijkstra');

        for (const [from, to] of [[1, 6], [6, 3], [4, 10], [1, 20]]) {
            expect(fromGraph.findPath(from, to)).toEqual(fromReader.findPath(from, to));
        }
    });
});
