import {describe, it, expect, beforeEach} from "vitest";
import {HitTester, computeShapeBbox} from "../src/hit/HitTester";
import type {GroupShape, RectShape, CircleShape, LineShape, PolygonShape} from "../src/scene/Shape";

// ── computeShapeBbox ─────────────────────────────────────────────────────────

describe("computeShapeBbox", () => {
    it("rect at zero offset", () => {
        const rect: RectShape = {type: "rect", x: 2, y: 3, width: 4, height: 5, paint: {}};
        expect(computeShapeBbox(rect, 0, 0)).toEqual({minX: 2, minY: 3, maxX: 6, maxY: 8});
    });

    it("rect with nonzero parent offset", () => {
        const rect: RectShape = {type: "rect", x: 1, y: 1, width: 2, height: 2, paint: {}};
        expect(computeShapeBbox(rect, 10, 20)).toEqual({minX: 11, minY: 21, maxX: 13, maxY: 23});
    });

    it("circle", () => {
        const circle: CircleShape = {type: "circle", cx: 5, cy: 5, radius: 3, paint: {}};
        expect(computeShapeBbox(circle, 0, 0)).toEqual({minX: 2, minY: 2, maxX: 8, maxY: 8});
    });

    it("line — AABB of points", () => {
        const line: LineShape = {type: "line", points: [0, 0, 10, 5, 3, 8], paint: {}};
        const b = computeShapeBbox(line, 0, 0);
        expect(b.minX).toBe(0);
        expect(b.minY).toBe(0);
        expect(b.maxX).toBe(10);
        expect(b.maxY).toBe(8);
    });

    it("polygon — AABB of vertices", () => {
        const poly: PolygonShape = {type: "polygon", vertices: [1, 2, 5, 0, 3, 6], paint: {}};
        const b = computeShapeBbox(poly, 0, 0);
        expect(b.minX).toBe(1);
        expect(b.minY).toBe(0);
        expect(b.maxX).toBe(5);
        expect(b.maxY).toBe(6);
    });

    it("group — union of children bboxes with group origin", () => {
        const group: GroupShape = {
            type: "group",
            x: 10,
            y: 10,
            children: [
                {type: "rect", x: 0, y: 0, width: 2, height: 2, paint: {}},
                {type: "rect", x: 4, y: 4, width: 2, height: 2, paint: {}},
            ],
        };
        const b = computeShapeBbox(group, 0, 0);
        expect(b.minX).toBe(10);
        expect(b.minY).toBe(10);
        expect(b.maxX).toBe(16);
        expect(b.maxY).toBe(16);
    });

    it("empty group returns point bbox at group origin", () => {
        const group: GroupShape = {type: "group", x: 3, y: 7, children: []};
        const b = computeShapeBbox(group, 0, 0);
        expect(b).toEqual({minX: 3, minY: 7, maxX: 3, maxY: 7});
    });
});

// ── HitTester ────────────────────────────────────────────────────────────────

