import type {Shape, LineShape, PolygonShape} from "../../scene/Shape";
import type {Style} from "../Style";
import {darkenColor} from "../../utils/color";

export type IsometricRotation = number;

export interface IsometricOptions {
    /** Cube side face height. Defaults to 0.18. */
    depth?: number;
    /** Rotation angle in degrees. Defaults to 0. */
    rotation?: IsometricRotation;
}

type IsoFn = (x: number, y: number) => [number, number];

function buildTransform(angleDeg: number): IsoFn {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    return (x, y) => [
        x * cosA - y * sinA,
        (x * sinA + y * cosA) * 0.5,
    ];
}

function buildInverseTransform(angleDeg: number): IsoFn {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    return (u, v) => [
        u * cosA + 2 * v * sinA,
        -u * sinA + 2 * v * cosA,
    ];
}

const CIRCLE_SEGMENTS = 32;

function projectPoints(iso: IsoFn, pts: number[]): number[] {
    const out = new Array<number>(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
        const [ox, oy] = iso(pts[i], pts[i + 1]);
        out[i] = ox;
        out[i + 1] = oy;
    }
    return out;
}

function rectToDiamond(iso: IsoFn, x: number, y: number, w: number, h: number): number[] {
    const [t0x, t0y] = iso(x, y);
    const [t1x, t1y] = iso(x + w, y);
    const [t2x, t2y] = iso(x + w, y + h);
    const [t3x, t3y] = iso(x, y + h);
    return [t0x, t0y, t1x, t1y, t2x, t2y, t3x, t3y];
}

/**
 * 2:1 isometric projection as a {@link Style}.
 *
 * - Rectangles → diamond (rhombus) polygons. Dashed rects decompose to four
 *   dashed line shapes (one per edge). With `depth > 0` and a fill, rooms gain
 *   right + left side faces (darker shades of the fill) drawn beneath the top
 *   diamond plus six outline edges, producing a 3D cube look.
 * - Circles → ellipse polygons (32 segments). Dashed circles decompose to
 *   line segments. With `depth > 0` and a fill, the lower half extrudes into
 *   left + right side faces.
 * - Lines / polygons / grid lines have their coordinates projected.
 * - Text / images keep their position and gain an affine `transform` field
 *   that maps their bounding box to the iso parallelogram (text stays
 *   upright; readers consume `transform` directly).
 * - Group origins are projected; children are projected separately. Because
 *   iso is linear, `iso(g) + iso(c) === iso(g + c)`, so the final positions
 *   line up exactly.
 *
 * Provides `worldToScene` / `sceneToWorld` so `HitTester` and `Camera` can
 * round-trip clicks through the projection. Link-layer groups (exits,
 * special exits, stubs) are shifted down by the cube depth in render space
 * so connectors attach at the cube base instead of the top face.
 */
