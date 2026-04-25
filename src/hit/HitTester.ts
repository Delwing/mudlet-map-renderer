/**
 * HitTester — point→shape lookup built from {@link Shape} hit annotations.
 *
 * Shapes produced by {@link ScenePipeline} carry an optional {@link HitInfo}
 * annotation on shapes that represent pickable model entities (rooms, exits,
 * labels, …). HitTester walks that tree, computes world-space geometry and
 * bounding boxes, and builds a spatial index so picks run in sub-linear time.
 *
 * Coordinates contract:
 *   - Shapes live in **world space** (flat map coordinates).
 *   - `coordTransform` maps world → rendered space (identity for flat styles;
 *     iso projection for IsometricStyle). Each vertex is transformed
 *     individually so shears (iso) preserve segment shape.
 *   - `pick` / `pickAll` / `pickInRect` / `findRoomAtPoint` expect points in
 *     **rendered space** — the same space that `Camera.clientToMapPoint`
 *     returns.
 *
 * Distance metric: per shape kind, pick distance is computed against the
 * actual geometry (segment distance for lines/polylines, edge distance for
 * rects/polygons with point-inside short-circuit, radius-distance for
 * circles), so long thin shapes (exits, stubs) are only hit near the line
 * itself — not anywhere within their AABB.
 */

import type {HitInfo, Shape, Bbox} from "../scene/Shape";

export type CoordTransform = (x: number, y: number) => {x: number; y: number};

/** Result returned by {@link HitTester.pick} et al. */
export interface HitResult {
    kind: string;
    id?: number | string;
    payload?: unknown;
    /** Distance from the query point to the shape (rendered space units). */
    distance: number;
    /** Effective priority used when ranking (per-kind default unless overridden). */
    priority: number;
    /** Center of the shape's rendered bbox — useful for hover effects. */
    centerX: number;
    centerY: number;
}

/** Per-kind defaults used when {@link HitInfo.priority} is omitted. */
const DEFAULT_PRIORITY: Record<string, number> = {
    areaExit: 110,
    room: 100,
    label: 80,
    specialExit: 60,
    exit: 40,
    stub: 20,
};

/** Per-kind defaults used when {@link HitInfo.margin} is omitted. */
const DEFAULT_MARGIN: Record<string, number> = {
    room: 1.0,
    areaExit: 1.0,
    label: 1.0,
    specialExit: 0.5,
    exit: 0.35,
    stub: 0.3,
};

type HitGeom =
    | {type: "polyline"; pts: number[]; closed: boolean}
    | {type: "circle"; cx: number; cy: number; r: number};

type HitEntry = {
    info: HitInfo;
    margin: number;
    priority: number;
    rMinX: number;
    rMaxX: number;
    rMinY: number;
    rMaxY: number;
    cx: number;
    cy: number;
    geoms: HitGeom[];
};

const identity: CoordTransform = (x, y) => ({x, y});

