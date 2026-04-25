/**
 * Hand-drawn wobble math used by the shape-based SketchyStyle.
 *
 * Identical algorithms to `../SketchyStyle.ts` so cross-style snapshots
 * stay byte-identical between old and new pipelines. When step 11 deletes
 * the legacy decorator, this module becomes the single source of truth.
 */

/** Simple seeded LCG. Returns values in `[0, 1)`. */
export function createRng(seed: number): () => number {
    let s = seed | 0 || 1;
    return () => {
        s = (s * 1664525 + 1013904223) | 0;
        return (s >>> 0) / 4294967296;
    };
}

/** Hash a set of numeric values into a stable integer seed. */
export function hashCoords(...values: number[]): number {
    let h = 0x9e3779b9;
    for (const v of values) {
        h ^= ((v * 1000) | 0) + 0x9e3779b9 + (h << 6) + (h >> 2);
    }
    return h;
}

/**
 * Subdivide a straight segment into several sub-segments with slight
 * perpendicular displacement, producing a hand-drawn wobble.
 */
export function wobbleSegment(
    x1: number, y1: number, x2: number, y2: number,
    jitter: number, rng: () => number,
): number[] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return [x1, y1, x2, y2];

    const nx = -dy / len;
    const ny = dx / len;

    const subdivisions = Math.max(2, Math.min(6, Math.ceil(len / 0.15)));
    const points: number[] = [
        x1 + nx * (rng() - 0.5) * jitter * 0.3,
        y1 + ny * (rng() - 0.5) * jitter * 0.3,
    ];

    for (let i = 1; i < subdivisions; i++) {
        const t = i / subdivisions;
        const px = x1 + dx * t;
        const py = y1 + dy * t;
        const offset = (rng() - 0.5) * 2 * jitter;
        points.push(px + nx * offset, py + ny * offset);
    }

    points.push(
        x2 + nx * (rng() - 0.5) * jitter * 0.3,
        y2 + ny * (rng() - 0.5) * jitter * 0.3,
    );
    return points;
}

/** Wobble an open polyline. */
export function wobblePolyline(points: number[], jitter: number, rng: () => number): number[] {
    if (points.length < 4) return points;
    const result: number[] = [];
    for (let i = 0; i < points.length - 2; i += 2) {
        const seg = wobbleSegment(
            points[i], points[i + 1],
            points[i + 2], points[i + 3],
            jitter, rng,
        );
        if (i === 0) {
            result.push(...seg);
        } else {
            for (let j = 2; j < seg.length; j++) result.push(seg[j]);
        }
    }
    return result;
}

/** Convert a rectangle to a closed wobbly polygon. */
export function wobbleRect(
    x: number, y: number, w: number, h: number,
    jitter: number, rng: () => number,
): number[] {
    const corners = [x, y, x + w, y, x + w, y + h, x, y + h];
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
        const x1 = corners[i * 2], y1 = corners[i * 2 + 1];
        const ni = (i + 1) % 4;
        const x2 = corners[ni * 2], y2 = corners[ni * 2 + 1];
        const seg = wobbleSegment(x1, y1, x2, y2, jitter, rng);
        for (let j = 0; j < seg.length - 2; j++) result.push(seg[j]);
    }
    return result;
}

/** Convert a circle to a wobbly polygon with slight radius variation. */
export function wobbleCircle(
    cx: number, cy: number, radius: number,
    jitter: number, rng: () => number,
): number[] {
    const segments = 24;
    const points: number[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const rJitter = radius + (rng() - 0.5) * 2 * jitter;
        points.push(cx + Math.cos(angle) * rJitter, cy + Math.sin(angle) * rJitter);
    }
    return points;
}

/** Wobble a closed polygon by subdividing each edge. */
export function wobblePolygonEdges(vertices: number[], jitter: number, rng: () => number): number[] {
    const n = vertices.length / 2;
    if (n < 2) return vertices;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
        const x1 = vertices[i * 2], y1 = vertices[i * 2 + 1];
        const ni = (i + 1) % n;
        const x2 = vertices[ni * 2], y2 = vertices[ni * 2 + 1];
        const seg = wobbleSegment(x1, y1, x2, y2, jitter, rng);
        for (let j = 0; j < seg.length - 2; j++) result.push(seg[j]);
    }
    return result;
}