export function isometricShapeStyle(options: IsometricOptions = {}): Style {
    const rotation = options.rotation ?? 0;
    const depth = options.depth ?? 0.18;
    const iso = buildTransform(rotation);
    const isoInv = buildInverseTransform(rotation);

    function isoAffine(x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
        const [tlX, tlY] = iso(x, y);
        const [trX, trY] = iso(x + w, y);
        const [blX, blY] = iso(x, y + h);
        return [
            (trX - tlX) / w, (trY - tlY) / w,
            (blX - tlX) / h, (blY - tlY) / h,
            tlX, tlY,
        ];
    }

    function projectRect(shape: Extract<Shape, {type: "rect"}>): Shape | Shape[] {
        const {x, y, width: w, height: h, paint} = shape;
        const diamond = rectToDiamond(iso, x, y, w, h);

        // Dashed rects: decompose to 4 dashed lines.
        if (paint.dash || paint.dashEnabled) {
            const lines: LineShape[] = [];
            for (let i = 0; i < 8; i += 2) {
                const ni = (i + 2) % 8;
                lines.push({
                    type: "line",
                    points: [diamond[i], diamond[i + 1], diamond[ni], diamond[ni + 1]],
                    paint: {
                        stroke: paint.stroke,
                        strokeWidth: paint.strokeWidth,
                        dash: paint.dash,
                    },
                    layer: shape.layer,
                });
            }
            return lines;
        }

        // Cube with side faces.
        if (depth > 0 && paint.fill) {
            const out: Shape[] = [];
            // Find bottom-most vertex for cube extrusion.
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

            // Right face, left face (no strokes), then top diamond.
            out.push({
                type: "polygon",
                vertices: [rX, rY, bX, bY, bX, bY + depth, rX, rY + depth],
                paint: {fill: darkenColor(paint.fill, 0.2)},
                layer: shape.layer,
            });
            out.push({
                type: "polygon",
                vertices: [bX, bY, lX, lY, lX, lY + depth, bX, bY + depth],
                paint: {fill: darkenColor(paint.fill, 0.4)},
                layer: shape.layer,
            });
            out.push({
                type: "polygon",
                vertices: diamond,
                paint: {fill: paint.fill},
                layer: shape.layer,
                hit: shape.hit,
            });

            // Outline edges (visible only — top face top edges + outer side edges).
            if (paint.stroke && paint.strokeWidth) {
                const sw = paint.strokeWidth;
                const stroke = paint.stroke;
                const lineLayer = shape.layer;
                const push = (points: number[]) => out.push({
                    type: "line",
                    points,
                    paint: {stroke, strokeWidth: sw},
                    layer: lineLayer,
                });
                push([tX, tY, rX, rY]);
                push([lX, lY, tX, tY]);
                push([rX, rY, rX, rY + depth]);
                push([lX, lY, lX, lY + depth]);
                push([rX, rY + depth, bX, bY + depth]);
                push([bX, bY + depth, lX, lY + depth]);
            }
            return out;
        }

        // Flat diamond.
        return {
            type: "polygon",
            vertices: diamond,
            paint: {fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth},
            layer: shape.layer,
            hit: shape.hit,
            noScale: shape.noScale,
        };
    }

    function projectCircle(shape: Extract<Shape, {type: "circle"}>): Shape | Shape[] {
        const {cx, cy, radius, paint} = shape;
        const verts = new Array<number>(CIRCLE_SEGMENTS * 2);
        for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
            const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
            const [ox, oy] = iso(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
            verts[i * 2] = ox;
            verts[i * 2 + 1] = oy;
        }

        if (paint.dash || paint.dashEnabled) {
            const lines: LineShape[] = [];
            for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
                const ni = (i + 1) % CIRCLE_SEGMENTS;
                lines.push({
                    type: "line",
                    points: [verts[i * 2], verts[i * 2 + 1], verts[ni * 2], verts[ni * 2 + 1]],
                    paint: {
                        stroke: paint.stroke,
                        strokeWidth: paint.strokeWidth,
                        dash: paint.dash,
                    },
                    layer: shape.layer,
                });
            }
            return lines;
        }

        const out: Shape[] = [];
        if (depth > 0 && paint.fill) {
            // Find extreme vertices.
            let rightIdx = 0, leftIdx = 0, bottomIdx = 0;
            let maxX = -Infinity, minX = Infinity, maxY = -Infinity;
            for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
                if (verts[i * 2] > maxX) { maxX = verts[i * 2]; rightIdx = i; }
                if (verts[i * 2] < minX) { minX = verts[i * 2]; leftIdx = i; }
                if (verts[i * 2 + 1] > maxY) { maxY = verts[i * 2 + 1]; bottomIdx = i; }
            }

            const rightFace: number[] = [];
            let idx = rightIdx;
            for (let safety = 0; safety <= CIRCLE_SEGMENTS; safety++) {
                rightFace.push(verts[idx * 2], verts[idx * 2 + 1]);
                if (idx === bottomIdx) break;
                idx = (idx + 1) % CIRCLE_SEGMENTS;
            }
            for (let i = rightFace.length - 2; i >= 0; i -= 2) {
                rightFace.push(rightFace[i], rightFace[i + 1] + depth);
            }
            out.push({
                type: "polygon",
                vertices: rightFace,
                paint: {
                    fill: darkenColor(paint.fill, 0.2),
                    stroke: paint.stroke,
                    strokeWidth: paint.strokeWidth ? paint.strokeWidth * 0.5 : undefined,
                },
                layer: shape.layer,
            });

            const leftFace: number[] = [];
            idx = bottomIdx;
            for (let safety = 0; safety <= CIRCLE_SEGMENTS; safety++) {
                leftFace.push(verts[idx * 2], verts[idx * 2 + 1]);
                if (idx === leftIdx) break;
                idx = (idx + 1) % CIRCLE_SEGMENTS;
            }
            for (let i = leftFace.length - 2; i >= 0; i -= 2) {
                leftFace.push(leftFace[i], leftFace[i + 1] + depth);
            }
            out.push({
                type: "polygon",
                vertices: leftFace,
                paint: {
                    fill: darkenColor(paint.fill, 0.4),
                    stroke: paint.stroke,
                    strokeWidth: paint.strokeWidth ? paint.strokeWidth * 0.5 : undefined,
                },
                layer: shape.layer,
            });
        }

        const top: PolygonShape = {
            type: "polygon",
            vertices: verts,
            paint: {fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth},
            layer: shape.layer,
            hit: shape.hit,
            noScale: shape.noScale,
        };
        out.push(top);
        return out.length === 1 ? out[0] : out;
    }

    return {
        transform(shape: Shape): Shape | Shape[] {
            switch (shape.type) {
                case "rect":
                    return projectRect(shape);
                case "circle":
                    return projectCircle(shape);
                case "line":
                    return {...shape, points: projectPoints(iso, shape.points)};
                case "polygon":
                    return {...shape, vertices: projectPoints(iso, shape.vertices)};
                case "text": {
                    const w = shape.width ?? 0;
                    const h = shape.height ?? 0;
                    if (w > 0 && h > 0) {
                        return {
                            ...shape,
                            x: 0,
                            y: 0,
                            transform: isoAffine(shape.x, shape.y, w, h),
                        };
                    }
                    const [ox, oy] = iso(shape.x, shape.y);
                    return {...shape, x: ox, y: oy};
                }
                case "image":
                    return {
                        ...shape,
                        x: 0,
                        y: 0,
                        transform: isoAffine(shape.x, shape.y, shape.width, shape.height),
                    };
                case "group": {
                    const [ox, oy] = iso(shape.x, shape.y);
                    // Link-layer connectors (exits, special exits, stubs) attach
                    // to the cube base, not the projected top face. Shift the
                    // group origin down by the cube depth in render space.
                    if (depth > 0 && shape.layer === "link") {
                        return {...shape, x: ox, y: oy + depth};
                    }
                    return {...shape, x: ox, y: oy};
                }
            }
        },

        worldToScene(x, y) {
            const [ox, oy] = iso(x, y);
            return {x: ox, y: oy};
        },

        sceneToWorld(x, y) {
            const [ox, oy] = isoInv(x, y);
            return {x: ox, y: oy};
        },
    };
}
