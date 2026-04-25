import type {Shape, PolygonShape, Paint} from "../../scene/Shape";
import type {Style} from "../Style";
import {
    createRng,
    hashCoords,
    wobbleCircle,
    wobblePolygonEdges,
    wobblePolyline,
    wobbleRect,
} from "./wobble";

export interface SketchyOptions {
    /** Jitter amount in map units (e.g. 0.015). */
    jitter: number;
    /** Pencil colour for all strokes/fills (e.g. `#444444`). */
    color: string;
}

/** Apply pencil colour to a stroke, preserving any alpha from the original. */
function applyPencilWithAlpha(pencil: string, original: string | undefined): string {
    if (!original) return pencil;
    const alphaMatch = original.match(/^rgba\(.+,\s*([\d.]+)\s*\)$/);
    if (!alphaMatch) return pencil;
    const alpha = parseFloat(alphaMatch[1]);
    if (alpha >= 1) return pencil;
    const r = parseInt(pencil.slice(1, 3), 16);
    const g = parseInt(pencil.slice(3, 5), 16);
    const b = parseInt(pencil.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Hand-drawn pencil wobble as a {@link Style}. Subdivides edges into wobbly
 * segments with seeded perpendicular jitter, so re-renders produce the same
 * pattern.
 *
 * - Rectangles → wobbly polygons (paper-white fill on parchment, pencil stroke).
 *   Rounded-corner rectangles render as a paper-white fill rect plus a wobbly
 *   polygon outline, so the corners stay rounded but the silhouette wobbles.
 * - Circles → wobbly 24-segment polygons.
 * - Lines → wobbled polylines.
 * - Polygons → wobbled edge subdivisions.
 * - Text → repainted in pencil colour.
 * - Images and groups pass through unchanged.
 */
export function sketchyShapeStyle(options: SketchyOptions): Style {
    const {jitter, color: pencil} = options;

    return {
        transform(shape: Shape): Shape | Shape[] {
            switch (shape.type) {
                case "rect": {
                    const rng = createRng(hashCoords(shape.x, shape.y, shape.width, shape.height));
                    const fill = shape.paint.fill ? "#ffffff" : undefined;
                    const stroke = shape.paint.stroke ? pencil : undefined;

                    if (shape.cornerRadius && shape.cornerRadius > 0) {
                        const out: Shape[] = [];
                        if (fill) {
                            // Keep rounded fill rect; only the outline wobbles.
                            out.push({...shape, paint: {fill, stroke: undefined, strokeWidth: 0}});
                        }
                        if (stroke && shape.paint.strokeWidth) {
                            const verts = wobbleRect(shape.x, shape.y, shape.width, shape.height, jitter, rng);
                            const wobbly: PolygonShape = {
                                type: "polygon",
                                vertices: verts,
                                paint: {stroke, strokeWidth: shape.paint.strokeWidth},
                                layer: shape.layer,
                                hit: shape.hit,
                                noScale: shape.noScale,
                            };
                            out.push(wobbly);
                        }
                        if (out.length === 1) return out[0];
                        return out;
                    }

                    const verts = wobbleRect(shape.x, shape.y, shape.width, shape.height, jitter, rng);
                    return {
                        type: "polygon",
                        vertices: verts,
                        paint: {fill, stroke, strokeWidth: shape.paint.strokeWidth ?? 0},
                        layer: shape.layer,
                        hit: shape.hit,
                        noScale: shape.noScale,
                    };
                }
                case "circle": {
                    const rng = createRng(hashCoords(shape.cx, shape.cy, shape.radius));
                    const verts = wobbleCircle(shape.cx, shape.cy, shape.radius, jitter, rng);
                    return {
                        type: "polygon",
                        vertices: verts,
                        paint: {
                            fill: shape.paint.fill ? "#ffffff" : undefined,
                            stroke: shape.paint.stroke ? pencil : undefined,
                            strokeWidth: shape.paint.strokeWidth ?? 0,
                        },
                        layer: shape.layer,
                        hit: shape.hit,
                        noScale: shape.noScale,
                    };
                }
                case "line": {
                    const rng = createRng(hashCoords(...shape.points.slice(0, 4)));
                    const wobbly = wobblePolyline(shape.points, jitter, rng);
                    const stroke = applyPencilWithAlpha(pencil, shape.paint.stroke);
                    const paint: Paint = {...shape.paint, stroke};
                    return {...shape, points: wobbly, paint};
                }
                case "polygon": {
                    const rng = createRng(hashCoords(...shape.vertices.slice(0, 4)));
                    const wobbly = wobblePolygonEdges(shape.vertices, jitter, rng);
                    return {
                        ...shape,
                        vertices: wobbly,
                        paint: {
                            ...shape.paint,
                            fill: shape.paint.fill ? pencil : undefined,
                            stroke: shape.paint.stroke ? pencil : undefined,
                        },
                    };
                }
                case "text":
                    return {...shape, fill: pencil};
                case "image":
                case "group":
                    return shape;
            }
        },
    };
}
