import type {Shape, Paint, RectShape, CircleShape, LineShape} from "../../scene/Shape";
import type {Style} from "../Style";
import {parseRgb} from "./paintMap";

/** Bright cyan-green used for text. */
const TEXT_COLOR = "#00ffd0";

/** Default glow alpha. */
const GLOW_ALPHA = 0.3;

/** Glow stroke width multiplier (relative to the original stroke). */
const GLOW_WIDTH_MULT = 3;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h * 360, s, l];
}

function hslToRgbString(h: number, s: number, l: number, a = 1): string {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r: number, g: number, b: number;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    if (a < 1) return `rgba(${ri}, ${gi}, ${bi}, ${a})`;
    return `rgb(${ri}, ${gi}, ${bi})`;
}

function neonHueAlpha(color: string): {h: number; a: number} {
    const c = parseRgb(color);
    if (!c) return {h: 150, a: 1};
    const [h] = rgbToHsl(c.r, c.g, c.b);
    return {h, a: c.a};
}

function toNeonStroke(color: string): string {
    const {h, a} = neonHueAlpha(color);
    return hslToRgbString(h, 0.95, 0.65, a);
}

function toNeonFill(color: string): string {
    const c = parseRgb(color);
    if (!c) return "rgb(8, 12, 10)";
    const [h] = rgbToHsl(c.r, c.g, c.b);
    return hslToRgbString(h, 0.4, 0.1, c.a);
}

function toGlowStroke(color: string): string {
    const {h, a} = neonHueAlpha(color);
    return hslToRgbString(h, 0.95, 0.65, Math.min(a, GLOW_ALPHA));
}

function neonPaint(paint: Paint): Paint {
    return {
        ...paint,
        fill: paint.fill ? toNeonFill(paint.fill) : paint.fill,
        stroke: paint.stroke ? toNeonStroke(paint.stroke) : paint.stroke,
    };
}

function glowPaint(paint: Paint, withAlpha = false): Paint {
    if (!paint.stroke) return paint;
    const glowWidth = (paint.strokeWidth ?? 1) * GLOW_WIDTH_MULT;
    return {
        stroke: toGlowStroke(paint.stroke),
        strokeWidth: glowWidth,
        dash: paint.dash,
        dashEnabled: paint.dashEnabled,
        alpha: withAlpha ? GLOW_ALPHA : paint.alpha,
    };
}

/**
 * Cyberpunk / neon aesthetic as a {@link Style} — glowing coloured outlines
 * on a dark background.
 *
 * - Fills become very dark with a subtle tint of the original hue.
 * - Strokes become bright neon (hue-preserved, saturation/lightness boosted).
 * - A glow effect is added for stroked rect / circle / line shapes by emitting
 *   an extra wider translucent shape **before** the main one, so callers see
 *   `[glow, main]` (the order in which they should be rendered).
 * - Polygons get the neon repaint without a glow pass — same as the legacy
 *   decorator, since polygons in the pipeline are inner-exit triangles and
 *   exit arrowheads where a glow halo reads as visual noise.
 * - Text uses bright cyan-green.
 * - Images and groups pass through unchanged.
 */
export const neonShapeStyle: Style = {
    transform(shape: Shape): Shape | Shape[] {
        switch (shape.type) {
            case "rect": {
                const main: RectShape = {...shape, paint: neonPaint(shape.paint)};
                if (!shape.paint.stroke) return main;
                const glow: RectShape = {
                    ...shape,
                    paint: {...glowPaint(shape.paint), fill: undefined},
                };
                return [glow, main];
            }
            case "circle": {
                const main: CircleShape = {...shape, paint: neonPaint(shape.paint)};
                if (!shape.paint.stroke) return main;
                const glow: CircleShape = {
                    ...shape,
                    paint: {...glowPaint(shape.paint), fill: undefined},
                };
                return [glow, main];
            }
            case "line": {
                const main: LineShape = {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {...shape.paint, stroke: toNeonStroke(shape.paint.stroke)}
                        : shape.paint,
                };
                if (!shape.paint.stroke) return main;
                const glow: LineShape = {...shape, paint: glowPaint(shape.paint, true)};
                return [glow, main];
            }
            case "polygon":
                return {...shape, paint: neonPaint(shape.paint)};
            case "text":
                return {...shape, fill: TEXT_COLOR};
            case "image":
            case "group":
                return shape;
        }
    },
};
