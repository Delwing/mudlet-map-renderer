import type {Shape, Paint, RectShape, CircleShape, PolygonShape} from "../../scene/Shape";
import type {Style} from "../Style";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Contour-line brown drawn as concentric rings inside each room. */
const CONTOUR = "#7a6a48";
/** Muted brown for exit lines. */
const PATH = "#8a7a55";
/** Dark sepia for text. */
const TEXT_COLOR = "#4a3f28";

// Earthy elevation palette: low/dark rooms read mossy green, high/light rooms
// pale tan — like a shaded relief map.
const DARK_R = 78, DARK_G = 93, DARK_B = 52;
const LIGHT_R = 221, LIGHT_G = 207, LIGHT_B = 166;

/** Number of inset contour rings drawn inside each room. */
const RINGS = 2;
/** Gap between rings as a fraction of the shape's smaller half-extent. */
const RING_GAP = 0.26;
/** Thin contour stroke width. */
const CONTOUR_WIDTH = 0.02;

/** Map a colour to the earthy elevation palette by luminance. */
function toEarth(color: string): string {
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

function earthPaint(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toEarth),
        stroke: paint.stroke ? CONTOUR : paint.stroke,
    };
}

/** A stroke-only contour-ring paint. */
const ringPaint: Paint = {stroke: CONTOUR, strokeWidth: CONTOUR_WIDTH};

/**
 * Topographic / contour-map aesthetic as a {@link Style}. Rooms get an earthy
 * elevation palette and a set of concentric inset "contour" rings, so each room
 * reads like a hill on a shaded relief map.
 *
 * - Rect / circle / polygon: emit the earth-toned base shape, then up to
 *   {@link RINGS} stroke-only rings inset toward the centre. Rings collapse and
 *   are skipped for rooms too small to hold them.
 * - Exit lines become muted brown paths.
 * - Text uses dark sepia.
 * - Images and groups pass through unchanged.
 */
export const topographicShapeStyle: Style = {
    transform(shape: Shape): Shape | Shape[] {
        switch (shape.type) {
            case "rect": {
                const base: RectShape = {...shape, paint: earthPaint(shape.paint)};
                if (!shape.paint.fill) return base;
                const out: Shape[] = [base];
                const gap = Math.min(shape.width, shape.height) / 2 * RING_GAP;
                const minSide = Math.min(shape.width, shape.height) * 0.12;
                for (let k = 1; k <= RINGS; k++) {
                    const inset = gap * k;
                    const w = shape.width - inset * 2;
                    const h = shape.height - inset * 2;
                    if (w <= minSide || h <= minSide) break;
                    out.push({
                        type: "rect",
                        x: shape.x + inset,
                        y: shape.y + inset,
                        width: w,
                        height: h,
                        cornerRadius: shape.cornerRadius,
                        paint: ringPaint,
                        layer: shape.layer,
                        noScale: shape.noScale,
                    });
                }
                return out;
            }
            case "circle": {
                const base: CircleShape = {...shape, paint: earthPaint(shape.paint)};
                if (!shape.paint.fill) return base;
                const out: Shape[] = [base];
                const gap = shape.radius * RING_GAP;
                for (let k = 1; k <= RINGS; k++) {
                    const r = shape.radius - gap * k;
                    if (r <= shape.radius * 0.12) break;
                    out.push({
                        type: "circle",
                        cx: shape.cx,
                        cy: shape.cy,
                        radius: r,
                        paint: ringPaint,
                        layer: shape.layer,
                        noScale: shape.noScale,
                    });
                }
                return out;
            }
            case "polygon": {
                const base: PolygonShape = {...shape, paint: earthPaint(shape.paint)};
                if (!shape.paint.fill) return base;
                const out: Shape[] = [base];
                const n = shape.vertices.length / 2;
                // Centroid of the vertices; rings scale vertices toward it.
                let cx = 0, cy = 0;
                for (let i = 0; i < n; i++) {
                    cx += shape.vertices[i * 2];
                    cy += shape.vertices[i * 2 + 1];
                }
                cx /= n; cy /= n;
                for (let k = 1; k <= RINGS; k++) {
                    const scale = 1 - RING_GAP * k;
                    if (scale <= 0.15) break;
                    const verts: number[] = [];
                    for (let i = 0; i < n; i++) {
                        verts.push(
                            cx + (shape.vertices[i * 2] - cx) * scale,
                            cy + (shape.vertices[i * 2 + 1] - cy) * scale,
                        );
                    }
                    out.push({
                        type: "polygon",
                        vertices: verts,
                        paint: ringPaint,
                        layer: shape.layer,
                        noScale: shape.noScale,
                    });
                }
                return out;
            }
            case "line":
                return shape.paint.stroke
                    ? {...shape, paint: {...shape.paint, stroke: PATH}}
                    : shape;
            case "text":
                return {...shape, fill: TEXT_COLOR};
            case "image":
            case "group":
                return shape;
        }
    },
};
