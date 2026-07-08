/**
 * CullIndex — uniform-grid spatial index for viewport culling.
 *
 * Replaces the historical O(N) linear scan (every room + exit AABB-tested
 * against the viewport on every frame) with an O(visible-cells) query. Built
 * once per scene rebuild; queried once per camera change.
 *
 * Design notes:
 *  - Entries store **scene-space** AABBs (already projected through the active
 *    style's world→scene transform), so a query needs zero per-frame transform
 *    math even under warped styles like Isometric. The projection happens once
 *    at build time (see {@link projectBounds}).
 *  - Each entry is inserted into every grid cell its AABB overlaps, so an exit
 *    polyline that straddles a cell boundary is found from either side (no
 *    popping at edges).
 *  - Entries whose AABB spans more cells than {@link MAX_SPAN_CELLS} (very long
 *    cross-area exit arrows, full-width labels) go into an `oversized` bucket
 *    that is always tested — this bounds insertion cost and keeps the grid from
 *    degenerating when one giant shape would otherwise touch thousands of cells.
 *  - Below {@link LINEAR_THRESHOLD} entries the index falls back to a plain
 *    linear scan: the grid's bookkeeping isn't worth it for small scenes, and
 *    the result is identical.
 *
 * The precise in-viewport test is inclusive on every edge and matches
 * `buildCullingVisibilityMap` exactly, so swapping the linear scan for this
 * index does not change which shapes are considered visible.
 */

import type {Shape} from "../scene/Shape";
import type {ViewportBounds} from "../types/Settings";
import type {CoordFn} from "../coord/CoordFn";
import {IDENTITY_TRANSFORM} from "../coord/CoordFn";

/** One indexed shape with its scene-space axis-aligned bounding box. */
export interface CullIndexEntry {
    shape: Shape;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Scenes smaller than this skip the grid and use a linear scan. */
const LINEAR_THRESHOLD = 256;
/** Aim for roughly this many entries per grid cell when sizing the grid. */
const TARGET_PER_CELL = 2;
/** Entries whose AABB touches more cells than this go in the oversized bucket. */
const MAX_SPAN_CELLS = 32;
/** Hard cap on total grid cells, to bound memory on sparse-but-huge maps. */
const MAX_CELLS = 1 << 20;

export class CullIndex {
    private entries: CullIndexEntry[] = [];
    private allShapes: Set<Shape> = new Set();

    private linear = true;
    private originX = 0;
    private originY = 0;
    private cellSize = 1;
    private cols = 0;
    private rows = 0;
    /** Per-cell lists of entry indices (row-major, length cols*rows). */
    private cells: number[][] = [];
    /** Indices of entries too large to grid — always tested. */
    private oversized: number[] = [];

    /** Per-query dedup stamps so a multi-cell entry is tested at most once. */
    private stamp: Int32Array = new Int32Array(0);
    private queryGen = 0;

    /**
     * (Re)build the index from scene-space entries. `entries` is retained by
     * reference; callers should not mutate it afterwards.
     */
    build(entries: CullIndexEntry[]): void {
        this.entries = entries;
        this.allShapes = new Set(entries.map(e => e.shape));
        const n = entries.length;

        if (n < LINEAR_THRESHOLD) {
            this.linear = true;
            return;
        }
        this.linear = false;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const e of entries) {
            if (e.minX < minX) minX = e.minX;
            if (e.minY < minY) minY = e.minY;
            if (e.maxX > maxX) maxX = e.maxX;
            if (e.maxY > maxY) maxY = e.maxY;
        }
        const width = Math.max(maxX - minX, 1e-6);
        const height = Math.max(maxY - minY, 1e-6);

        // Target ~TARGET_PER_CELL entries per cell: cellSize ≈ sqrt(area / cells).
        let cell = Math.sqrt((width * height) / Math.max(n / TARGET_PER_CELL, 1));
        if (!isFinite(cell) || cell <= 0) cell = Math.max(width, height);

        let cols = Math.max(1, Math.ceil(width / cell));
        let rows = Math.max(1, Math.ceil(height / cell));
        // Grow the cell if the grid would be too large (sparse, far-flung rooms).
        while (cols * rows > MAX_CELLS) {
            cell *= 2;
            cols = Math.max(1, Math.ceil(width / cell));
            rows = Math.max(1, Math.ceil(height / cell));
        }