describe("HitTester — basic flat hit test", () => {
    let tester: HitTester;
    const roomSize = 1;

    beforeEach(() => {
        tester = new HitTester();
    });

    function makeRoomGroup(x: number, y: number, id: number, room?: object): GroupShape {
        const rs = roomSize;
        return {
            type: "group",
            x: x - rs / 2,
            y: y - rs / 2,
            layer: "room",
            hit: {kind: "room", id, payload: room ?? {id, x, y}},
            children: [
                {type: "rect", x: 0, y: 0, width: rs, height: rs, paint: {fill: "red"}},
            ],
        };
    }

    it("returns null when empty", () => {
        tester.build([], roomSize);
        expect(tester.pick(0, 0)).toBeNull();
    });

    it("picks a room at its center", () => {
        const room = {id: 1, x: 5, y: 5};
        tester.build([makeRoomGroup(5, 5, 1, room)], roomSize);
        const hit = tester.pick(5, 5);
        expect(hit).not.toBeNull();
        expect(hit!.kind).toBe("room");
        expect(hit!.id).toBe(1);
        expect(hit!.payload).toBe(room);
    });

    it("picks the nearest of two overlapping rooms", () => {
        tester.build([
            makeRoomGroup(5, 5, 1),
            makeRoomGroup(5.2, 5, 2),
        ], roomSize);
        // Closer to room 2
        const hit = tester.pick(5.2, 5);
        expect(hit!.id).toBe(2);
        // Closer to room 1
        const hit2 = tester.pick(4.9, 5);
        expect(hit2!.id).toBe(1);
    });

    it("returns null when click is farther than roomSize from any room", () => {
        tester.build([makeRoomGroup(0, 0, 1)], roomSize);
        // roomSize margin = 1; click at (2, 0) is 2 units away from center
        expect(tester.pick(2, 0)).toBeNull();
    });

    it("picks within the roomSize margin from the room's edge", () => {
        tester.build([makeRoomGroup(0, 0, 1)], roomSize);
        // Room rect is [-0.5, 0.5]; rooms have a margin of 1.0×roomSize
        // measured from the rect edge (point-to-rect distance, not point-to-center).
        expect(tester.pick(0.9, 0)).not.toBeNull();   // inside the rect
        expect(tester.pick(1.4, 0)).not.toBeNull();   // 0.9 from edge — within margin
        expect(tester.pick(1.6, 0)).toBeNull();       // 1.1 from edge — outside margin
    });

    it("findRoomAtPoint returns the Room payload", () => {
        const room = {id: 42, x: 3, y: 7} as unknown as MapData.Room;
        tester.build([makeRoomGroup(3, 7, 42, room)], roomSize);
        const found = tester.findRoomAtPoint(3, 7);
        expect(found).toBe(room);
    });

    it("findRoomAtPoint returns null when no room nearby", () => {
        tester.build([makeRoomGroup(0, 0, 1)], roomSize);
        expect(tester.findRoomAtPoint(100, 100)).toBeNull();
    });

    it("clear() removes all entries", () => {
        tester.build([makeRoomGroup(0, 0, 1)], roomSize);
        tester.clear();
        expect(tester.pick(0, 0)).toBeNull();
    });

    it("rebuilding replaces old entries", () => {
        tester.build([makeRoomGroup(0, 0, 1)], roomSize);
        tester.build([makeRoomGroup(10, 10, 99)], roomSize);
        expect(tester.pick(0, 0)).toBeNull();
        expect(tester.pick(10, 10)!.id).toBe(99);
    });

    it("picks a shape without a group wrapper (bare rect with hit)", () => {
        const shape: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 2, height: 2,
            paint: {},
            hit: {kind: "label", id: "lbl-1"},
        };
        tester.build([shape], roomSize);
        const hit = tester.pick(1, 1); // center of the rect
        expect(hit!.kind).toBe("label");
        expect(hit!.id).toBe("lbl-1");
    });

    it("ignores shapes without hit annotation", () => {
        const shape: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 2, height: 2,
            paint: {},
        };
        tester.build([shape], roomSize);
        expect(tester.pick(1, 1)).toBeNull();
    });
});

describe("HitTester — coordinate transform (iso-like)", () => {
    it("uses the coordTransform when building the spatial index", () => {
        const tester = new HitTester();
        // Simple transform: shift everything +100 in X
        const shift = (x: number, y: number) => ({x: x + 100, y});

        const group: GroupShape = {
            type: "group",
            x: -0.5, y: -0.5,
            layer: "room",
            hit: {kind: "room", id: 7, payload: {id: 7}},
            children: [{type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}}],
        };
        tester.build([group], 1, shift);

        // In shifted space, the room center is at (0 + 100, 0) = (100, 0)
        expect(tester.pick(100, 0)!.id).toBe(7);
        // In un-shifted space the room is gone
        expect(tester.pick(0, 0)).toBeNull();
    });
});

describe("HitTester — nested group hit annotation", () => {
    it("picks hit annotation on a nested group", () => {
        const tester = new HitTester();
        const outer: GroupShape = {
            type: "group",
            x: 0, y: 0,
            children: [
                {
                    type: "group",
                    x: 5, y: 5,
                    hit: {kind: "exit", id: 99},
                    children: [
                        {type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}},
                    ],
                },
            ],
        };
        tester.build([outer], 1);
        const hit = tester.pick(5.5, 5.5);
        expect(hit!.kind).toBe("exit");
        expect(hit!.id).toBe(99);
    });
});

// ── Polyline-aware distance ──────────────────────────────────────────────────

describe("HitTester — polyline distance", () => {
    it("hits long line near its midpoint, but not in the bbox interior off-line", () => {
        const tester = new HitTester();
        const exit: LineShape = {
            type: "line",
            points: [0, 0, 100, 0],
            paint: {},
            hit: {kind: "exit", id: 1},
        };
        tester.build([exit], 1);
        // On the line near midpoint
        expect(tester.pick(50, 0)).not.toBeNull();
        // 0.3 above the line — within the 0.35 default exit margin
        expect(tester.pick(50, 0.3)).not.toBeNull();
        // 0.5 above the line — outside the 0.35 exit margin
        expect(tester.pick(50, 0.5)).toBeNull();
    });

    it("diagonal line: distance is to the segment, not the bbox", () => {
        const tester = new HitTester();
        const line: LineShape = {
            type: "line",
            points: [0, 0, 10, 10],
            paint: {},
            // override default margin so threshold is predictable
            hit: {kind: "exit", id: 7, margin: 0.5},
        };
        tester.build([line], 1);
        // (5, 5) is on the line — distance 0
        expect(tester.pick(5, 5)!.distance).toBeCloseTo(0);
        // (10, 0) is in the bbox but ~7.07 from the segment — far outside margin
        expect(tester.pick(10, 0)).toBeNull();
    });

    it("polyline picks segment-closest distance across multiple segments", () => {
        const tester = new HitTester();
        const line: LineShape = {
            type: "line",
            points: [0, 0, 5, 0, 5, 5],  // L-shape
            paint: {},
            hit: {kind: "exit", id: 1, margin: 0.5},
        };
        tester.build([line], 1);
        // On the horizontal arm
        expect(tester.pick(2, 0)).not.toBeNull();
        // On the vertical arm
        expect(tester.pick(5, 2)).not.toBeNull();
        // In the inner corner area but off both segments
        expect(tester.pick(0, 5)).toBeNull();
    });
});

