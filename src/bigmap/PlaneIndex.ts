import type {ViewportBounds} from "../types/Settings";
import type {MapSkeleton} from "./Skeleton";

/**
 * A (area, z) plane's room slots bucketed into a uniform grid via counting
 * sort. Queries touch only the cells a viewport overlaps, so visiting the
 * rooms in view is O(occupied cells + hits) instead of O(plane).
 */
export interface PlaneIndex {
    /** Skeleton slot indices of every room on this plane. */
    indices: Int32Array;
    minX: number;
    minY: number;
    /** Cell size in map units. */
    cs: number;
    cols: number;
    rows: number;
    /** Prefix sums: cell c's members are order[cellStart[c] .. cellStart[c+1]). */
    cellStart: Int32Array;
    order: Int32Array;
    /** Full plane bounds (same coordinate space as the skeleton). */
    bounds: ViewportBounds;
}

/**
 * Bucket every room of one (area, z) plane into a uniform grid. The cell size
 * targets a 128×128 grid over the plane's extent — coarse enough that the
 * cellStart array stays small, fine enough that a viewport query skips the
 * overwhelming majority of a dense plane.
 */
export function buildPlaneIndex(sk: MapSkeleton, areaId: number, z: number): PlaneIndex {
    const tmp: number[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < sk.count; i++) {
        if (sk.area[i] !== areaId || sk.z[i] !== z) continue;
        tmp.push(i);
        const x = sk.x[i], y = sk.y[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const indices = Int32Array.from(tmp);
    if (indices.length === 0) {
        return {indices, minX: 0, minY: 0, cs: 1, cols: 1, rows: 1,
            cellStart: new Int32Array(2), order: indices,
            bounds: {minX: 0, maxX: 0, minY: 0, maxY: 0}};
    }

    const extent = Math.max(maxX - minX, maxY - minY, 1);
    const cs = Math.max(1, Math.ceil(extent / 128));
    const cols = Math.floor((maxX - minX) / cs) + 1;
    const rows = Math.floor((maxY - minY) / cs) + 1;
    const cellOf = (i: number) =>
        Math.floor((sk.y[i] - minY) / cs) * cols + Math.floor((sk.x[i] - minX) / cs);

    const counts = new Int32Array(cols * rows);
    for (let k = 0; k < indices.length; k++) counts[cellOf(indices[k])]++;
    const cellStart = new Int32Array(cols * rows + 1);
    for (let c = 0; c < cols * rows; c++) cellStart[c + 1] = cellStart[c] + counts[c];
    const cursor = cellStart.slice(0, cols * rows);
    const order = new Int32Array(indices.length);
    for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const c = cellOf(i);
        order[cursor[c]++] = i;
    }

    return {indices, minX, minY, cs, cols, rows, cellStart, order, bounds: {minX, maxX, minY, maxY}};
}

function cellRange(p: PlaneIndex, b: ViewportBounds):
    {cx0: number; cx1: number; cy0: number; cy1: number} | null {
    const cx0 = Math.max(0, Math.floor((b.minX - p.minX) / p.cs));
    const cx1 = Math.min(p.cols - 1, Math.floor((b.maxX - p.minX) / p.cs));
    const cy0 = Math.max(0, Math.floor((b.minY - p.minY) / p.cs));
    const cy1 = Math.min(p.rows - 1, Math.floor((b.maxY - p.minY) / p.cs));
    return cx1 < cx0 || cy1 < cy0 ? null : {cx0, cx1, cy0, cy1};
}

/**
 * Visit the skeleton slot of every room whose centre lies inside `b` — exact
 * (each candidate is bounds-tested), uncapped. This is the hot path for both
 * room materialisation and raster painting; it never allocates.
 */
export function forEachInBounds(
    sk: MapSkeleton, p: PlaneIndex, b: ViewportBounds, fn: (i: number) => void,
): void {
    const r = cellRange(p, b);
    if (!r) return;
    const {cols, cellStart, order} = p;
    for (let cy = r.cy0; cy <= r.cy1; cy++) {
        const base = cy * cols;
        for (let cx = r.cx0; cx <= r.cx1; cx++) {
            const c = base + cx;
            for (let q = cellStart[c]; q < cellStart[c + 1]; q++) {
                const i = order[q];
                if (sk.x[i] >= b.minX && sk.x[i] <= b.maxX &&
                    sk.y[i] >= b.minY && sk.y[i] <= b.maxY) fn(i);
            }
        }
    }
}

/**
 * Cheap UPPER BOUND on the rooms inside `b`: sums the occupancy of every cell
 * the bounds overlap without per-room tests. Cells at the edge contribute
 * rooms that are actually outside — do not use this where exactness matters
 * (an earlier LOD used it as an exact count and flipped modes spuriously).
 */
export function countInBounds(p: PlaneIndex, b: ViewportBounds): number {
    const r = cellRange(p, b);
    if (!r) return 0;
    let total = 0;
    for (let cy = r.cy0; cy <= r.cy1; cy++) {
        const base = cy * p.cols;
        for (let cx = r.cx0; cx <= r.cx1; cx++) {
            const c = base + cx;
            total += p.cellStart[c + 1] - p.cellStart[c];
        }
    }
    return total;
}
