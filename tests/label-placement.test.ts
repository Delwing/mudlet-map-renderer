import {describe, expect, it} from "vitest";
import {placeLabels, type Obstacle, type LabelPlacementItem} from "../src/labelPlacement";

const label = (x: number, y: number, extra: Partial<LabelPlacementItem> = {}): LabelPlacementItem =>
    ({x, y, width: 2, height: 0.8, ...extra});

const room = (x: number, y: number): Obstacle =>
    ({x: x - 0.5, y: y - 0.5, width: 1, height: 1, kind: "room"});

describe("placeLabels", () => {
    it("places an isolated label in a cardinal slot (deterministic)", () => {
        const [p] = placeLabels([label(0, 0)], []);
        expect(["n", "s", "e", "w"]).toContain(p.direction);
        // No obstacles, cardinals tie → first in canonical order wins.
        expect(p.direction).toBe("n");
    });

    it("avoids the sides that have neighbouring rooms", () => {
        // Rooms to the north and east; the label must steer away from both.
        const obstacles = [room(0, -1.5), room(1.5, 0)];
        const [p] = placeLabels([label(0, 0)], obstacles);
        expect(["n", "ne", "e"]).not.toContain(p.direction);
    });

    it("prefers the open side near a map edge (openness tiebreak)", () => {
        // A wall of rooms to the east; west is open. With no immediate overlap on
        // n/s/w, openness should still push the label away from the crowded east.
        const obstacles = [room(2, -1), room(2, 0), room(2, 1), room(3, 0)];
        const [p] = placeLabels([label(0, 0)], obstacles);
        expect(p.direction).not.toBe("e");
    });

    it("avoids a cardinal whose neighbourhood holds a room (no overlap)", () => {
        // A room sits just south, beyond the label (in the gap), not overlapping
        // it. South should lose to a side whose neighbourhood is clear.
        const [p] = placeLabels([label(0, 0)], [room(0, 2)]);
        expect(p.direction).not.toBe("s");
    });

    it("honours a preferred direction when it doesn't collide", () => {
        const [p] = placeLabels([label(0, 0, {preferred: "se"})], []);
        expect(p.direction).toBe("se");
    });

    it("does not let a preferred direction force an overlap with a room", () => {
        // Room sits exactly where the 'e' label would go; prefer 'e' anyway.
        const obstacles = [room(2, 0)];
        const [p] = placeLabels([label(0, 0, {preferred: "e"})], obstacles);
        expect(p.direction).not.toBe("e");
    });

    it("treats exits as soft — avoids them only when a clear slot exists", () => {
        // An exit blocks the north; the label should pick a non-overlapping slot.
        const exit: Obstacle = {x: -1, y: -2, width: 2, height: 1, kind: "exit"};
        const [p] = placeLabels([label(0, 0)], [exit]);
        expect(p.direction).not.toBe("n");
    });

    it("steers toward the open side away from a cluster of rooms", () => {
        // Rooms packed to the west; east is open.
        const rooms = [room(-2, -2), room(-2, 0), room(-2, 2), room(-3, 0)];
        const [p] = placeLabels([label(0, 0)], rooms);
        expect(["e", "ne", "se"]).toContain(p.direction);
    });

    it("avoids the slot lying on an exit line (zero clearance)", () => {
        // A horizontal exit runs east from the anchor; the 'e' slot sits right on
        // it (clearance 0), so any clearer slot must beat it.
        const exit: Obstacle = {x: 0, y: -0.03, width: 8, height: 0.06, kind: "exit"};
        const [p] = placeLabels([label(0, 0)], [exit]);
        expect(p.direction).not.toBe("e");
    });

    it("keeps two nearby labels from stacking", () => {
        const [a, b] = placeLabels([label(0, 0), label(0, 0.1)], []);
        const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        expect(overlapX * overlapY).toBe(0);
    });

    it("stays at the base offset in open space (no needless floating)", () => {
        // Clearance is already maxed at the base; distance penalty keeps it close.
        const base = placeLabels([label(0, 0)], [], {offset: 0.6})[0];
        const withExtend = placeLabels([label(0, 0)], [], {offset: 0.6, extend: 3})[0];
        expect(Math.hypot(withExtend.leader.x, withExtend.leader.y))
            .toBeCloseTo(Math.hypot(base.leader.x, base.leader.y), 6);
    });

    it("floats out past exit lines into open space when extend allows", () => {
        // A box of thin exit lines rings the anchor; open beyond it. Extend lets
        // the label push past the ring to a clearer spot further out.
        const small = {x: 0, y: 0, width: 0.6, height: 0.4};
        const ring: Obstacle[] = [
            {x: -1.2, y: -1.2, width: 2.4, height: 0.06, kind: "exit"},
            {x: -1.2, y: 1.14, width: 2.4, height: 0.06, kind: "exit"},
            {x: -1.2, y: -1.2, width: 0.06, height: 2.4, kind: "exit"},
            {x: 1.14, y: -1.2, width: 0.06, height: 2.4, kind: "exit"},
        ];
        const base = placeLabels([{...small}], ring, {offset: 0.4, clearCap: 3})[0];
        const ext = placeLabels([{...small}], ring, {offset: 0.4, extend: 3, clearCap: 3})[0];
        expect(Math.hypot(ext.leader.x, ext.leader.y))
            .toBeGreaterThan(Math.hypot(base.leader.x, base.leader.y));
    });

    it("never pushes a label beyond the extend budget", () => {
        const p = placeLabels([label(0, 0)], [room(0, 2)], {offset: 0.6, extend: 2})[0];
        // Leader sits at offset+off along the slot; off is capped at offset+extend.
        expect(Math.hypot(p.leader.x, p.leader.y)).toBeLessThanOrEqual(0.6 + 2 + 1e-6);
    });

    it("echoes ids and emits a leader point toward the anchor", () => {
        const [p] = placeLabels([label(5, 5, {id: "shop"})], []);
        expect(p.id).toBe("shop");
        // Leader sits between the anchor and the box.
        expect(p.leader).toBeDefined();
    });
});
