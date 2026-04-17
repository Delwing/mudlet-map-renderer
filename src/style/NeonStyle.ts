import type {
    DrawingBackend, GroupNode,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig,
} from "../backend/DrawingBackend";
import {BaseStyle} from "../backend/DrawingBackend";

/** Bright cyan-green used for text. */
const TEXT_COLOR = '#00ffd0';

/** Default glow alpha. */
const GLOW_ALPHA = 0.3;

/** Glow stroke width multiplier (relative to the original stroke). */
const GLOW_WIDTH_MULT = 3;

function parseRgb(color: string): { r: number; g: number; b: number; a: number } | null {
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1]),
            g: parseInt(rgbaMatch[2]),
            b: parseInt(rgbaMatch[3]),
            a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
        };
    }
    if (color.startsWith('#') && color.length >= 7) {
        return {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16),
            a: 1,
        };
    }
    return null;
}

/** Convert RGB [0-255] to HSL. Returns h [0-360], s [0-1], l [0-1]. */
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

/** Convert HSL to an rgb() or rgba() string. h [0-360], s [0-1], l [0-1]. */
function hslToRgbString(h: number, s: number, l: number, a = 1): string {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r: number, g: number, b: number;
    if (h < 60)      { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    if (a < 1) return `rgba(${ri}, ${gi}, ${bi}, ${a})`;
    return `rgb(${ri}, ${gi}, ${bi})`;
}

/**
 * Convert a color to a bright neon version: preserve hue, boost saturation
 * to near 100% and lightness to 65%.
 */
function toNeon(color: string): { neon: string; h: number; s: number; a: number } {
    const c = parseRgb(color);
    if (!c) return { neon: '#00ff88', h: 150, s: 1, a: 1 };
    const [h, , ] = rgbToHsl(c.r, c.g, c.b);
    const neon = hslToRgbString(h, 0.95, 0.65, c.a);
    return { neon, h, s: 0.95, a: c.a };
}

/** Create a very dark fill with a subtle tint of the given hue. */
function toNeonFill(color: string): string {
    const c = parseRgb(color);
    if (!c) return 'rgb(8, 12, 10)';
    const [h, ,] = rgbToHsl(c.r, c.g, c.b);
    return hslToRgbString(h, 0.4, 0.1, c.a);
}

/** Create a glow stroke: neon color at reduced alpha. */
function toGlowStroke(color: string): string {
    const { h, a } = toNeon(color);
    return hslToRgbString(h, 0.95, 0.65, Math.min(a, GLOW_ALPHA));
}

/** Convert a stroke/line color to its neon equivalent, preserving alpha. */
function toNeonStroke(color: string): string {
    const { neon } = toNeon(color);
    return neon;
}

/**
 * Decorator that wraps a DrawingBackend and remaps all colors to a
 * cyberpunk/neon aesthetic — glowing colored outlines on a dark background.
 *
 * - **Fills** become very dark with a subtle tint of the original hue.
 * - **Strokes** become bright neon colors (hue-preserved, saturation/lightness boosted).
 * - A **glow** effect is achieved by drawing a wider translucent stroke underneath.
 * - **Text** uses bright cyan-green.
 * - **Images** pass through unchanged.
 *
 * For the best result, also adjust the map settings:
 * ```ts
 * settings.backgroundColor = '#0a0a0f';
 * settings.lineColor = '#00ffaa';
 * ```
 */
export class NeonStyle<Inner extends DrawingBackend = DrawingBackend>
    extends BaseStyle<Inner> {

    addRect(parent: GroupNode, config: RectConfig): void {
        // Glow pass: wider translucent neon stroke, no fill
        if (config.stroke) {
            const glowWidth = (config.strokeWidth ?? 1) * GLOW_WIDTH_MULT;
            this.inner.addRect(parent, {
                ...config,
                fill: undefined,
                stroke: toGlowStroke(config.stroke),
                strokeWidth: glowWidth,
            });
        }
        // Main pass: dark fill + neon stroke
        this.inner.addRect(parent, {
            ...config,
            fill: config.fill ? toNeonFill(config.fill) : undefined,
            stroke: config.stroke ? toNeonStroke(config.stroke) : undefined,
        });
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {
        // Glow pass
        if (config.stroke) {
            const glowWidth = (config.strokeWidth ?? 1) * GLOW_WIDTH_MULT;
            this.inner.addCircle(parent, {
                ...config,
                fill: undefined,
                stroke: toGlowStroke(config.stroke),
                strokeWidth: glowWidth,
            });
        }
        // Main pass
        this.inner.addCircle(parent, {
            ...config,
            fill: config.fill ? toNeonFill(config.fill) : undefined,
            stroke: config.stroke ? toNeonStroke(config.stroke) : undefined,
        });
    }

    addLine(parent: GroupNode, config: LineConfig): void {
        // Glow pass
        if (config.stroke) {
            const glowWidth = (config.strokeWidth ?? 1) * GLOW_WIDTH_MULT;
            this.inner.addLine(parent, {
                ...config,
                stroke: toGlowStroke(config.stroke),
                strokeWidth: glowWidth,
                alpha: GLOW_ALPHA,
            });
        }
        // Main pass
        this.inner.addLine(parent, {
            ...config,
            stroke: config.stroke ? toNeonStroke(config.stroke) : undefined,
        });
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, {
            ...config,
            fill: config.fill ? toNeonFill(config.fill) : undefined,
            stroke: config.stroke ? toNeonStroke(config.stroke) : undefined,
        });
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, { ...config, fill: TEXT_COLOR });
    }
}
