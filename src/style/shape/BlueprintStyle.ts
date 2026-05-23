import type {Shape, Paint} from "../../scene/Shape";
import type {Style} from "../Style";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Light cyan used for strokes and lines. */
const LINE_COLOR = "#c0deff";
/** Near-white blue used for text. */
const TEXT_COLOR = "#e0f0ff";

// Blueprint luminance range endpoints (deep blue → lighter blue).
const DARK_R = 20, DARK_G = 40, DARK_B = 80;
const LIGHT_R = 60, LIGHT_G = 100, LIGHT_B = 160;

/**
 * Map a colour to the blueprint palette based on its perceived luminance.
 * Dark rooms become deep blueprint blue, light rooms lighter blueprint blue.
 */
function toBlueprint(color: string): string {
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

/** Convert a colour to the blueprint line colour, preserving any alpha. */
function toLine(color: string): string {
    const c = parseRgb(color);
    if (!c || c.a >= 1) return LINE_COLOR;
    const line = parseRgb(LINE_COLOR)!;
    return formatRgb(line.r, line.g, line.b, c.a);
}

function rewriteFillStroke(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toBlueprint),
        stroke: paint.stroke ? toLine(paint.stroke) : paint.stroke,
    };
}

/**
 * Technical blueprint aesthetic as a {@link Style} — white lines on deep blue.
 *
 * - Fills are mapped through a luminance-based blue gradient (deep blue →
 *   lighter blue) so environment differences stay visible.
 * - Strokes become light cyan-white.
 * - Text uses near-white blue for legibility.
 * - Images and groups pass through unchanged.
 */
export const blueprintShapeStyle: Style = {
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
                        ? {...shape.paint, stroke: toLine(shape.paint.stroke)}
                        : shape.paint,
                };
            case "text":
                return {...shape, fill: TEXT_COLOR};
            case "image":
            case "group":
                return shape;
        }
    },
};
