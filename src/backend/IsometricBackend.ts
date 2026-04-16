import type {
    DrawingBackend, GroupNode, CoordFn,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
} from "./DrawingBackend";
import {darkenColor} from "../utils/color";

/**
 * Rotation angle in degrees for the isometric view.
 * Any number is accepted. Common presets:
 *
 * | Angle | Effect |
 * |-------|--------|
 * | 0     | Standard iso — north points upper-right |
 * | 30    | Gentle tilt — north near top, subtle depth |
 * | 45    | North points straight up, max depth feel |
 * | 90    | North points upper-left |
 */
export type IsometricRotation = number;

type IsoTransform = (x: number, y: number) => [number, number];

function buildTransform(angleDeg: number): IsoTransform {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    // Pre-rotate by angle, then apply 2:1 isometric compression (squish Y by 0.5)
    return (x, y) => [
        x * cosA - y * sinA,
        (x * sinA + y * cosA) * 0.5,
    ];
}

function buildInverseTransform(angleDeg: number): IsoTransform {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    // Inverse: undo Y squish (×2) then reverse rotation
    return (u, v) => [
        u * cosA + 2 * v * sinA,
        -u * sinA + 2 * v * cosA,
    ];
}

const CIRCLE_SEGMENTS = 32;

/**
 * Decorator that wraps a DrawingBackend and projects all geometry through a
 * 2:1 isometric transformation.
 *
 * - **Rectangles** become diamond (rhombus) polygons.
 * - **Circles** become ellipse polygons.
 * - **Lines** and **polygons** have their coordinates transformed.
 * - **Text** is repositioned but stays upright for readability.
 * - **Images** are repositioned with dimensions preserved.
 *
 * When `depth > 0`, rooms gain two visible cube side faces (right lighter,
 * left darker) drawn beneath the top face diamond for a 3D block effect.
 *
 * Composes with other decorators — recommended order:
 * ```ts
 * // Isometric cubes with parchment colors and hand-drawn wobble
 * new IsometricBackend(
 *     new SketchyBackend(new ParchmentBackend(new KonvaBackend()), 0.012, '#4a3728'),
 *     { depth: 0.18, rotation: 90 },
 * );
 * ```
 */
export class IsometricBackend implements DrawingBackend {
    private readonly inner: DrawingBackend;
    private readonly depth: number;
    private readonly iso: IsoTransform;
    private readonly isoInv: IsoTransform;

    /**
     * @param inner    The backend to delegate to after iso-transforming coordinates.
     * @param options  Depth (cube side face height, default 0.18) and rotation (0/90/180/270, default 0).
     */
    constructor(inner: DrawingBackend, options?: { depth?: number; rotation?: IsometricRotation } | number) {
        this.inner = inner;
        if (typeof options === 'number') {
            this.depth = options;
            this.iso = buildTransform(0);
            this.isoInv = buildInverseTransform(0);
        } else {
            const rotation = options?.rotation ?? 0;
            this.depth = options?.depth ?? 0.18;
            this.iso = buildTransform(rotation);
            this.isoInv = buildInverseTransform(rotation);
        }
    }

    private ix(x: number, y: number): number { return this.iso(x, y)[0]; }
    private iy(x: number, y: number): number { return this.iso(x, y)[1]; }

    private isoFlatPoints(pts: number[]): number[] {
        const out: number[] = new Array(pts.length);
        for (let i = 0; i < pts.length; i += 2) {
            const [ox, oy] = this.iso(pts[i], pts[i + 1]);
            out[i] = ox;
            out[i + 1] = oy;
        }
        return out;
    }

    private rectToDiamond(x: number, y: number, w: number, h: number): number[] {
        const t = this.iso;
        const [t0x, t0y] = t(x, y);
        const [t1x, t1y] = t(x + w, y);
        const [t2x, t2y] = t(x + w, y + h);
        const [t3x, t3y] = t(x, y + h);
        return [t0x, t0y, t1x, t1y, t2x, t2y, t3x, t3y];
    }

    createGroup(x: number, y: number): GroupNode {
        const [ox, oy] = this.iso(x, y);
        return this.inner.createGroup(ox, oy);
    }

