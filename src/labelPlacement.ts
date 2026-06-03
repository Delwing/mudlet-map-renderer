/**
 * Point-feature label placement.
 *
 * Given a set of anchored labels (e.g. waypoints on rooms) and obstacles
 * (rooms, exits, already-placed labels), choose for each label the candidate
 * slot around its anchor that best avoids collisions. Pure and deterministic —
 * the same inputs always produce the same layout — so it's reusable beyond
 * waypoints and easy to test.
 *
 * For each slot the label is scanned outward (up to {@link extend}); the spot
 * with the most CLEARANCE — distance to the nearest room, exit line, or other
 * placed label — wins, lightly penalised by how far it had to push. This puts
 * labels in open space, off every line, and only as far out as openness needs.
 * Positions overlapping a room/label are skipped; sitting on an exit just reads
 * as zero clearance. Cardinal-over-diagonal and an optional preferred direction
 * break ties between equally-open slots.
 *
 * Placement is greedy: items are processed in input order and each placed label
 * becomes an obstacle for the ones after it.
 */

export type Direction8 = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Unit vectors per slot, in world space (y-down: "n" is up on screen). */
const DIRS: Record<Direction8, {x: number; y: number}> = {
    n: {x: 0, y: -1}, s: {x: 0, y: 1}, e: {x: 1, y: 0}, w: {x: -1, y: 0},
    ne: {x: Math.SQRT1_2, y: -Math.SQRT1_2}, nw: {x: -Math.SQRT1_2, y: -Math.SQRT1_2},
    se: {x: Math.SQRT1_2, y: Math.SQRT1_2}, sw: {x: -Math.SQRT1_2, y: Math.SQRT1_2},
};
/** Cardinals first so they win ties over diagonals. */
const SLOT_ORDER: Direction8[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const DIAGONALS = new Set<Direction8>(["ne", "nw", "se", "sw"]);

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** An obstacle the placement should avoid. `kind` weights how hard to avoid it. */
export interface Obstacle extends Rect {
    kind?: "room" | "label" | "exit" | string;
}

export interface LabelPlacementItem {
    /** Anchor point (e.g. room centre), world coords. */
    x: number;
    y: number;
    /** Label box size, world units. */
    width: number;
    height: number;
    /** Optional preferred direction — nudges the choice, never forces overlap. */
    preferred?: Direction8;
    /** Optional stable id, echoed back on the result. */
    id?: string | number;
}

export interface PlacedLabel {
    id?: string | number;
    /** Top-left of the placed label box, world coords. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Chosen slot. */
    direction: Direction8;
    /** Leader endpoint on the box edge nearest the anchor (for drawing a connector). */
    leader: {x: number; y: number};
}

/** Per-slot diagnostic from {@link PlaceLabelsOptions.onScored}. */
export interface SlotScore {
    dir: Direction8;
    /** False when no non-overlapping position exists in this slot. */
    valid: boolean;
    /** Clearance (distance to nearest obstacle) at the best position found. */
    clearance: number;
    /** Outward offset of the best position. */
    off: number;
    /** Final cost (lower = better; Infinity when invalid). */
    cost: number;
    /** The label box at the best position. */
    box: Rect;
}

export interface PlaceLabelsOptions {
    /** Gap between the anchor and the near edge of the label box, world units. Default 0.6. */
    offset?: number;
    /** Use only N/S/E/W (4) or all 8 slots. Default 8. */
    slots?: 4 | 8;
    /**
     * How far (world units) a label may be pushed outward along a slot, beyond
     * the base {@link offset}, while searching for the most open spot. 0 keeps
     * labels at the base offset; larger lets them float into open pockets away
     * from rooms/exit lines.
     */
    extend?: number;
    /**
     * Clearance is only rewarded up to this many world units — past it a spot is
     * "open enough" and extra distance isn't worth pushing further for. Defaults
     * to the label's larger side.
     */
    clearCap?: number;
    /**
     * When the best slot's clearance is below this (world units), the room is
     * treated as "surrounded": instead of floating out for a marginal gain, the
     * label sits close at the base offset on an exit, preferring north. Default 0
     * (disabled — always go for max clearance).
     */
    minClearance?: number;
    /**
     * Debug hook — called once per item with the score of every candidate slot
     * and the chosen direction. For visualising/diagnosing placement decisions.
     */
    onScored?: (item: LabelPlacementItem, slots: SlotScore[], chosen: Direction8) => void;
    /** Cost weights (sane defaults; overlap dominates, then openness, then direction). */
    weights?: Partial<typeof DEFAULT_WEIGHTS>;
}

const DEFAULT_WEIGHTS = {
    /**
     * Reward per world unit of clearance (distance from the label box to the
     * nearest room/exit/label), capped at {@link PlaceLabelsOptions.clearCap}.
     * The dominant term — pushes labels into open space, off every line.
     */
    clear: 10,
    /**
     * Cardinal-over-diagonal preference — a TRUE tie-break only. Kept tiny so
     * any real clearance advantage (≳0.03 units) overrides it: a clearly more
     * open diagonal always beats an on-a-line cardinal.
     */
    diagonal: 0.3,
    /** Bonus (subtracted from cost) when a slot matches the item's preferred direction. */
    preferred: 1,
    /**
     * Penalty per world unit the label is pushed out — keeps it close, but small
     * enough not to cancel the clearance gained by pushing into open space.
     */
    distance: 0.05,
};

const CARDINALS: Direction8[] = ["n", "s", "e", "w"];
/** Fallback order for surrounded rooms — north first, then cardinals, then diagonals. */
const SURROUND_ORDER: Direction8[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function intersectionArea(a: Rect, b: Rect): number {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
}

/** Gap between two rectangles (0 if they touch or overlap). */
function rectDistance(a: Rect, b: Rect): number {
    const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
    const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
    return Math.hypot(dx, dy);
}

/**
 * Box for a slot.
 *
 * Cardinals: the box centre sits so the near edge is `offset` from the anchor,
 * centred on the axis.
 *
 * Diagonals: the box is anchored by its room-facing CORNER at `offset` from the
 * anchor, extending outward. This keeps wide labels hugging the corner — a small
 * vertical gap with the width fanning out sideways — instead of the 45° centre
 * projection flinging them far up/down (the width dominates `halfAlong`).
 */
function slotBox(item: LabelPlacementItem, dir: Direction8, offset: number): Rect {
    const v = DIRS[dir];
    if (DIAGONALS.has(dir)) {
        const nx = item.x + v.x * offset; // near corner
        const ny = item.y + v.y * offset;
        return {
            x: v.x < 0 ? nx - item.width : nx,
            y: v.y < 0 ? ny - item.height : ny,
            width: item.width, height: item.height,
        };
    }
    const halfAlong = Math.abs(v.x) * item.width / 2 + Math.abs(v.y) * item.height / 2;
    const d = offset + halfAlong;
    const cx = item.x + v.x * d;
    const cy = item.y + v.y * d;
    return {x: cx - item.width / 2, y: cy - item.height / 2, width: item.width, height: item.height};
}

/**
 * Place each item at its best-scoring slot. Returns one {@link PlacedLabel} per
 * input item, in the same order.
 */
export function placeLabels(
    items: LabelPlacementItem[],
    obstacles: Obstacle[],
    options: PlaceLabelsOptions = {},
): PlacedLabel[] {
    const offset = options.offset ?? 0.6;
    const slotList = (options.slots === 4 ? CARDINALS : SLOT_ORDER);
    const w = {...DEFAULT_WEIGHTS, ...options.weights};

    // Placed labels accumulate as obstacles for later items (greedy).
    const dynamic: Obstacle[] = [];
    const results: PlacedLabel[] = [];

    for (const item of items) {
        const maxExtend = options.extend ?? 0;
        const clearCap = options.clearCap ?? Math.max(item.width, item.height);
        const step = Math.max(0.1, Math.min(item.width, item.height) * 0.5);
        const all = obstacles.concat(dynamic);

        // Coarse pre-filter: only obstacles near this anchor can matter. Drop the
        // waypoint's OWN room (the room obstacle containing the anchor) — a label
        // is meant to sit beside its own room. Exits are kept even when they
        // start at the own room: a label sitting on its room's exit IS bad.
        const reach = offset + Math.max(item.width, item.height) + maxExtend + clearCap;
        const near = all.filter(o =>
            !(o.kind !== "exit" && item.x >= o.x && item.x <= o.x + o.width && item.y >= o.y && item.y <= o.y + o.height) &&
            o.x < item.x + reach && o.x + o.width > item.x - reach &&
            o.y < item.y + reach && o.y + o.height > item.y - reach);

        let best: {box: Rect; dir: Direction8; off: number; cost: number; clearance: number} | undefined;
        const debug: SlotScore[] = [];

        for (const dir of slotList) {
            // Scan outward along the slot; keep the position with the most
            // clearance (distance to the nearest room/exit/label), lightly
            // penalising distance so the label stays as close as openness allows.
            let slotBest: {box: Rect; off: number; value: number; clearance: number} | undefined;
            for (let o = offset; o <= offset + maxExtend + 1e-9; o += step) {
                const box = slotBox(item, dir, o);
                let blocked = false;
                let clearance = Infinity;
                for (const ob of near) {
                    if (ob.kind !== "exit" && intersectionArea(box, ob) > 0) { blocked = true; break; }
                    const d = rectDistance(box, ob);
                    if (d < clearance) clearance = d;
                }
                // Hard obstacle (room/label): can't sit here. Stop scanning further
                // out once we've already found a clear spot (beyond it is worse).
                if (blocked) { if (slotBest) break; else continue; }
                const value = Math.min(clearance, clearCap) - o * w.distance;
                if (!slotBest || value > slotBest.value) slotBest = {box, off: o, value, clearance};
            }
            if (!slotBest) {
                if (options.onScored) debug.push({dir, valid: false, clearance: 0, off: offset, cost: Infinity, box: slotBox(item, dir, offset)});
                continue;
            }

            let dirCost = 0;
            if (item.preferred) {
                if (dir === item.preferred) dirCost -= w.preferred;
            } else if (DIAGONALS.has(dir)) {
                dirCost += w.diagonal;
            }

            const cost = -slotBest.value * w.clear + dirCost;
            if (options.onScored) debug.push({dir, valid: true, clearance: slotBest.clearance, off: slotBest.off, cost, box: slotBest.box});
            if (!best || cost < best.cost) best = {box: slotBest.box, dir, off: slotBest.off, cost, clearance: slotBest.clearance};
        }

        // Fallback (every slot blocked at every distance): sit at the base offset
        // of the first slot so we always emit a placement.
        if (!best) best = {box: slotBox(item, slotList[0], offset), dir: slotList[0], off: offset, cost: 0, clearance: 0};

        // Surrounded: when nothing reaches the minimum clearance, don't float out
        // for a marginal gain — sit CLOSE (base offset) on an exit, preferring
        // north, then the other cardinals, then diagonals.
        if (best.clearance < (options.minClearance ?? 0)) {
            for (const dir of SURROUND_ORDER) {
                const box = slotBox(item, dir, offset);
                if (!near.some(o => o.kind !== "exit" && intersectionArea(box, o) > 0)) {
                    best = {box, dir, off: offset, cost: best.cost, clearance: best.clearance};
                    break;
                }
            }
        }

        options.onScored?.(item, debug, best.dir);

        const v = DIRS[best.dir];
        results.push({
            id: item.id,
            x: best.box.x,
            y: best.box.y,
            width: item.width,
            height: item.height,
            direction: best.dir,
            // Near edge of the box, where a connector to the anchor should end.
            leader: {x: item.x + v.x * best.off, y: item.y + v.y * best.off},
        });
        dynamic.push({...best.box, kind: "label"});
    }

    return results;
}
