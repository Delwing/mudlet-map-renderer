import { describe, it, expect } from 'vitest';
import { MapGraph } from '../src/MapGraph';
import { createTestMapReader } from './helpers';

describe('MapGraph', () => {
    it('builds adjacency for all rooms', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Every room should have an entry (even if empty edges)
        expect(adj.size).toBe(19);
    });

    it('connected rooms have edges', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 1 has exits: north→2, east→3, south→5, west→4, up→10
        const edges1 = adj.get(1)!;
        const targets = edges1.map(e => e.id);
        expect(targets).toContain(2);
        expect(targets).toContain(3);
        expect(targets).toContain(5);
        expect(targets).toContain(4);
        expect(targets).toContain(10);
    });

    it('isolated room has no edges', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 12 has no exits
        const edges12 = adj.get(12)!;
        expect(edges12.length).toBe(0);
    });

    it('respects exit weights', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 8 has exitWeight ne=5
        const edges8 = adj.get(8)!;
        const neEdge = edges8.find(e => e.id === 4);
        expect(neEdge).toBeDefined();
        expect(neEdge!.weight).toBe(5);
    });

    it('respects exitLocks', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 15 has exitLocks=[5] (5=west), so west→14 should be excluded
        const edges15 = adj.get(15)!;
        const westEdge = edges15.find(e => e.id === 14 && e.weight > 0);
        // Room 15 also has specialExit "tunnel"→14, locked via mSpecialExitLocks=[14]
        // So neither regular west nor special "tunnel" should reach room 14
        const anyTo14 = edges15.filter(e => e.id === 14);
        expect(anyTo14.length).toBe(0);
    });

    it('includes special exits', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 4 has specialExit "climb tree"→10
        const edges4 = adj.get(4)!;
        const targets = edges4.map(e => e.id);
        expect(targets).toContain(10);
    });

    it('cross-area exits are included', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        // Room 5 (area 1) has south→20 (area 2)
        const edges5 = adj.get(5)!;
        expect(edges5.map(e => e.id)).toContain(20);
    });

    it('graphDefinition matches adj', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        const adj = graph.getAdj();
        const def = graph.getGraphDefinition();
        // Same number of entries
        expect(Object.keys(def).length).toBe(adj.size);
        // Room 1's connections should match
        const def1 = def['1'];
        const adj1 = adj.get(1)!;
        expect(Object.keys(def1).length).toBe(adj1.length);
    });

    it('maxEdgeDistance and minEdgeWeight are reasonable', () => {
        const reader = createTestMapReader();
        const graph = new MapGraph(reader);
        expect(graph.getMaxEdgeDistance()).toBeGreaterThan(0);
        expect(graph.getMinEdgeWeight()).toBeGreaterThan(0);
        expect(graph.getMinEdgeWeight()).toBeLessThanOrEqual(5);
    });
});
