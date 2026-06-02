/**
 * Shared colour-parsing + paint-rewriting helpers used by the shape-based
 * Style implementations (Parchment, Blueprint, Neon).
 *
 * The old BaseStyle decorator versions in `../ParchmentStyle.ts`,
 * `../BlueprintStyle.ts`, and `../NeonStyle.ts` keep their own copies for
 * now; they're deleted in step 11.
 */

import type {FillStyle} from "../../scene/Shape";

/**
 * Apply a colour-mapping function to a {@link FillStyle}. Strings pass
 * through the mapper directly; gradients recolour every stop, leaving
 * geometry untouched. Lets styles tint gradient-filled rooms (ambient
 * lighting, palette swaps) without losing the gradient.
 */
export function mapFill(
    fill: FillStyle | undefined,
    mapper: (color: string) => string,
): FillStyle | undefined {
    if (fill === undefined) return undefined;
    if (typeof fill === "string") return mapper(fill);
    return {
        ...fill,
        stops: fill.stops.map(s => ({offset: s.offset, color: mapper(s.color)})),
    };
}

export interface ParsedRgb {
    r: number;
    g: number;
    b: number;
    /** 0..1 alpha — defaults to 1 when not present. */
    a: number;
}

/**
 * Parse a colour string in `rgb(r, g, b)`, `rgba(r, g, b, a)`, or
 * `#rrggbb` form. Returns `null` for anything else (named colours,
 * `hsl(...)`, etc.) so callers can fall back to a default.
 */
export function parseRgb(color: string): ParsedRgb | null {
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
        return {
            r: parseInt(rgbaMatch[1]),
            g: parseInt(rgbaMatch[2]),
            b: parseInt(rgbaMatch[3]),
            a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
        };
    }
    if (color.startsWith("#") && color.length >= 7) {
        return {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16),
            a: 1,
        };
    }
    return null;
}

/** Format an `rgb(r, g, b)` or `rgba(r, g, b, a)` string. */
export function formatRgb(r: number, g: number, b: number, a = 1): string {
    if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
    return `rgb(${r}, ${g}, ${b})`;
}

/** Perceived luminance in [0, 1] using ITU-R BT.601 weights. */
export function luminance(c: ParsedRgb): number {
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/**
 * Convert 0..255 RGB to HSL with hue in degrees and saturation/lightness in
 * [0, 1]. Achromatic colours report hue 0. Shared by the newer styles
 * (StainedGlass, …); Neon and SciFi keep their own local copies.
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

/** Build an `rgb(...)` / `rgba(...)` string from HSL (hue degrees, s/l in [0,1]). */
export function hslToRgbString(h: number, s: number, l: number, a = 1): string {
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
    return formatRgb(
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
        a,
    );
}
