import type {Shape, Paint, FillStyle} from "../../scene/Shape";
import type {Style, StyleContext} from "../Style";
import {formatRgb, parseRgb} from "./paintMap";

/**
 * DawnBringer-16, the canonical 16-colour pixel-art ramp. Every colour in the
 * scene snaps to its nearest entry, which is what gives the whole map one
 * coherent 8-bit palette instead of a recolour of the original.
 */
const DB16 = [
    "#140c1c", "#442434", "#30346d", "#4e4a4e",
    "#854c30", "#346524", "#d04648", "#757161",
    "#597dce", "#d27d2c", "#8595a1", "#6daa2c",
    "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
];

/** Grid cell as a fraction of room size — 1/8 of a room per pixel. */
const DEFAULT_CELL = 0.125;
/** Border thickness as a fraction of a cell. */
const BORDER_CELLS = 0.5;

export interface PixelArtOptions {
    /**
     * Pixel size as a fraction of the active room size. Smaller = finer
     * grid. Defaults to {@link DEFAULT_CELL} (8 pixels across a room).
     */
    cell?: number;
    /**
     * Palette to quantize into, as `#rrggbb` strings. Defaults to
     * {@link DB16}. Alpha on the source colour is preserved.
     */
    palette?: string[];
}

interface Rgb {r: number; g: number; b: number}

/** Pre-parse a palette once per style instance. */
function parsePalette(palette: string[]): Rgb[] {
    const out: Rgb[] = [];
    for (const c of palette) {
        const p = parseRgb(c);
        if (p) out.push({r: p.r, g: p.g, b: p.b});
    }
    return out;
}

/** Nearest palette entry by squared RGB distance; alpha rides through. */
function quantize(color: string, palette: Rgb[]): string {
    const c = parseRgb(color);
    if (!c || palette.length === 0) return color;
    let best = palette[0];
    let bestD = Infinity;
    for (const p of palette) {
        const dr = p.r - c.r, dg = p.g - c.g, db = p.b - c.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return formatRgb(best.r, best.g, best.b, c.a);
}

/** Snap a coordinate to the pixel grid. */
function snap(v: number, cell: number): number {
    return Math.round(v / cell) * cell;
}

/** Snap an extent, never letting it collapse below one pixel. */
function snapExtent(v: number, cell: number): number {
    return Math.max(cell, snap(v, cell));
}

/** Snap every coordinate in a flat [x, y, …] list. */
function snapPoints(points: number[], cell: number): number[] {
    const out = new Array<number>(points.length);
    for (let i = 0; i < points.length; i++) out[i] = snap(points[i], cell);
    return out;
}

/**
 * Pixel-art / 8-bit aesthetic as a {@link Style} — geometry snapped to a
 * coarse pixel grid, every colour quantized to a fixed 16-entry palette.
 *
 * - Rect / circle / polygon / line coordinates snap to a grid derived from the
 *   active room size, so rooms align to whole pixels the way a tile map does.
 * - Fills and strokes quantize into {@link DB16} (or a supplied palette);
 *   gradients quantize per stop, which usually banks them into hard bands.
 * - Corners square off, dashes snap to whole pixels, and borders thicken to
 *   half a cell so every edge reads as a chunky hard outline.
 *
 * Note: shapes are still drawn antialiased by the underlying canvas / SVG
 * renderer — the look comes from snapped geometry, the quantized palette, and
 * the hard borders, not from disabling smoothing.
 */
export function pixelArtShapeStyle(options: PixelArtOptions = {}): Style {
    const cellFraction = options.cell ?? DEFAULT_CELL;
    const palette = parsePalette(options.palette ?? DB16);

    const q = (color: string) => quantize(color, palette);

    const qFill = (fill: FillStyle | undefined): FillStyle | undefined => {
        if (fill === undefined) return undefined;
        if (typeof fill === "string") return q(fill);
        return {...fill, stops: fill.stops.map(s => ({offset: s.offset, color: q(s.color)}))};
    };

    const pixelPaint = (paint: Paint, cell: number): Paint => ({
        ...paint,
        fill: qFill(paint.fill),
        stroke: paint.stroke ? q(paint.stroke) : paint.stroke,
        strokeWidth: paint.stroke
            ? Math.max(cell * BORDER_CELLS, snap(paint.strokeWidth ?? 0, cell))
            : paint.strokeWidth,
        dash: paint.dash?.map(d => snapExtent(d, cell)),
    });

    return {
        transform(shape: Shape, ctx: StyleContext): Shape {
            const cell = ctx.roomSize * cellFraction;
            if (cell <= 0) return shape;

            switch (shape.type) {
                case "rect":
                    return {
                        ...shape,
                        x: snap(shape.x, cell),
                        y: snap(shape.y, cell),
                        width: snapExtent(shape.width, cell),
                        height: snapExtent(shape.height, cell),
                        // Rounded corners are the one thing a pixel grid cannot say.
                        cornerRadius: 0,
                        paint: pixelPaint(shape.paint, cell),
                    };
                case "circle":
                    return {
                        ...shape,
                        cx: snap(shape.cx, cell),
                        cy: snap(shape.cy, cell),
                        radius: snapExtent(shape.radius, cell),
                        paint: pixelPaint(shape.paint, cell),
                    };
                case "polygon":
                    return {
                        ...shape,
                        vertices: snapPoints(shape.vertices, cell),
                        paint: pixelPaint(shape.paint, cell),
                    };
                case "line":
                    return {
                        ...shape,
                        points: snapPoints(shape.points, cell),
                        paint: pixelPaint(shape.paint, cell),
                        lineCap: "butt",
                        lineJoin: "miter",
                    };
                case "text":
                    return {
                        ...shape,
                        fill: shape.fill ? q(shape.fill) : shape.fill,
                        stroke: shape.stroke ? q(shape.stroke) : shape.stroke,
                    };
                case "group":
                    return {...shape, x: snap(shape.x, cell), y: snap(shape.y, cell)};
                case "image":
                    return shape;
            }
        },
    };
}
