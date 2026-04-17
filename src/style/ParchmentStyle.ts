import type {
    DrawingBackend, GroupNode,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig,
} from "../backend/DrawingBackend";
import {BaseStyle} from "../backend/DrawingBackend";

/** Dark brown ink used for strokes and outlines. */
const INK = '#4a3728';
/** Very dark brown used for text. */
const INK_TEXT = '#3b2a1a';

// Parchment luminance range endpoints (dark brown → light parchment)
const DARK_R = 139, DARK_G = 115, DARK_B = 85;
const LIGHT_R = 244, LIGHT_G = 228, LIGHT_B = 193;

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

/**
 * Map a color to the parchment palette based on its perceived luminance.
 * Dark rooms become dark warm brown, light rooms become light parchment.
 */
function toParchment(color: string): string {
    const c = parseRgb(color);
    if (!c) return `rgb(${LIGHT_R}, ${LIGHT_G}, ${LIGHT_B})`;
    const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    const r = Math.round(DARK_R + (LIGHT_R - DARK_R) * lum);
    const g = Math.round(DARK_G + (LIGHT_G - DARK_G) * lum);
    const b = Math.round(DARK_B + (LIGHT_B - DARK_B) * lum);
    if (c.a < 1) return `rgba(${r}, ${g}, ${b}, ${c.a})`;
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Convert a color to dark ink, preserving any alpha channel.
 */
function toInk(color: string): string {
    const c = parseRgb(color);
    if (!c || c.a >= 1) return INK;
    const ink = parseRgb(INK)!;
    return `rgba(${ink.r}, ${ink.g}, ${ink.b}, ${c.a})`;
}

/**
 * Decorator that wraps a DrawingBackend and remaps all colors to a
 * warm sepia / old-parchment palette.
 *
 * - **Fills** are mapped through a luminance-based parchment gradient
 *   (dark brown → light parchment) so different environment colors stay
 *   visually distinct while keeping the aged-paper look.
 * - **Strokes** become dark ink brown.
 * - **Text** uses a very dark brown for legibility.
 * - **Images** pass through unchanged.
 *
 * Composes naturally with {@link SketchyStyle} for the full old-map aesthetic:
 * ```ts
 * // Parchment colors only
 * const backend = new ParchmentStyle(new CanvasBackend());
 *
 * // Parchment + hand-drawn wobble
 * const backend = new SketchyStyle(
 *     new ParchmentStyle(new CanvasBackend()),
 *     0.012, '#4a3728',
 * );
 * ```
 *
 * For the best result, also adjust the map settings:
 * ```ts
 * settings.backgroundColor = '#f4e4c1';
 * settings.lineColor = '#5c4033';
 * settings.gridColor = 'rgba(139, 119, 101, 0.15)';
 * settings.fontFamily = 'Georgia, serif';
 * ```
 */
export class ParchmentStyle<Inner extends DrawingBackend = DrawingBackend>
    extends BaseStyle<Inner> {

    addRect(parent: GroupNode, config: RectConfig): void {
        this.inner.addRect(parent, {
            ...config,
            fill: config.fill ? toParchment(config.fill) : undefined,
            stroke: config.stroke ? toInk(config.stroke) : undefined,
        });
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {
        this.inner.addCircle(parent, {
            ...config,
            fill: config.fill ? toParchment(config.fill) : undefined,
            stroke: config.stroke ? toInk(config.stroke) : undefined,
        });
    }

    addLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addLine(parent, {
            ...config,
            stroke: config.stroke ? toInk(config.stroke) : undefined,
        });
    }

    addGridLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addGridLine(parent, {
            ...config,
            stroke: config.stroke ? toInk(config.stroke) : undefined,
        });
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, {
            ...config,
            fill: config.fill ? toParchment(config.fill) : undefined,
            stroke: config.stroke ? toInk(config.stroke) : undefined,
        });
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, { ...config, fill: INK_TEXT });
    }
}