        this.originX = minX;
        this.originY = minY;
        this.cellSize = cell;
        this.cols = cols;
        this.rows = rows;
        this.cells = Array.from({length: cols * rows}, () => [] as number[]);
        this.oversized = [];
        this.stamp = new Int32Array(n);
        this.queryGen = 0;

        for (let i = 0; i < n; i++) {
            const e = entries[i];
            const cx0 = this.clampCol(Math.floor((e.minX - minX) / cell));
            const cx1 = this.clampCol(Math.floor((e.maxX - minX) / cell));
            const cy0 = this.clampRow(Math.floor((e.minY - minY) / cell));
            const cy1 = this.clampRow(Math.floor((e.maxY - minY) / cell));
            const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
            if (span > MAX_SPAN_CELLS) {
                this.oversized.push(i);
                continue;
            }
            for (let cy = cy0; cy <= cy1; cy++) {
                const rowBase = cy * cols;
                for (let cx = cx0; cx <= cx1; cx++) {
                    this.cells[rowBase + cx].push(i);
                }
            }
        }
    }

    /** Shapes known to this index (i.e. cullable). Order is build order. */
    getAllShapes(): ReadonlySet<Shape> {
        return this.allShapes;
    }

    /**
     * Return the set of shapes whose AABB intersects `viewport`. Inclusive on
     * every edge, matching `buildCullingVisibilityMap`.
     */
    queryVisible(viewport: ViewportBounds): Set<Shape> {
        const visible = new Set<Shape>();
        const {minX: vMinX, maxX: vMaxX, minY: vMinY, maxY: vMaxY} = viewport;

        if (this.linear) {
            for (const e of this.entries) {
                if (e.maxX >= vMinX && e.minX <= vMaxX && e.maxY >= vMinY && e.minY <= vMaxY) {
                    visible.add(e.shape);
                }
            }
            return visible;
        }

        const gen = ++this.queryGen;
        const stamp = this.stamp;
        const entries = this.entries;
        const cols = this.cols;

        const cx0 = this.clampCol(Math.floor((vMinX - this.originX) / this.cellSize));
        const cx1 = this.clampCol(Math.floor((vMaxX - this.originX) / this.cellSize));
        const cy0 = this.clampRow(Math.floor((vMinY - this.originY) / this.cellSize));
        const cy1 = this.clampRow(Math.floor((vMaxY - this.originY) / this.cellSize));

        for (let cy = cy0; cy <= cy1; cy++) {
            const rowBase = cy * cols;
            for (let cx = cx0; cx <= cx1; cx++) {
                const bucket = this.cells[rowBase + cx];
                for (let k = 0; k < bucket.length; k++) {
                    const i = bucket[k];
                    if (stamp[i] === gen) continue;
                    stamp[i] = gen;
                    const e = entries[i];
                    if (e.maxX >= vMinX && e.minX <= vMaxX && e.maxY >= vMinY && e.minY <= vMaxY) {
                        visible.add(e.shape);
                    }
                }
            }
        }

        for (let k = 0; k < this.oversized.length; k++) {
            const e = entries[this.oversized[k]];
            if (e.maxX >= vMinX && e.minX <= vMaxX && e.maxY >= vMinY && e.minY <= vMaxY) {
                visible.add(e.shape);
            }
        }

        return visible;
    }

    private clampCol(c: number): number {
        return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    }

    private clampRow(r: number): number {
        return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    }
}

/**
 * Project a world-space AABB through `transform` into a scene-space AABB by
 * transforming its four corners and taking the min/max. For the identity
 * transform the box is returned unchanged. Mirrors the `transformedBbox`
 * helper in `clipSceneToViewport` so index bounds match the cull predicate.
 */
export function projectBounds(
    minX: number, minY: number, maxX: number, maxY: number,
    transform: CoordFn,
): {minX: number; minY: number; maxX: number; maxY: number} {
    if (transform === IDENTITY_TRANSFORM) {
        return {minX, minY, maxX, maxY};
    }
    const c1 = transform(minX, minY);
    const c2 = transform(maxX, minY);
    const c3 = transform(maxX, maxY);
    const c4 = transform(minX, maxY);
    return {
        minX: Math.min(c1.x, c2.x, c3.x, c4.x),
        minY: Math.min(c1.y, c2.y, c3.y, c4.y),
        maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
        maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
    };
}
