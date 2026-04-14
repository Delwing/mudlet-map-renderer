import Konva from "konva";
import type {Settings, ViewportBounds} from "./Renderer";

/**
 * Renders and caches the background grid on a dedicated Konva layer.
 * Grid lines are only recreated when the visible bounds change enough
 * to cross a grid-line boundary.
 */
export class GridRenderer {

    private readonly layer: Konva.Layer;
    private readonly settings: Settings;
    private cachedBounds: { left: number; right: number; top: number; bottom: number } | null = null;

    constructor(layer: Konva.Layer, settings: Settings) {
        this.layer = layer;
        this.settings = settings;
    }

    invalidateCache() {
        this.cachedBounds = null;
    }

    render(viewportBounds: ViewportBounds) {
        if (!this.settings.gridEnabled) {
            if (this.cachedBounds !== null) {
                this.layer.destroyChildren();
                this.layer.batchDraw();
                this.cachedBounds = null;
            }
            return;
        }

        const {minX, maxX, minY, maxY} = viewportBounds;

        // Expand bounds slightly for buffer
        const buffer = this.settings.gridSize * 2;
        const left = Math.floor((Math.min(minX, maxX) - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const right = Math.ceil((Math.max(minX, maxX) + buffer) / this.settings.gridSize) * this.settings.gridSize;
        const top = Math.floor((Math.min(minY, maxY) - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const bottom = Math.ceil((Math.max(minY, maxY) + buffer) / this.settings.gridSize) * this.settings.gridSize;

        // Skip recreation if grid bounds haven't changed
        const cached = this.cachedBounds;
        if (cached && cached.left === left && cached.right === right && cached.top === top && cached.bottom === bottom) {
            return;
        }

        this.layer.destroyChildren();

        for (let x = left; x <= right; x += this.settings.gridSize) {
            this.layer.add(new Konva.Line({
                points: [x, top, x, bottom],
                stroke: this.settings.gridColor,
                strokeWidth: this.settings.gridLineWidth,
                listening: false,
                perfectDrawEnabled: false,
            }));
        }

        for (let y = top; y <= bottom; y += this.settings.gridSize) {
            this.layer.add(new Konva.Line({
                points: [left, y, right, y],
                stroke: this.settings.gridColor,
                strokeWidth: this.settings.gridLineWidth,
                listening: false,
                perfectDrawEnabled: false,
            }));
        }

        this.cachedBounds = {left, right, top, bottom};
        this.layer.batchDraw();
    }
}
