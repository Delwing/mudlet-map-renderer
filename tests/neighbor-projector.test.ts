import { describe, it, expect } from 'vitest';
import { computeNeighborSpill, spillPositionMap, ProjectedMapReader, projectRoom } from '../src/scene/NeighborProjector';
import { createTestMapReader } from './helpers';

// Fixture fact (see map-graph.test.ts): room 5 (area 1) has a south exit to
// room 20 (area 2). South advances +1 on y, and the boundary crossing uses a
// 2-unit gap, so projected room 20 sits two steps south of room 5's position.
const BOUNDARY_GAP = 2;
describe('computeNeighborSpill', () => {
    it('projects a neighbouring-area room south of the crossing exit', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20);

        expect(spill).toBeDefined();
        const ghost = spill!.rooms.find(r => r.room.id === 20);
        expect(ghost).toBeDefined();
        // South exit: same x, and at least the boundary gap below (the overlap
        // resolver may push it further south to clear the current area).
        expect(ghost!.x).toBe(r5.x);
        expect(ghost!.y).toBeGreaterThanOrEqual(r5.y + BOUNDARY_GAP);
    });

    it('only collects rooms from other areas', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20);

        expect(spill).toBeDefined();
        for (const ghost of spill!.rooms) {
            expect(ghost.room.area).not.toBe(1);
        }
    });

    it('emits a connector edge from the boundary room to the ghost', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20)!;
        const ghost = spill.rooms.find(r => r.room.id === 20)!;

        const edge = spill.edges.find(e =>
            (e.ax === r5.x && e.ay === r5.y && e.bx === ghost.x && e.by === ghost.y) ||
            (e.bx === r5.x && e.by === r5.y && e.ax === ghost.x && e.ay === ghost.y));
        expect(edge).toBeDefined();
    });


    it('every connector edge touches a spilled room', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20)!;

        const ghostAt = new Set(spill.rooms.map(g => `${g.x},${g.y}`));
        // No edge runs purely between two current-area rooms — those exits belong
        // to the main scene pass. Each connector must touch at least one ghost.
        for (const e of spill.edges) {
            const touches = ghostAt.has(`${e.ax},${e.ay}`) || ghostAt.has(`${e.bx},${e.by}`);
            expect(touches).toBe(true);
        }
    });

    it('omits rooms the visibility predicate hides', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20, room => room.id !== 20);
        // Room 20 is filtered out; it must not appear as a spilled room.
        if (spill) expect(spill.rooms.find(r => r.room.id === 20)).toBeUndefined();
    });

    it('returns undefined when nothing visible spills across', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        // Hide every neighbouring-area room — nothing should spill.
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 20, room => room.area === 1);
        expect(spill).toBeUndefined();
    });

    it('respects the step budget', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        // Reachable but only via more than one step from room 5 — with a budget
        // of 1, only the immediate crossing (room 20) can appear.
        const spill = computeNeighborSpill(reader, 1, r5.z, 5, 1);
        expect(spill!.rooms.every(r => r.room.id === 20 || r.room.area !== 1)).toBe(true);
    });

    it('returns undefined when there is nothing across a boundary', () => {
        const reader = createTestMapReader();
        // Room 12 is isolated (no exits) — no spill possible.
        const r12 = reader.getRoom(12);
        const spill = computeNeighborSpill(reader, r12.area, r12.z, 12, 20);
        expect(spill).toBeUndefined();
    });

    it('returns undefined for a zero step budget', () => {
        const reader = createTestMapReader();
        const r5 = reader.getRoom(5);
        expect(computeNeighborSpill(reader, 1, r5.z, 5, 0)).toBeUndefined();
    });
});

describe('projectRoom', () => {
    it('offsets coordinates and custom-line points, rewriting area/z', () => {
        const room = {
            id: 1, x: 5, y: 5, area: 2, z: 3,
            exits: {}, specialExits: {},
            customLines: {
                tunnel: {points: [{x: 6, y: 7}], attributes: {color: {r: 1, g: 2, b: 3}}},
            },
        } as unknown as MapData.Room;

        const c = projectRoom(room, 10, 8, 1, 0); // dx = +5, dy = +3
        expect([c.x, c.y, c.area, c.z]).toEqual([10, 8, 1, 0]);
        // World shift (dx, dy): point.x += dx, point.y -= dy (world-y is negated).
        expect(c.customLines.tunnel.points[0]).toEqual({x: 11, y: 4});
        // The source room is untouched.
        expect(room.customLines.tunnel.points[0]).toEqual({x: 6, y: 7});
    });
});

describe('ProjectedMapReader', () => {
    it('reports spilled rooms at projected coords in the current area', () => {
        const base = createTestMapReader();
        const r5 = base.getRoom(5);
        const spill = computeNeighborSpill(base, 1, r5.z, 5, 20)!;
        const reader = new ProjectedMapReader(base, 1, r5.z, spillPositionMap(spill));

        const ghost = spill.rooms.find(r => r.room.id === 20)!;
        const projected = reader.getRoom(20);
        expect(projected.x).toBe(ghost.x);
        expect(projected.y).toBe(ghost.y);
        // Rewritten to the current area/plane so visibility checks accept it.
        expect(projected.area).toBe(1);
        expect(projected.z).toBe(r5.z);
        // Real reader is untouched.
        expect(base.getRoom(20).area).toBe(2);
    });

    it('passes non-spilled rooms straight through', () => {
        const base = createTestMapReader();
        const r5 = base.getRoom(5);
        const reader = new ProjectedMapReader(base, 1, r5.z, spillPositionMap(
            computeNeighborSpill(base, 1, r5.z, 5, 20)!,
        ));
        const real = base.getRoom(5);
        const through = reader.getRoom(5);
        expect(through.x).toBe(real.x);
        expect(through.y).toBe(real.y);
        expect(through.area).toBe(real.area);
    });
});
