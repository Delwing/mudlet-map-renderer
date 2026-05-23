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