/**
 * Spatial index for hittable shapes. Rebuilt cheaply after each scene build.
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
     * @param roomSize       Current room size (world units) — used as base pick margin.
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
     * Best = highest priority, then closest. Returns `null` when no shape
     * is within its margin of the point.
     */
    pick(x: number, y: number): HitResult | null {
        let best: HitEntry | null = null;
        let bestDist = Infinity;
        let bestCenterDist = Infinity;
        let bestPriority = -Infinity;
        this.forEachCandidate(x, y, (entry, dist) => {
            // Tertiary tiebreaker: when two shapes both contain the point
            // (distance 0), prefer the one whose bbox center is closer.
            const cdx = x - entry.cx;
            const cdy = y - entry.cy;
            const cdist = cdx * cdx + cdy * cdy;
            if (
                entry.priority > bestPriority ||
                (entry.priority === bestPriority && dist < bestDist) ||
                (entry.priority === bestPriority && dist === bestDist && cdist < bestCenterDist)
            ) {
                best = entry;
                bestDist = dist;
                bestCenterDist = cdist;
                bestPriority = entry.priority;
            }
        });
        return best ? this.toResult(best, bestDist) : null;
    }

    /**
     * Return every hittable shape at a rendered-space point, sorted by
     * priority desc then distance asc. Used for Alt+click cycling and
     * disambiguation menus.
     */
    pickAll(x: number, y: number): HitResult[] {
        const results: Array<{entry: HitEntry; dist: number}> = [];
        this.forEachCandidate(x, y, (entry, dist) => {
            results.push({entry, dist});
        });
        results.sort((a, b) => b.entry.priority - a.entry.priority || a.dist - b.dist);
        return results.map(r => this.toResult(r.entry, r.dist));
    }

    /**
     * Return every hittable shape whose rendered-space center falls inside
     * the rect, optionally filtered by kind. Used for marquee selection.
     */
    pickInRect(
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        kinds?: string[],
    ): HitResult[] {
        const lx = Math.min(minX, maxX);
        const rx = Math.max(minX, maxX);
        const ty = Math.min(minY, maxY);
        const by = Math.max(minY, maxY);
        const out: HitResult[] = [];
        for (const entry of this.entries) {
            if (kinds && !kinds.includes(entry.info.kind)) continue;
            if (entry.cx < lx || entry.cx > rx || entry.cy < ty || entry.cy > by) continue;
            out.push(this.toResult(entry, 0));
        }
        out.sort((a, b) => b.priority - a.priority);
        return out;
    }

    /**
     * Convenience wrapper: return the room whose hit shape is nearest to
     * the given rendered-space point, or `null` when none is within range.
     */
    findRoomAtPoint(x: number, y: number): MapData.Room | null {
        const result = this.pick(x, y);
        if (!result || result.kind !== "room") return null;
        return (result.payload as MapData.Room) ?? null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /** Walk the 9 buckets around the point and emit candidates within margin. */
    private forEachCandidate(
        x: number,
        y: number,
        emit: (entry: HitEntry, dist: number) => void,
    ): void {
        const bx = Math.floor(x / this.bucketSize);
        const by = Math.floor(y / this.bucketSize);
        const seen = new Set<HitEntry>();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = this.spatialIndex.get(bucketKey(bx + dx, by + dy));
                if (!bucket) continue;
                for (const entry of bucket) {
                    if (seen.has(entry)) continue;
                    seen.add(entry);
                    const r = entry.margin * this.roomSize;
                    if (
                        x < entry.rMinX - r || x > entry.rMaxX + r ||
                        y < entry.rMinY - r || y > entry.rMaxY + r
                    ) continue;
                    const dist = entryDistance(entry, x, y);
                    if (dist > r) continue;
                    emit(entry, dist);
                }
            }
        }
    }

    private toResult(entry: HitEntry, distance: number): HitResult {
        return {
            kind: entry.info.kind,
            id: entry.info.id,
            payload: entry.info.payload,
            distance,
            priority: entry.priority,
            centerX: entry.cx,
            centerY: entry.cy,
        };
    }

    private collectHitShapes(shapes: Shape[], offsetX: number, offsetY: number): void {
        for (const shape of shapes) {
            if (shape.hit) {
                const geoms: HitGeom[] = [];
                const bbox = makeEmptyBbox();
                collectGeometryForEntry(shape, offsetX, offsetY, this.transform, geoms, bbox);
                if (geoms.length > 0 && bbox.minX <= bbox.maxX) {
                    this.indexEntry(bbox, geoms, shape.hit);
                }
            }
            if (shape.type === "group") {
                this.collectHitShapes(shape.children, offsetX + shape.x, offsetY + shape.y);
            }
        }
    }

    private indexEntry(bbox: Bbox, geoms: HitGeom[], info: HitInfo): void {
        const margin = info.margin ?? DEFAULT_MARGIN[info.kind] ?? 1.0;
        const priority = info.priority ?? DEFAULT_PRIORITY[info.kind] ?? 50;

        const cx = (bbox.minX + bbox.maxX) / 2;
        const cy = (bbox.minY + bbox.maxY) / 2;
        const entry: HitEntry = {
            info,
            margin,
            priority,
            rMinX: bbox.minX,
            rMaxX: bbox.maxX,
            rMinY: bbox.minY,
            rMaxY: bbox.maxY,
            cx,
            cy,
            geoms,
        };
        this.entries.push(entry);

        const size = this.bucketSize;
        const bMinX = Math.floor(bbox.minX / size);
        const bMaxX = Math.floor(bbox.maxX / size);
        const bMinY = Math.floor(bbox.minY / size);
        const bMaxY = Math.floor(bbox.maxY / size);
        for (let bx = bMinX; bx <= bMaxX; bx++) {
            for (let by = bMinY; by <= bMaxY; by++) {
                const key = bucketKey(bx, by);
                let bucket = this.spatialIndex.get(key);
                if (!bucket) {
                    bucket = [];
                    this.spatialIndex.set(key, bucket);
                }
                bucket.push(entry);
            }
        }
    }
}

