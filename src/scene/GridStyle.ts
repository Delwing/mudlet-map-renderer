import type {Settings} from "../Renderer";

export type GridLineData = {
    x1: number; y1: number;
    x2: number; y2: number;
};

export type GridData = {
    lines: GridLineData[];
    stroke: string;
    strokeWidth: number;
};

/**
 * Compute grid lines for a given viewport bounds.
 */
export function computeGrid(settings: Settings, bounds: { x: number; y: number; w: number; h: number }): GridData {
    const gs = settings.gridSize;
    const left = Math.floor(bounds.x / gs) * gs;
    const right = Math.ceil((bounds.x + bounds.w) / gs) * gs;
    const top = Math.floor(bounds.y / gs) * gs;
    const bottom = Math.ceil((bounds.y + bounds.h) / gs) * gs;

    const lines: GridLineData[] = [];

    for (let x = left; x <= right; x += gs) {
        lines.push({x1: x, y1: top, x2: x, y2: bottom});
    }
    for (let y = top; y <= bottom; y += gs) {
        lines.push({x1: left, y1: y, x2: right, y2: y});
    }

    return {lines, stroke: settings.gridColor, strokeWidth: settings.gridLineWidth};
}
