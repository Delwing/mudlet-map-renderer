import type {Settings, ViewportBounds} from "./Renderer";
import type {DrawingBackend, GroupNode, LayerNode} from "./backend/DrawingBackend";

/**
 * Renders and caches the background grid on a dedicated layer.
 * Grid lines are only recreated when the visible bounds change enough
 * to cross a grid-line boundary. No direct Konva dependency.
 */
export class GridRenderer {

    private readonly layer: LayerNode;
    private readonly settings: Settings;
    private readonly backend: DrawingBackend;
    private cachedBounds: { left: number; right: number; top: number; bottom: number } | null = null;

    constructor(layer: LayerNode, settings: Settings, backend: DrawingBackend) {
        this.layer = layer;
        this.settings = settings;
        this.backend = backend;
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

        const buffer = this.settings.gridSize * 2;
        const left = Math.floor((Math.min(minX, maxX) - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const right = Math.ceil((Math.max(minX, maxX) + buffer) / this.settings.gridSize) * this.settings.gridSize;
        const top = Math.floor((Math.min(minY, maxY) - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const bottom = Math.ceil((Math.max(minY, maxY) + buffer) / this.settings.gridSize) * this.settings.gridSize;

        const cached = this.cachedBounds;
        if (cached && cached.left === left && cached.right === right && cached.top === top && cached.bottom === bottom) {
            return;
        }

        this.layer.destroyChildren();

        const group = this.backend.createGroup(0, 0);
        for (let x = left; x <= right; x += this.settings.gridSize) {
            this.backend.addLine(group, {
                points: [x, top, x, bottom],
                stroke: this.settings.gridColor,
                strokeWidth: this.settings.gridLineWidth,
            });
        }
        for (let y = top; y <= bottom; y += this.settings.gridSize) {
            this.backend.addLine(group, {
                points: [left, y, right, y],
                stroke: this.settings.gridColor,
                strokeWidth: this.settings.gridLineWidth,
            });
        }
        this.layer.addNode(group);

        this.cachedBounds = {left, right, top, bottom};
        this.layer.batchDraw();
    }
}
