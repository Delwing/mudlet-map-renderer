import type {Shape, Paint} from "../../scene/Shape";
import type {Style} from "../Style";
import type {SceneOverlay, SceneOverlayContext} from "../../overlay/SceneOverlay";
import type {ViewportBounds} from "../../types/Settings";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Aged ink brown used for strokes, outlines, and decorations. */
const INK = "#5a3a22";
/** Darker brown for text legibility. */
const INK_TEXT = "#43301c";

// Aged-map luminance range endpoints (deep tan → warm parchment tan).
const DARK_R = 120, DARK_G = 86, DARK_B = 50;
const LIGHT_R = 232, LIGHT_G = 205, LIGHT_B = 158;

/**
 * Map a colour onto the aged treasure-map palette by perceived luminance —
 * a warmer, more saturated ramp than {@link parchmentShapeStyle} so it reads
 * as a weathered explorer's chart.
 */
function toAged(color: string): string {
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

/** Convert a colour to aged ink, preserving any alpha channel. */
function toInk(color: string): string {
    const c = parseRgb(color);
    if (!c || c.a >= 1) return INK;
    const ink = parseRgb(INK)!;
    return formatRgb(ink.r, ink.g, ink.b, c.a);
}

/** Apply paint rewrites to a single Paint record. */
function rewriteFillStroke(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toAged),
        stroke: paint.stroke ? toInk(paint.stroke) : paint.stroke,
    };
}

/**
 * Aged treasure-map palette as a {@link Style}.
 *
 * Recolours rooms onto a warm weathered-paper ramp and inks every line in
 * faded brown. For the decorative compass rose and double border frame, add
 * {@link treasureMapDecorations} as a scene overlay alongside this style.
 *
 * ```ts
 * renderer.setStyle(TreasureMap);
 * renderer.addSceneOverlay('treasure-decor', treasureMapDecorations());
 * ```
 */
export const treasureMapShapeStyle: Style = {
    transform(shape: Shape): Shape {
        switch (shape.type) {
            case "rect":
            case "circle":
            case "polygon":
                return {...shape, paint: rewriteFillStroke(shape.paint)};
            case "line":
                return {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {...shape.paint, stroke: toInk(shape.paint.stroke)}
                        : shape.paint,
                };
            case "text":
                return {...shape, fill: INK_TEXT};
            case "image":
            case "group":
                return shape;
        }
    },
};

/** Build the eight-point compass star centred at (cx, cy). */
function compassStar(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = [];
    const shortR = radius * 0.42;
    for (let i = 0; i < 8; i++) {
        const angle = (-90 + i * 45) * (Math.PI / 180);
        const r = i % 2 === 0 ? radius : shortR;
        verts.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    return verts;
}

/**
 * Decorative scene overlay for the treasure-map look: a double-line border
 * frame inset from the viewport and a compass rose in the top-right corner.
 *
 * Emitted in world space and pinned to the current viewport, so it tracks the
 * visible region as the user pans/zooms and appears in every export path.
 */
export function treasureMapDecorations(): SceneOverlay {
    let unsubscribe: (() => void) | undefined;
    return {
        attach(ctx: SceneOverlayContext) {
            unsubscribe = ctx.onViewportChange(() => ctx.invalidate());
        },
        detach() {
            unsubscribe?.();
            unsubscribe = undefined;
        },
        render(_state, bounds: ViewportBounds): Shape[] {
            const w = bounds.maxX - bounds.minX;
            const h = bounds.maxY - bounds.minY;
            if (w <= 0 || h <= 0) return [];
            const span = Math.min(w, h);
            const margin = span * 0.05;
            const gap = span * 0.012;
            const lineWidth = span * 0.006;

            const shapes: Shape[] = [];

            // Double border frame.
            for (const inset of [margin, margin + gap]) {
                shapes.push({
                    type: "rect",
                    x: bounds.minX + inset,
                    y: bounds.minY + inset,
                    width: w - inset * 2,
                    height: h - inset * 2,
                    paint: {stroke: INK, strokeWidth: lineWidth},
                    layer: "top",
                });
            }

            // Compass rose, top-right corner.
            const radius = span * 0.07;
            const cx = bounds.maxX - margin - gap - radius * 1.4;
            const cy = bounds.minY + margin + gap + radius * 1.6;

            shapes.push({
                type: "circle",
                cx, cy, radius: radius * 1.25,
                paint: {stroke: INK, strokeWidth: lineWidth},
                layer: "top",
            });
            shapes.push({
                type: "polygon",
                vertices: compassStar(cx, cy, radius),
                paint: {fill: formatRgb(LIGHT_R, LIGHT_G, LIGHT_B, 0.85), stroke: INK, strokeWidth: lineWidth},
                layer: "top",
            });
            shapes.push({
                type: "circle",
                cx, cy, radius: radius * 0.16,
                paint: {fill: INK},
                layer: "top",
            });
            shapes.push({
                type: "text",
                x: cx,
                y: cy - radius * 1.25 - radius * 0.55,
                text: "N",
                fontSize: radius * 0.5,
                fontStyle: "bold",
                fill: INK_TEXT,
                align: "center",
                verticalAlign: "middle",
                layer: "top",
            });

            return shapes;
        },
    };
}