// ── pickAll ──────────────────────────────────────────────────────────────────

describe("HitTester — pickAll", () => {
    it("returns all hits at point sorted by priority then distance", () => {
        const tester = new HitTester();
        const room: GroupShape = {
            type: "group",
            x: -0.5, y: -0.5,
            hit: {kind: "room", id: 1, payload: {id: 1}},
            children: [{type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}}],
        };
        const exit: LineShape = {
            type: "line",
            points: [-2, 0, 2, 0],
            paint: {},
            hit: {kind: "exit", id: 50},
        };
        tester.build([exit, room], 1);
        const hits = tester.pickAll(0, 0);
        // Both hit at (0,0). Room has higher default priority.
        expect(hits.length).toBe(2);
        expect(hits[0].kind).toBe("room");
        expect(hits[1].kind).toBe("exit");
    });

    it("respects explicit priority override", () => {
        const tester = new HitTester();
        const a: RectShape = {
            type: "rect", x: 0, y: 0, width: 2, height: 2, paint: {},
            hit: {kind: "label", id: "a", priority: 10},
        };
        const b: RectShape = {
            type: "rect", x: 0, y: 0, width: 2, height: 2, paint: {},
            hit: {kind: "label", id: "b", priority: 50},
        };
        tester.build([a, b], 1);
        const hits = tester.pickAll(1, 1);
        expect(hits.length).toBe(2);
        expect(hits[0].id).toBe("b"); // higher priority first
    });

    it("returns empty array when nothing in range", () => {
        const tester = new HitTester();
        const room: GroupShape = {
            type: "group",
            x: -0.5, y: -0.5,
            hit: {kind: "room", id: 1},
            children: [{type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}}],
        };
        tester.build([room], 1);
        expect(tester.pickAll(100, 100)).toEqual([]);
    });
});

// ── pickInRect ───────────────────────────────────────────────────────────────

describe("HitTester — pickInRect", () => {
    function makeRoom(x: number, y: number, id: number): GroupShape {
        return {
            type: "group",
            x: x - 0.5, y: y - 0.5,
            hit: {kind: "room", id, payload: {id, x, y}},
            children: [{type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}}],
        };
    }

    it("returns rooms whose center is inside the rect (marquee selection)", () => {
        const tester = new HitTester();
        tester.build([
            makeRoom(0, 0, 1),
            makeRoom(5, 0, 2),
            makeRoom(10, 0, 3),
        ], 1);
        const hits = tester.pickInRect(-1, -1, 6, 1);
        const ids = hits.map(h => h.id).sort();
        expect(ids).toEqual([1, 2]);
    });

    it("filters by kind", () => {
        const tester = new HitTester();
        const room = makeRoom(0, 0, 1);
        const label: RectShape = {
            type: "rect", x: 0.5, y: 0.5, width: 1, height: 1, paint: {},
            hit: {kind: "label", id: "L1"},
        };
        tester.build([room, label], 1);
        const rooms = tester.pickInRect(-2, -2, 2, 2, ["room"]);
        expect(rooms.length).toBe(1);
        expect(rooms[0].kind).toBe("room");
        const labels = tester.pickInRect(-2, -2, 2, 2, ["label"]);
        expect(labels.length).toBe(1);
        expect(labels[0].kind).toBe("label");
    });

    it("normalizes inverted rect coordinates", () => {
        const tester = new HitTester();
        tester.build([makeRoom(5, 5, 1)], 1);
        // maxX < minX, maxY < minY — should still hit
        const hits = tester.pickInRect(10, 10, 0, 0);
        expect(hits.length).toBe(1);
    });
});

// ── Margin override ──────────────────────────────────────────────────────────

describe("HitTester — HitInfo.margin override", () => {
    it("uses HitInfo.margin when provided", () => {
        const tester = new HitTester();
        const tinyZone: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 0.1, height: 0.1,
            paint: {},
            hit: {kind: "stub", id: 1, margin: 0.1},
        };
        tester.build([tinyZone], 1);
        // Inside the rect
        expect(tester.pick(0.05, 0.05)).not.toBeNull();
        // 0.05 outside, within 0.1 * 1 margin
        expect(tester.pick(0.15, 0.05)).not.toBeNull();
        // 0.2 outside — beyond the 0.1 margin
        expect(tester.pick(0.3, 0.05)).toBeNull();
    });
});
