/**
 * HitTester — point→shape lookup built from {@link Shape} hit annotations.
 *
 * Shapes produced by {@link ScenePipeline} carry an optional {@link HitInfo}
 * annotation on shapes that represent pickable model entities (rooms, exits,
 * labels, …). HitTester walks that tree, computes world-space bounding boxes,
 * and builds a spatial index so that `pick(renderedX, renderedY)` runs in
 * sub-linear time.
 *
 * Coordinates contract:
 *   - Shapes live in **world space** (flat map coordinates).
 *   - `coordTransform` maps world → rendered space (identity for flat styles;
 *     iso projection for IsometricStyle).
 *   - `pick` / `findRoomAtPoint` expect points in **rendered space** — the same
 *     space that `Camera.clientToMapPoint` returns.
 */

import type {HitInfo, Shape, Bbox} from "../scene/Shape";

export type CoordTransform = (x: number, y: number) => {x: number; y: number};

/** Result returned by {@link HitTester.pick}. */
export interface HitResult {
    kind: string;
    id?: number | string;
    payload?: unknown;
}

type HitEntry = {
    /** Center of the shape in rendered (post-transform) space. */
    renderedCX: number;
    renderedCY: number;
    /** Half-extents of the shape's rendered bbox (for margin computation). */
    renderedHalfW: number;
    renderedHalfH: number;
    info: HitInfo;
};

const identity: CoordTransform = (x, y) => ({x, y});

/**
 * Spatial index for hittable shapes.  Rebuilt cheaply after each scene build.
 */
export class HitTester {
    private entries: HitEntry[] = [];
    private bucketSize = 5;
    private roomSize = 1;
    private spatialIndex = new Map<number, HitEntry[]>();
    private transform: CoordTransform = identity;

    /**
     * Rebuild from a fresh set of world-space shapes.
     *
     * @param shapes         Top-level shape list from {@link ScenePipeline}.
     * @param roomSize       Current room size (world units) — used as pick margin.
     * @param coordTransform World→rendered projection; omit for flat (identity).
     */
    build(shapes: Shape[], roomSize: number, coordTransform?: CoordTransform): void {
        this.clear();
        this.roomSize = roomSize;
        this.bucketSize = Math.max(roomSize * 10, 5);
        this.transform = coordTransform ?? identity;
        this.collectHitShapes(shapes, 0, 0);
    }

    clear(): void {
        this.entries = [];
        this.spatialIndex.clear();
    }

    /**
     * Find the best-matching hittable shape at a rendered-space point.
     *
     * Returns `null` when no hit shape is within {@link roomSize} of the point.
     */
    pick(renderedX: number, renderedY: number): HitResult | null {
        const key = this.getBucketKey(
            Math.floor(renderedX / this.bucketSize),
            Math.floor(renderedY / this.bucketSize),
        );
        const bucket = this.spatialIndex.get(key);
        if (!bucket) return null;

        const margin = this.roomSize;
        let best: HitEntry | null = null;
        let bestDist = Infinity;

        for (const entry of bucket) {
            const dx = renderedX - entry.renderedCX;
            const dy = renderedY - entry.renderedCY;
            const marginX = Math.max(entry.renderedHalfW, margin);
            const marginY = Math.max(entry.renderedHalfH, margin);
            if (Math.abs(dx) <= marginX && Math.abs(dy) <= marginY) {
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = entry;
                }
            }
        }