    addRect(parent: GroupNode, config: RectConfig): void {
        const {x, y, width: w, height: h, fill, stroke, strokeWidth} = config;
        const diamond = this.rectToDiamond(x, y, w, h);
        // diamond layout: [v0x, v0y, v1x, v1y, v2x, v2y, v3x, v3y]

        // Dashed rects (highlights/overlays): decompose to 4 dashed lines
        if (config.dash || config.dashEnabled) {
            for (let i = 0; i < 8; i += 2) {
                const ni = (i + 2) % 8;
                this.inner.addLine(parent, {
                    points: [diamond[i], diamond[i + 1], diamond[ni], diamond[ni + 1]],
                    stroke,
                    strokeWidth,
                    dash: config.dash,
                });
            }
            return;
        }

        // Cube with side faces: fill each face separately, then draw the visible outline
        if (this.depth > 0 && fill) {
            const d = this.depth;
            // Find the bottom-most vertex (highest Y) for the cube extrusion
            let bottomIdx = 0;
            for (let i = 1; i < 4; i++) {
                if (diamond[i * 2 + 1] > diamond[bottomIdx * 2 + 1]) bottomIdx = i;
            }
            const bX = diamond[bottomIdx * 2], bY = diamond[bottomIdx * 2 + 1];
            const rIdx = (bottomIdx + 3) % 4;
            const rX = diamond[rIdx * 2], rY = diamond[rIdx * 2 + 1];
            const lIdx = (bottomIdx + 1) % 4;
            const lX = diamond[lIdx * 2], lY = diamond[lIdx * 2 + 1];
            const tIdx = (bottomIdx + 2) % 4;
            const tX = diamond[tIdx * 2], tY = diamond[tIdx * 2 + 1];

            // 1. Fill all three faces (no strokes)
            this.inner.addPolygon(parent, {
                vertices: [rX, rY, bX, bY, bX, bY + d, rX, rY + d],
                fill: darkenColor(fill, 0.2),
            });
            this.inner.addPolygon(parent, {
                vertices: [bX, bY, lX, lY, lX, lY + d, bX, bY + d],
                fill: darkenColor(fill, 0.4),
            });
            this.inner.addPolygon(parent, {vertices: diamond, fill});

            // 2. Draw the visible outline: top diamond edges + outer side edges
            if (stroke && strokeWidth) {
                const sw = strokeWidth;
                // Top face: top two edges (top→right, left→top)
                this.inner.addLine(parent, {points: [tX, tY, rX, rY], stroke, strokeWidth: sw});
                this.inner.addLine(parent, {points: [lX, lY, tX, tY], stroke, strokeWidth: sw});
                // Side outer edges: right down, left down, bottom across
                this.inner.addLine(parent, {points: [rX, rY, rX, rY + d], stroke, strokeWidth: sw});
                this.inner.addLine(parent, {points: [lX, lY, lX, lY + d], stroke, strokeWidth: sw});
                this.inner.addLine(parent, {points: [rX, rY + d, bX, bY + d], stroke, strokeWidth: sw});
                this.inner.addLine(parent, {points: [bX, bY + d, lX, lY + d], stroke, strokeWidth: sw});
            }
            return;
        }

        // Flat diamond (no depth)
        this.inner.addPolygon(parent, {vertices: diamond, fill, stroke, strokeWidth});
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {
        const {cx, cy, radius, fill, stroke, strokeWidth} = config;

        // Build iso-ellipse vertices
        const verts: number[] = new Array(CIRCLE_SEGMENTS * 2);
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
            const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
            const px = cx + Math.cos(a) * radius;
            const py = cy + Math.sin(a) * radius;
            const [ox, oy] = this.iso(px, py);
            verts[i * 2] = ox;
            verts[i * 2 + 1] = oy;
        }

        // Dashed circles: decompose to line segments
        if (config.dash || config.dashEnabled) {
            for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
                const ni = (i + 1) % CIRCLE_SEGMENTS;
                this.inner.addLine(parent, {
                    points: [verts[i * 2], verts[i * 2 + 1], verts[ni * 2], verts[ni * 2 + 1]],
                    stroke,
                    strokeWidth,
                    dash: config.dash,
                });
            }
            return;
        }

        // Cube side faces: extrude the lower portion of the ellipse
        if (this.depth > 0 && fill) {
            const d = this.depth;

            // Find extreme vertices
            let rightIdx = 0, leftIdx = 0, bottomIdx = 0;
            let maxX = -Infinity, minX = Infinity, maxY = -Infinity;
            for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
                if (verts[i * 2] > maxX) { maxX = verts[i * 2]; rightIdx = i; }
                if (verts[i * 2] < minX) { minX = verts[i * 2]; leftIdx = i; }
                if (verts[i * 2 + 1] > maxY) { maxY = verts[i * 2 + 1]; bottomIdx = i; }
            }

