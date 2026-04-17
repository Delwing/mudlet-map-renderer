import type {
    DrawingBackend, GroupNode,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig,
} from "../backend/DrawingBackend";
import {BaseStyle} from "../backend/DrawingBackend";

/**
 * Simple seeded PRNG (linear congruential).
 * Returns values in [0, 1).
 */
function createRng(seed: number): () => number {
    let s = seed | 0 || 1;
    return () => {
        s = (s * 1664525 + 1013904223) | 0;
        return (s >>> 0) / 4294967296;
    };
}

/**
 * Hash a set of numeric values into a stable integer seed.
 */
function hashCoords(...values: number[]): number {
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
function wobbleSegment(
    x1: number, y1: number, x2: number, y2: number,
    jitter: number, rng: () => number,
): number[] {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return [x1, y1, x2, y2];

    // Perpendicular unit vector
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

/**
 * Wobble a polyline (flat array of [x,y,...] pairs).
 */
function wobblePolyline(points: number[], jitter: number, rng: () => number): number[] {
    if (points.length < 4) return points;
    const result: number[] = [];
    for (let i = 0; i < points.length - 2; i += 2) {
        const seg = wobbleSegment(
            points[i], points[i + 1],
            points[i + 2], points[i + 3],
            jitter, rng,
        );
        // Skip first point of subsequent segments to avoid duplicates
        if (i === 0) {
            result.push(...seg);
        } else {
            for (let j = 2; j < seg.length; j++) result.push(seg[j]);
        }
    }
    return result;
}

/**
 * Convert a rectangle to a closed wobbly polygon (flat vertex array).
 */
function wobbleRect(
    x: number, y: number, w: number, h: number,
    jitter: number, rng: () => number,
): number[] {
    const corners = [
        x, y,
        x + w, y,
        x + w, y + h,
        x, y + h,
    ];
    const result: number[] = [];
    for (let i = 0; i < 4; i++) {
        const x1 = corners[i * 2], y1 = corners[i * 2 + 1];
        const ni = (i + 1) % 4;
        const x2 = corners[ni * 2], y2 = corners[ni * 2 + 1];
        const seg = wobbleSegment(x1, y1, x2, y2, jitter, rng);
        // Skip last point (will be first of next side)
        for (let j = 0; j < seg.length - 2; j++) result.push(seg[j]);
    }
    return result;
}

/**
 * Convert a circle to a wobbly polygon with slight radius variation.
 */
function wobbleCircle(
    cx: number, cy: number, radius: number,
    jitter: number, rng: () => number,
): number[] {
    const segments = 24;
    const points: number[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const rJitter = radius + (rng() - 0.5) * 2 * jitter;
        points.push(
            cx + Math.cos(angle) * rJitter,
            cy + Math.sin(angle) * rJitter,
        );
    }
    return points;
}

/**
 * Wobble a closed polygon by subdividing each edge into wobbly segments.
 * Produces visibly hand-drawn edges, not just shifted corners.
 */
function wobblePolygonEdges(vertices: number[], jitter: number, rng: () => number): number[] {
    const n = vertices.length / 2; // number of vertices
    if (n < 2) return vertices;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
        const x1 = vertices[i * 2], y1 = vertices[i * 2 + 1];
        const ni = (i + 1) % n;
        const x2 = vertices[ni * 2], y2 = vertices[ni * 2 + 1];
        const seg = wobbleSegment(x1, y1, x2, y2, jitter, rng);
        // Skip last point (will be first point of next side)
        for (let j = 0; j < seg.length - 2; j++) result.push(seg[j]);
    }
    return result;
}

/**
 * Decorator that wraps a DrawingBackend and applies hand-drawn "pencil" wobble
 * to all shapes. Text and images pass through unchanged.
 *
 * Jitter is deterministic per shape (seeded from coordinates) so re-renders
 * produce the same wobble pattern.
 *
 * Usage:
 * ```ts
 * const sketchy = new SketchyStyle(new CanvasBackend(), 0.015, '#444444');
 * new ScenePipeline(mapReader, settings, sketchy, layers);
 * ```
 */
export class SketchyStyle<Inner extends DrawingBackend = DrawingBackend>
    extends BaseStyle<Inner> {

    private readonly jitter: number;
    private readonly pencil: string;

    /**
     * @param inner   The real backend to delegate to.
     * @param jitter  Base jitter amount in map units (e.g. 0.015).
     * @param pencilColor  Color for all strokes/fills (e.g. '#444444').
     */
    constructor(inner: Inner, jitter: number, pencilColor: string) {
        super(inner);
        this.jitter = jitter;
        this.pencil = pencilColor;
    }

    /**
     * Return the pencil color, preserving alpha from the original color if present.
     */
    private applyPencilWithAlpha(original: string | undefined): string {
        if (!original) return this.pencil;
        const alphaMatch = original.match(/^rgba\(.+,\s*([\d.]+)\s*\)$/);
        if (!alphaMatch) return this.pencil;
        const alpha = parseFloat(alphaMatch[1]);
        if (alpha >= 1) return this.pencil;
        // Parse pencil hex to rgb and apply the original alpha
        const r = parseInt(this.pencil.slice(1, 3), 16);
        const g = parseInt(this.pencil.slice(3, 5), 16);
        const b = parseInt(this.pencil.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    addRect(parent: GroupNode, config: RectConfig): void {

        const j = this.jitter;
        const pc = this.pencil;
        const seed = hashCoords(config.x, config.y, config.width, config.height);
        const rng = createRng(seed);

        // Pencil palette: room fills → paper white, strokes → pencil color
        const fill = config.fill ? '#ffffff' : undefined;
        const stroke = config.stroke ? pc : undefined;

        if (config.cornerRadius && config.cornerRadius > 0) {
            if (fill) {
                this.inner.addRect(parent, { ...config, fill, stroke: undefined, strokeWidth: 0 });
            }
            if (stroke && config.strokeWidth) {
                const verts = wobbleRect(config.x, config.y, config.width, config.height, j, rng);
                this.inner.addPolygon(parent, {
                    vertices: verts, stroke, strokeWidth: config.strokeWidth,
                });
            }
            return;
        }

        const verts = wobbleRect(config.x, config.y, config.width, config.height, j, rng);
        this.inner.addPolygon(parent, {
            vertices: verts, fill, stroke,
            strokeWidth: config.strokeWidth ?? 0,
        });
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {

        const j = this.jitter;
        const pc = this.pencil;
        const seed = hashCoords(config.cx, config.cy, config.radius);
        const rng = createRng(seed);

        const verts = wobbleCircle(config.cx, config.cy, config.radius, j, rng);
        this.inner.addPolygon(parent, {
            vertices: verts,
            fill: config.fill ? '#ffffff' : undefined,
            stroke: config.stroke ? pc : undefined,
            strokeWidth: config.strokeWidth ?? 0,
        });
    }

    addLine(parent: GroupNode, config: LineConfig): void {

        const j = this.jitter;
        const seed = hashCoords(...config.points.slice(0, 4));
        const rng = createRng(seed);

        const wobbly = wobblePolyline(config.points, j, rng);
        const stroke = this.applyPencilWithAlpha(config.stroke);
        this.inner.addLine(parent, { ...config, points: wobbly, stroke });
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {

        const j = this.jitter;
        const pc = this.pencil;
        const seed = hashCoords(...config.vertices.slice(0, 4));
        const rng = createRng(seed);

        const wobbly = wobblePolygonEdges(config.vertices, j, rng);
        this.inner.addPolygon(parent, {
            ...config, vertices: wobbly,
            fill: config.fill ? pc : undefined,
            stroke: config.stroke ? pc : undefined,
        });
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, { ...config, fill: this.pencil });
    }
}

