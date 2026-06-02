import type {Shape, Paint, FillStyle} from "../../scene/Shape";
import type {Style} from "../Style";
import {hslToRgbString, mapFill, parseRgb, rgbToHsl} from "./paintMap";

/** Near-black "came" colour for the lead between panes. */
const LEADING = "#0a0a0a";
/** Pale glass-white used for text so it reads over dark leading. */
const TEXT_COLOR = "#f4f0e0";

/** Minimum saturation a pane gets — turns dull rooms into coloured glass. */
const MIN_SATURATION = 0.6;
/** Lightness window kept so panes glow rather than wash out or go muddy. */
const MIN_LIGHTNESS = 0.4;
const MAX_LIGHTNESS = 0.62;
/** Stroke-width multiplier for the leading, with a floor so thin edges still lead. */
const LEADING_MULT = 2.2;
const LEADING_MIN = 0.06;

/** Saturate a colour into a jewel-toned glass pane, preserving hue + alpha. */
function toGlass(color: string): string {
    const c = parseRgb(color);
    if (!c) return color;
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    // Achromatic panes (grey) keep their neutral look — they read as frosted glass.
    const sat = s < 0.08 ? s : Math.max(s, MIN_SATURATION);
    const light = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l));
    return hslToRgbString(h, sat, light, c.a);
}

/** Leading width for a pane, scaled up from the original stroke. */
function leadingWidth(strokeWidth: number | undefined): number {
    return Math.max((strokeWidth ?? 0.04) * LEADING_MULT, LEADING_MIN);
}

/**
 * Rewrite a filled shape's paint into a saturated pane with fat dark leading.
 * Panes always get leading even if the source had no stroke, so every room is
 * framed like a piece of glass.
 */
function glassPaint(paint: Paint): Paint {
    const fill: FillStyle | undefined = mapFill(paint.fill, toGlass);
    const leaded = fill !== undefined || paint.stroke !== undefined;
    return {
        ...paint,
        fill,
        stroke: leaded ? LEADING : undefined,
        strokeWidth: leaded ? leadingWidth(paint.strokeWidth) : paint.strokeWidth,
        // Leading is opaque cames — drop any dash so the frame stays solid.
        dash: undefined,
        dashEnabled: undefined,
    };
}

/**
 * Stained-glass aesthetic as a {@link Style} — jewel-toned panes separated by
 * thick near-black leading, glowing on a dark backdrop.
 *
 * - Fills are pushed to high saturation in a mid-lightness window so rooms read
 *   as coloured glass; grey rooms stay neutral (frosted panes). Gradient fills
 *   recolour per stop.
 * - Strokes become fat near-black leading; filled panes gain leading even when
 *   the source had none.
 * - Exit lines become slim leading too, tying the panes together.
 * - Text uses pale glass-white for legibility over the dark cames.
 * - Images and groups pass through unchanged.
 */
export const stainedGlassShapeStyle: Style = {
    transform(shape: Shape): Shape {
        switch (shape.type) {
            case "rect":
            case "circle":
            case "polygon":
                return {...shape, paint: glassPaint(shape.paint)};
            case "line":
                return {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {
                            ...shape.paint,
                            stroke: LEADING,
                            strokeWidth: leadingWidth(shape.paint.strokeWidth),
                        }
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
