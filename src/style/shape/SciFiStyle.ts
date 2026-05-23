import type {Shape, Paint, RectShape, CircleShape, LineShape} from "../../scene/Shape";
import type {Style} from "../Style";
import {mapFill, parseRgb} from "./paintMap";

/** Near-white blue for labels. */
const TEXT_COLOR = "#c8eeff";
/** Electric cyan for room borders and glow. */
const STROKE_COLOR = "#00c8ff";
/** Targeting green-cyan for exits and arrows. */
const EXIT_COLOR = "#00ffaa";

const GLOW_ALPHA = 0.2;
const GLOW_WIDTH_MULT = 5;

/** Default hue (cyan) used when the original colour is achromatic. */
const DEFAULT_HUE = 190;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [DEFAULT_HUE, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number, a = 1): string {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r: number, g: number, b: number;
    if      (h < 60)  { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    return a < 1 ? `rgba(${ri},${gi},${bi},${a})` : `rgb(${ri},${gi},${bi})`;
}

/**
 * Derive a fill from the original room colour: preserve the hue so each area
 * keeps its identity, but force a dark lightness and moderate saturation to
 * fit the deep-space aesthetic. Achromatic rooms default to cyan (190°).
 */
function toSciFiFill(color: string): string {
    const c = parseRgb(color);
    if (!c) return hslToRgb(DEFAULT_HUE, 0.55, 0.18);
    const [h, s] = rgbToHsl(c.r, c.g, c.b);
    const hue = s < 0.08 ? DEFAULT_HUE : h;
    return hslToRgb(hue, 0.55, 0.18, c.a);
}

function rewriteFillStroke(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toSciFiFill),
        stroke: paint.stroke ? STROKE_COLOR : paint.stroke,
    };
}

function roomGlowPaint(paint: Paint): Paint {
    return {
        stroke: STROKE_COLOR,
        strokeWidth: (paint.strokeWidth ?? 1) * GLOW_WIDTH_MULT,
        alpha: GLOW_ALPHA,
    };
}

function lineGlowPaint(paint: Paint): Paint {
    return {
        stroke: EXIT_COLOR,
        strokeWidth: (paint.strokeWidth ?? 1) * GLOW_WIDTH_MULT,
        alpha: GLOW_ALPHA,
        dash: paint.dash,
        dashEnabled: paint.dashEnabled,
    };
}

/**
 * Sci-fi / space-exploration aesthetic as a {@link Style}.
 *
 * - Fills preserve the original room hue (so area colours stay distinct) but
 *   are pushed to a fixed dark lightness and moderate saturation, giving each
 *   zone a deep-space tinted look. Achromatic rooms default to cyan.
 * - Room borders use electric cyan (#00C8FF) with a wide translucent glow halo,
 *   giving the holographic-display bloom effect.
 * - Exit lines and arrow polygons use targeting green-cyan (#00FFAA) with a
 *   glow pass, evoking radar / navigation overlays.
 * - Grid lines are rendered as a barely-visible dark tint — no glow.
 * - Text uses near-white blue for crisp legibility on dark fills.
 * - Images and groups pass through unchanged.
 */
export const scifiShapeStyle: Style = {
    transform(shape: Shape): Shape | Shape[] {
        switch (shape.type) {
            case "rect": {
                const main: RectShape = {...shape, paint: rewriteFillStroke(shape.paint)};
                if (!shape.paint.stroke) return main;
                const glow: RectShape = {
                    ...shape,
                    hit: undefined,
                    paint: {...roomGlowPaint(shape.paint), fill: undefined},
                };
                return [glow, main];
            }
            case "circle": {
                const main: CircleShape = {...shape, paint: rewriteFillStroke(shape.paint)};
                if (!shape.paint.stroke) return main;
                const glow: CircleShape = {
                    ...shape,
                    hit: undefined,
                    paint: {...roomGlowPaint(shape.paint), fill: undefined},
                };
                return [glow, main];
            }
            case "line": {
                if (shape.grid) {
                    return {
                        ...shape,
                        paint: shape.paint.stroke
                            ? {...shape.paint, stroke: "#0a1e2e"}
                            : shape.paint,
                    };
                }
                const main: LineShape = {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {...shape.paint, stroke: EXIT_COLOR}
                        : shape.paint,
                };
                if (!shape.paint.stroke) return main;
                const glow: LineShape = {...shape, hit: undefined, paint: lineGlowPaint(shape.paint)};
                return [glow, main];
            }
            case "polygon":
                return {
                    ...shape,
                    paint: {
                        ...shape.paint,
                        fill: shape.paint.fill ? EXIT_COLOR : shape.paint.fill,
                        stroke: undefined,
                    },
                };
            case "text":
                return {...shape, fill: TEXT_COLOR};
            case "image":
            case "group":
                return shape;
        }
    },
};