        if (!best) return null;
        return {kind: best.info.kind, id: best.info.id, payload: best.info.payload};
    }

    /**
     * Convenience wrapper: find the room whose hit shape is nearest to the
     * given rendered-space point, or `null` when none is within range.
     */
    findRoomAtPoint(renderedX: number, renderedY: number): MapData.Room | null {
        const result = this.pick(renderedX, renderedY);
        if (!result || result.kind !== "room") return null;
        return (result.payload as MapData.Room) ?? null;
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private collectHitShapes(shapes: Shape[], offsetX: number, offsetY: number): void {
        for (const shape of shapes) {
            if (shape.hit) {
                const worldBbox = computeShapeBbox(shape, offsetX, offsetY);
                this.indexEntry(worldBbox, shape.hit);
            }
            if (shape.type === "group") {
                this.collectHitShapes(shape.children, offsetX + shape.x, offsetY + shape.y);
            }
        }
    }

    private indexEntry(worldBbox: Bbox, info: HitInfo): void {
        const fn = this.transform;
        // Transform all four world-space corners to rendered space.
        const c1 = fn(worldBbox.minX, worldBbox.minY);
        const c2 = fn(worldBbox.maxX, worldBbox.minY);
        const c3 = fn(worldBbox.maxX, worldBbox.maxY);
        const c4 = fn(worldBbox.minX, worldBbox.maxY);

        const rMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const rMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const rMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const rMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);

        const entry: HitEntry = {
            renderedCX: (rMinX + rMaxX) / 2,
            renderedCY: (rMinY + rMaxY) / 2,
            renderedHalfW: (rMaxX - rMinX) / 2,
            renderedHalfH: (rMaxY - rMinY) / 2,
            info,
        };
        this.entries.push(entry);

        // Insert into every bucket covered by the rendered bbox so any click
        // within the bbox lands in a bucket that contains this entry.
        const size = this.bucketSize;
        const bMinX = Math.floor(rMinX / size);
        const bMaxX = Math.floor(rMaxX / size);
        const bMinY = Math.floor(rMinY / size);
        const bMaxY = Math.floor(rMaxY / size);

        for (let bx = bMinX; bx <= bMaxX; bx++) {
            for (let by = bMinY; by <= bMaxY; by++) {
                const key = this.getBucketKey(bx, by);
                let bucket = this.spatialIndex.get(key);
                if (!bucket) {
                    bucket = [];
                    this.spatialIndex.set(key, bucket);
                }
                bucket.push(entry);
            }
        }
    }

    private getBucketKey(bx: number, by: number): number {
        return bx * 1000003 + by;
    }
}

// ── Bbox computation ──────────────────────────────────────────────────────────

/**
 * Compute the axis-aligned bounding box of a shape in world space.
 * `offsetX/Y` is the cumulative parent group origin.
 */
export function computeShapeBbox(shape: Shape, offsetX: number, offsetY: number): Bbox {
    switch (shape.type) {
        case "rect":
            return {
                minX: offsetX + shape.x,
                minY: offsetY + shape.y,
                maxX: offsetX + shape.x + shape.width,
                maxY: offsetY + shape.y + shape.height,
            };
        case "circle":
            return {
                minX: offsetX + shape.cx - shape.radius,
                minY: offsetY + shape.cy - shape.radius,
                maxX: offsetX + shape.cx + shape.radius,
                maxY: offsetY + shape.cy + shape.radius,
            };
        case "line": {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < shape.points.length; i += 2) {
                const x = offsetX + shape.points[i];
                const y = offsetY + shape.points[i + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            return {minX, minY, maxX, maxY};
        }
        case "polygon": {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < shape.vertices.length; i += 2) {
                const x = offsetX + shape.vertices[i];
                const y = offsetY + shape.vertices[i + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            return {minX, minY, maxX, maxY};
        }
        case "text":
            return {
                minX: offsetX + shape.x,
                minY: offsetY + shape.y,
                maxX: offsetX + shape.x + (shape.width ?? 0),
                maxY: offsetY + shape.y + (shape.height ?? 0),
            };
        case "image":
            return {
                minX: offsetX + shape.x,
                minY: offsetY + shape.y,
                maxX: offsetX + shape.x + shape.width,
                maxY: offsetY + shape.y + shape.height,
            };
        case "group": {
            if (shape.children.length === 0) {
                const px = offsetX + shape.x;
                const py = offsetY + shape.y;
                return {minX: px, minY: py, maxX: px, maxY: py};
            }
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const child of shape.children) {
                const b = computeShapeBbox(child, offsetX + shape.x, offsetY + shape.y);
                if (b.minX < minX) minX = b.minX;
                if (b.minY < minY) minY = b.minY;
                if (b.maxX > maxX) maxX = b.maxX;
                if (b.maxY > maxY) maxY = b.maxY;
            }
            return {minX, minY, maxX, maxY};
        }
    }
}
