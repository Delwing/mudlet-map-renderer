import type {Shape, Paint, RectShape, PolygonShape} from "../../scene/Shape";
import type {Style, StyleContext} from "../Style";
import {formatRgb, luminance, parseRgb} from "./paintMap";

/** Near-black asphalt used for dark room fills and strokes. */
const ASPHALT = "#1a1a1a";
/** Bright safety yellow for stripe fills and text. */
const CAUTION_YELLOW = "#ffc200";
/** Safety orange used for exit lines and polygon arrows. */
const EXIT_COLOR = "#ff6600";

// Luminance gradient endpoints (non-striped shapes: circles, etc.)
const DARK_R = 26, DARK_G = 26, DARK_B = 26;
const LIGHT_R = 255, LIGHT_G = 194, LIGHT_B = 0;

function toConstruction(color: string): string {
    const c = parseRgb(color);
    if (!c) return formatRgb(LIGHT_R, LIGHT_G, LIGHT_B);
    const lum = luminance(c);
    return formatRgb(
        Math.round(DARK_R + (LIGHT_R - DARK_R) * lum),
        Math.round(DARK_G + (LIGHT_G - DARK_G) * lum),
        Math.round(DARK_B + (LIGHT_B - DARK_B) * lum),
        c.a,
    );
}

function rewriteFillStroke(paint: Paint): Paint {
    return {
        ...paint,
        fill: paint.fill ? toConstruction(paint.fill) : paint.fill,
        stroke: paint.stroke ? ASPHALT : paint.stroke,
    };
}

// --- Diagonal stripe clipping via Sutherland-Hodgman ---

type Pt = [number, number];

/** Clip a convex polygon to the half-plane a·x + b·y ≥ c. */
function clipHalfplane(poly: Pt[], a: number, b: number, c: number): Pt[] {
    const out: Pt[] = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
        const curr = poly[i];
        const next = poly[(i + 1) % n];
        const dc = a * curr[0] + b * curr[1] - c;
        const dn = a * next[0] + b * next[1] - c;
        if (dc >= 0) out.push(curr);
        if ((dc > 0 && dn < 0) || (dc < 0 && dn > 0)) {
            const t = dc / (dc - dn);
            out.push([curr[0] + t * (next[0] - curr[0]), curr[1] + t * (next[1] - curr[1])]);
        }
    }
    return out;
}

/**
 * Return flat vertex arrays for the yellow stripe polygons that fall inside
 * the given rect. Stripes run at 45° in the "/" direction (x + y = const),
 * matching classic hazard-tape markings.
 */
function rectStripeVertices(
    x: number, y: number, w: number, h: number, roomSize: number,
): number[][] {
    const corners: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const period = roomSize * 0.4;
    const half = period * 0.35;
    const uMin = x + y;
    const uMax = x + w + y + h;
    const startK = Math.floor(uMin / period) - 1;
    const endK = Math.ceil(uMax / period) + 1;
    const result: number[][] = [];

    for (let k = startK; k <= endK; k++) {
        const u1 = k * period;
        const u2 = u1 + half;
        // Yellow band: u1 ≤ x + y ≤ u2
        let poly = clipHalfplane(corners, 1, 1, u1);   // x + y ≥ u1
        poly = clipHalfplane(poly, -1, -1, -u2);        // x + y ≤ u2
        if (poly.length >= 3) result.push(poly.flatMap(p => [p[0], p[1]]));
    }

    return result;
}

/**
 * Construction-site hazard aesthetic as a {@link Style}.
 *
 * Rect rooms get diagonal yellow/black stripes: the rect is rendered as a
 * dark asphalt base, then yellow stripe polygons (clipped to the room bounds
 * via Sutherland-Hodgman) are emitted on top, then the black border is drawn
 * last so room edges stay crisp.  The stripe period scales with `roomSize`
 * so markings look consistent across zoom levels and room-size settings.
 *
 * Other shape types:
 * - Circles use a luminance-mapped gradient (asphalt → safety yellow).
 * - Exit lines and polygon arrows become safety orange (#FF6600).
 * - Text uses safety yellow.
 * - Images and groups pass through unchanged.
 */
export const constructionShapeStyle: Style = {
    transform(shape: Shape, ctx: StyleContext): Shape | Shape[] {
        switch (shape.type) {
            case "rect": {
                if (!shape.paint.fill) {
                    // Stroke-only rect — just recolour, no stripes needed.
                    return {...shape, paint: rewriteFillStroke(shape.paint)};
                }

                // 1. Dark asphalt base (carries hit info, fill only).
                const base: RectShape = {
                    ...shape,
                    paint: {fill: ASPHALT, strokeWidth: shape.paint.strokeWidth},
                };

                // 2. Yellow diagonal stripes clipped to the room rect.
                const verts = rectStripeVertices(shape.x, shape.y, shape.width, shape.height, ctx.roomSize);
                const stripes: PolygonShape[] = verts.map(v => ({
                    type: "polygon" as const,
                    vertices: v,
                    layer: shape.layer,
                    paint: {fill: CAUTION_YELLOW, alpha: 0.65},
                }));

                // 3. Black border on top — no fill, no hit (hit is on base).
                const border: RectShape = {
                    ...shape,
                    hit: undefined,
                    paint: {stroke: ASPHALT, strokeWidth: shape.paint.strokeWidth},
                };

                return [base, ...stripes, border];
            }

            case "circle":
                return {...shape, paint: rewriteFillStroke(shape.paint)};

            case "polygon":
                return {
                    ...shape,
                    paint: {
                        ...shape.paint,
                        fill: shape.paint.fill ? EXIT_COLOR : shape.paint.fill,
                        stroke: shape.paint.stroke ? ASPHALT : shape.paint.stroke,
                    },
                };

            case "line":
                return {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {...shape.paint, stroke: EXIT_COLOR}
                        : shape.paint,
                };

            case "text":
                return {...shape, fill: EXIT_COLOR, stroke: ASPHALT, strokeWidth: ctx.roomSize * 0.25};

            case "image":
            case "group":
                return shape;
        }
    },
};
