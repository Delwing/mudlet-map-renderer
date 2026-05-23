import type {Shape, Paint} from "../../scene/Shape";
import type {Style} from "../Style";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Dark brown ink used for strokes and outlines. */
const INK = "#4a3728";
/** Very dark brown used for text. */
const INK_TEXT = "#3b2a1a";

// Parchment luminance range endpoints (dark brown → light parchment).
const DARK_R = 139, DARK_G = 115, DARK_B = 85;
const LIGHT_R = 244, LIGHT_G = 228, LIGHT_B = 193;

/**
 * Map a colour to the parchment palette based on its perceived luminance.
 * Dark rooms become dark warm brown, light rooms become light parchment.
 */
function toParchment(color: string): string {
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

/** Convert a colour to dark ink, preserving any alpha channel. */
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
        fill: mapFill(paint.fill, toParchment),
        stroke: paint.stroke ? toInk(paint.stroke) : paint.stroke,
    };
}

/**
 * Warm sepia / old-parchment palette as a {@link Style}.
 *
 * - Fills are mapped through a luminance-based parchment gradient
 *   (dark brown → light parchment) so different environment colours stay
 *   visually distinct while keeping the aged-paper look.
 * - Strokes become dark ink brown.
 * - Text uses a very dark brown for legibility.
 * - Images and groups pass through unchanged (the caller walks group
 *   children separately).
 */
export const parchmentShapeStyle: Style = {
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