// ── Geometry collection ──────────────────────────────────────────────────────

function makeEmptyBbox(): Bbox {
    return {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
}

function expandBbox(bbox: Bbox, x: number, y: number): void {
    if (x < bbox.minX) bbox.minX = x;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (y > bbox.maxY) bbox.maxY = y;
}

/**
 * Entry point for geometry collection: the hit-annotated `shape` itself is
 * always included, regardless of whether it would otherwise be skipped as
 * a hit-annotated descendant.
 */
function collectGeometryForEntry(
    shape: Shape,
    offsetX: number,
    offsetY: number,
    transform: CoordTransform,
    out: HitGeom[],
    bbox: Bbox,
): void {
    if (shape.type === "group") {
        // Top-level: walk children directly, skipping any with their own hit.
        for (const child of shape.children) {
            if (child.hit) continue;
            collectGeometry(child, offsetX + shape.x, offsetY + shape.y, transform, out, bbox);
        }
        return;
    }
    collectGeometry(shape, offsetX, offsetY, transform, out, bbox);
}

/**
 * Recursive geometry walk for a non-hit-annotated subtree. Hit-annotated
 * descendants are skipped — they get their own entries via `collectHitShapes`.
 */
function collectGeometry(
    shape: Shape,
    offsetX: number,
    offsetY: number,
    transform: CoordTransform,
    out: HitGeom[],
    bbox: Bbox,
): void {
    switch (shape.type) {
        case "rect":
        case "image": {
            const c1 = transform(offsetX + shape.x, offsetY + shape.y);
            const c2 = transform(offsetX + shape.x + shape.width, offsetY + shape.y);
            const c3 = transform(offsetX + shape.x + shape.width, offsetY + shape.y + shape.height);
            const c4 = transform(offsetX + shape.x, offsetY + shape.y + shape.height);
            const verts = [c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c4.x, c4.y];
            out.push({type: "polyline", pts: verts, closed: true});
            for (let i = 0; i < verts.length; i += 2) expandBbox(bbox, verts[i], verts[i + 1]);
            return;
        }
        case "text": {
            const w = shape.width ?? 0;
            const h = shape.height ?? 0;
            if (w === 0 || h === 0) {
                const c = transform(offsetX + shape.x, offsetY + shape.y);
                expandBbox(bbox, c.x, c.y);
                return;
            }
            const c1 = transform(offsetX + shape.x, offsetY + shape.y);
            const c2 = transform(offsetX + shape.x + w, offsetY + shape.y);
            const c3 = transform(offsetX + shape.x + w, offsetY + shape.y + h);
            const c4 = transform(offsetX + shape.x, offsetY + shape.y + h);
            const verts = [c1.x, c1.y, c2.x, c2.y, c3.x, c3.y, c4.x, c4.y];
            out.push({type: "polyline", pts: verts, closed: true});
            for (let i = 0; i < verts.length; i += 2) expandBbox(bbox, verts[i], verts[i + 1]);
            return;
        }
        case "circle": {
            const c = transform(offsetX + shape.cx, offsetY + shape.cy);
            out.push({type: "circle", cx: c.x, cy: c.y, r: shape.radius});
            expandBbox(bbox, c.x - shape.radius, c.y - shape.radius);
            expandBbox(bbox, c.x + shape.radius, c.y + shape.radius);
            return;
        }
        case "line": {
            const pts: number[] = [];
            for (let i = 0; i < shape.points.length; i += 2) {
                const p = transform(offsetX + shape.points[i], offsetY + shape.points[i + 1]);
                pts.push(p.x, p.y);
                expandBbox(bbox, p.x, p.y);
            }
            if (pts.length >= 2) out.push({type: "polyline", pts, closed: false});
            return;
        }
        case "polygon": {
            const verts: number[] = [];
            for (let i = 0; i < shape.vertices.length; i += 2) {
                const p = transform(offsetX + shape.vertices[i], offsetY + shape.vertices[i + 1]);
                verts.push(p.x, p.y);
                expandBbox(bbox, p.x, p.y);
            }
            if (verts.length >= 2) out.push({type: "polyline", pts: verts, closed: true});
            return;
        }
        case "group": {
            for (const child of shape.children) {
                if (child.hit) continue;
                collectGeometry(child, offsetX + shape.x, offsetY + shape.y, transform, out, bbox);
            }
            return;
        }
    }
}

// ── Distance helpers ─────────────────────────────────────────────────────────

function entryDistance(entry: HitEntry, x: number, y: number): number {
    let best = Infinity;
    for (const g of entry.geoms) {
        const d = geomDistance(g, x, y);
        if (d < best) best = d;
        if (best === 0) return 0;
    }
    return best;
}

function geomDistance(g: HitGeom, x: number, y: number): number {
    if (g.type === "circle") {
        const dx = x - g.cx, dy = y - g.cy;
        return Math.max(0, Math.hypot(dx, dy) - g.r);
    }
    if (g.closed && pointInPolygon(g.pts, x, y)) return 0;
    return minDistanceToPolyline(g.pts, x, y, g.closed);
}

function minDistanceToPolyline(pts: number[], px: number, py: number, closed: boolean): number {
    const n = pts.length / 2;
    if (n < 2) {
        if (n === 1) return Math.hypot(px - pts[0], py - pts[1]);
        return Infinity;
    }
    let best = Infinity;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
        const ai = i * 2;
        const bi = ((i + 1) % n) * 2;
        const d = pointToSegment(px, py, pts[ai], pts[ai + 1], pts[bi], pts[bi + 1]);
        if (d < best) best = d;
    }
    return best;
}

function pointToSegment(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
): number {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

function pointInPolygon(verts: number[], x: number, y: number): boolean {
    let inside = false;
    const n = verts.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = verts[i * 2], yi = verts[i * 2 + 1];
        const xj = verts[j * 2], yj = verts[j * 2 + 1];
        // Avoid divide-by-zero on horizontal edges; tiny epsilon is harmless.
        const denom = (yj - yi) || 1e-12;
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / denom + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function bucketKey(bx: number, by: number): number {
    return bx * 1000003 + by;
}

// ── Bbox computation (preserved for callers / tests) ─────────────────────────

/**
 * Compute the axis-aligned bounding box of a shape in world space.
 * `offsetX/Y` is the cumulative parent group origin.
 *
 * Note: this does NOT apply the HitTester's coord transform. Callers that
 * need rendered-space extents should transform the four corners themselves.
 * Kept exported for backends that need a quick world-space AABB (e.g. cull
 * entry construction, scene bounds), and for tests.
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
