import type {
    DrawingBackend, GroupNode, CoordFn,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
} from "./DrawingBackend";

/** Light cyan used for strokes and lines. */
const LINE_COLOR = '#c0deff';
/** Near-white blue used for text. */
const TEXT_COLOR = '#e0f0ff';

// Blueprint luminance range endpoints (deep blue → lighter blue)
const DARK_R = 20, DARK_G = 40, DARK_B = 80;
const LIGHT_R = 60, LIGHT_G = 100, LIGHT_B = 160;

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
 * Map a color to the blueprint palette based on its perceived luminance.
 * Dark rooms become deep blueprint blue, light rooms become lighter blueprint blue.
 */
function toBlueprint(color: string): string {
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
 * Convert a color to the blueprint line color, preserving any alpha channel.
 */
function toLine(color: string): string {
    const c = parseRgb(color);
    if (!c || c.a >= 1) return LINE_COLOR;
    const line = parseRgb(LINE_COLOR)!;
    return `rgba(${line.r}, ${line.g}, ${line.b}, ${c.a})`;
}

/**
 * Decorator that wraps a DrawingBackend and remaps all colors to a
 * technical blueprint aesthetic (white lines on deep blue).
 *
 * - **Fills** are mapped through a luminance-based blue gradient
 *   (deep blue → lighter blue) so different environment colors stay
 *   visually distinct while keeping the blueprint look.
 * - **Strokes** become light cyan-white.
 * - **Text** uses near-white blue for legibility.
 * - **Images** pass through unchanged.
 *
 * For the best result, also adjust the map settings:
 * ```ts
 * settings.backgroundColor = '#0a1628';
 * settings.lineColor = '#4a7ab5';
 * settings.fontFamily = '"Courier New", monospace';
 * ```
 */
export class BlueprintBackend implements DrawingBackend {
    private readonly inner: DrawingBackend;

    constructor(inner: DrawingBackend) {
        this.inner = inner;
    }

    createGroup(x: number, y: number): GroupNode {
        return this.inner.createGroup(x, y);
    }

    addRect(parent: GroupNode, config: RectConfig): void {
        this.inner.addRect(parent, {
            ...config,
            fill: config.fill ? toBlueprint(config.fill) : undefined,
            stroke: config.stroke ? toLine(config.stroke) : undefined,
        });
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {
        this.inner.addCircle(parent, {
            ...config,
            fill: config.fill ? toBlueprint(config.fill) : undefined,
            stroke: config.stroke ? toLine(config.stroke) : undefined,
        });
    }

    addLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addLine(parent, {
            ...config,
            stroke: config.stroke ? toLine(config.stroke) : undefined,
        });
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, {
            ...config,
            fill: config.fill ? toBlueprint(config.fill) : undefined,
            stroke: config.stroke ? toLine(config.stroke) : undefined,
        });
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, { ...config, fill: TEXT_COLOR });
    }

    addImage(parent: GroupNode, config: ImageConfig): void {
        this.inner.addImage(parent, config);
    }

    getExitDepthOffset(): { x: number; y: number } {
        return this.inner.getExitDepthOffset();
    }

    getTransform(): CoordFn {
        return this.inner.getTransform();
    }

    getInverseTransform(): CoordFn {
        return this.inner.getInverseTransform();
    }
}
