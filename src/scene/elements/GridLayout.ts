import type {Settings, ViewportBounds} from "../../types/Settings";
import type {LineShape, Shape} from "../Shape";

export interface GridLayoutOptions {
    /** Inverse coordinate transform (rendered → Cartesian) for warped pipelines. */
    inverseTransform?: (x: number, y: number) => {x: number; y: number};
}

/**
 * Pure layout for the background grid. Returns the line shapes that span the
 * given viewport bounds with one extra grid step of buffer on every edge.
 *
 * Returns an empty array when grids are disabled. Caching is the caller's
 * responsibility (the previous renderer cached by snapped bounds).
 */
export function layoutGrid(
    viewportBounds: ViewportBounds,
    settings: Settings,
    options: GridLayoutOptions = {},
): LineShape[] {
    if (!settings.gridEnabled) return [];

    const inv = options.inverseTransform ?? ((x, y) => ({x, y}));
    const {minX: vMinX, maxX: vMaxX, minY: vMinY, maxY: vMaxY} = viewportBounds;
    const c1 = inv(vMinX, vMinY);
    const c2 = inv(vMaxX, vMinY);
    const c3 = inv(vMaxX, vMaxY);
    const c4 = inv(vMinX, vMaxY);
    const cartMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
    const cartMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
    const cartMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
    const cartMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);

    const buffer = settings.gridSize * 2;
    const left = Math.floor((cartMinX - buffer) / settings.gridSize) * settings.gridSize;
    const right = Math.ceil((cartMaxX + buffer) / settings.gridSize) * settings.gridSize;
    const top = Math.floor((cartMinY - buffer) / settings.gridSize) * settings.gridSize;
    const bottom = Math.ceil((cartMaxY + buffer) / settings.gridSize) * settings.gridSize;

    const lines: LineShape[] = [];
    const paint = {stroke: settings.gridColor, strokeWidth: settings.gridLineWidth};

    for (let x = left; x <= right; x += settings.gridSize) {
        lines.push({
            type: "line",
            points: [x, top, x, bottom],
            paint,
            grid: true,
            layer: "grid",
        });
    }
    for (let y = top; y <= bottom; y += settings.gridSize) {
        lines.push({
            type: "line",
            points: [left, y, right, y],
            paint,
            grid: true,
            layer: "grid",
        });
    }
    return lines;
}

/** Snapped bounds — for cache-key comparison by callers. */
export function gridSnappedBounds(
    viewportBounds: ViewportBounds,
    settings: Settings,
    options: GridLayoutOptions = {},
): {left: number; right: number; top: number; bottom: number} | null {
    if (!settings.gridEnabled) return null;

    const inv = options.inverseTransform ?? ((x, y) => ({x, y}));
    const {minX: vMinX, maxX: vMaxX, minY: vMinY, maxY: vMaxY} = viewportBounds;
    const c1 = inv(vMinX, vMinY);
    const c2 = inv(vMaxX, vMinY);
    const c3 = inv(vMaxX, vMaxY);
    const c4 = inv(vMinX, vMaxY);
    const cartMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
    const cartMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
    const cartMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
    const cartMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);

    const buffer = settings.gridSize * 2;
    return {
        left: Math.floor((cartMinX - buffer) / settings.gridSize) * settings.gridSize,
        right: Math.ceil((cartMaxX + buffer) / settings.gridSize) * settings.gridSize,
        top: Math.floor((cartMinY - buffer) / settings.gridSize) * settings.gridSize,
        bottom: Math.ceil((cartMaxY + buffer) / settings.gridSize) * settings.gridSize,
    };
}