            // Right side face: rightmost → bottommost, extruded
            const rightFace: number[] = [];
            let idx = rightIdx;
            for (let safety = 0; safety <= CIRCLE_SEGMENTS; safety++) {
                rightFace.push(verts[idx * 2], verts[idx * 2 + 1]);
                if (idx === bottomIdx) break;
                idx = (idx + 1) % CIRCLE_SEGMENTS;
            }
            for (let i = rightFace.length - 2; i >= 0; i -= 2) {
                rightFace.push(rightFace[i], rightFace[i + 1] + d);
            }
            this.inner.addPolygon(parent, {
                vertices: rightFace,
                fill: darkenColor(fill, 0.2),
                stroke,
                strokeWidth: strokeWidth ? strokeWidth * 0.5 : undefined,
            });

            // Left side face: bottommost → leftmost, extruded
            const leftFace: number[] = [];
            idx = bottomIdx;
            for (let safety = 0; safety <= CIRCLE_SEGMENTS; safety++) {
                leftFace.push(verts[idx * 2], verts[idx * 2 + 1]);
                if (idx === leftIdx) break;
                idx = (idx + 1) % CIRCLE_SEGMENTS;
            }
            for (let i = leftFace.length - 2; i >= 0; i -= 2) {
                leftFace.push(leftFace[i], leftFace[i + 1] + d);
            }
            this.inner.addPolygon(parent, {
                vertices: leftFace,
                fill: darkenColor(fill, 0.4),
                stroke,
                strokeWidth: strokeWidth ? strokeWidth * 0.5 : undefined,
            });
        }

        // Top face ellipse
        this.inner.addPolygon(parent, {vertices: verts, fill, stroke, strokeWidth});
    }

    addLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addLine(parent, {...config, points: this.isoFlatPoints(config.points)});
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, {...config, vertices: this.isoFlatPoints(config.vertices)});
    }

    /**
     * Compute the 2D affine transform [a, b, c, d, e, f] that maps a rect
     * at (x, y, w, h) in local space to its iso-projected parallelogram.
     */
    private isoAffine(x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
        const [tlX, tlY] = this.iso(x, y);         // top-left  → origin
        const [trX, trY] = this.iso(x + w, y);     // top-right → +x direction
        const [blX, blY] = this.iso(x, y + h);     // bottom-left → +y direction
        // Affine columns: col1 = (TR - TL) / w, col2 = (BL - TL) / h, translation = TL
        return [
            (trX - tlX) / w, (trY - tlY) / w,      // a, b
            (blX - tlX) / h, (blY - tlY) / h,      // c, d
            tlX, tlY,                                // e, f
        ];
    }

    addText(parent: GroupNode, config: TextConfig): void {
        const w = config.width ?? 0;
        const h = config.height ?? 0;
        if (w > 0 && h > 0) {
            // Project the text box as an iso parallelogram
            this.inner.addText(parent, {
                ...config,
                x: 0,
                y: 0,
                transform: this.isoAffine(config.x, config.y, w, h),
            });
        } else {
            // No bounding box — just reposition the text
            const [ox, oy] = this.iso(config.x, config.y);
            this.inner.addText(parent, {...config, x: ox, y: oy});
        }
    }

    addImage(parent: GroupNode, config: ImageConfig): void {
        this.inner.addImage(parent, {
            ...config,
            x: 0,
            y: 0,
            transform: this.isoAffine(config.x, config.y, config.width, config.height),
        });
    }

    getTransform(): CoordFn {
        const iso = this.iso;
        return (x, y) => {
            const [ox, oy] = iso(x, y);
            return {x: ox, y: oy};
        };
    }

    getInverseTransform(): CoordFn {
        const inv = this.isoInv;
        return (x, y) => {
            const [ox, oy] = inv(x, y);
            return {x: ox, y: oy};
        };
    }

    getExitDepthOffset(): { x: number; y: number } {
        if (this.depth <= 0) return this.inner.getExitDepthOffset();
        const [dx, dy] = this.isoInv(0, this.depth);
        const inner = this.inner.getExitDepthOffset();
        return { x: dx + inner.x, y: dy + inner.y };
    }
}
