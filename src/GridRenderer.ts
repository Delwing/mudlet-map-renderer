import type {Settings, ViewportBounds} from "./types/Settings";
import type {DrawingBackend, LayerNode} from "./backend/DrawingBackend";

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
    private inverseTransform: (x: number, y: number) => { x: number; y: number } = (x, y) => ({x, y});

    constructor(layer: LayerNode, settings: Settings, backend: DrawingBackend) {
        this.layer = layer;
        this.settings = settings;
        this.backend = backend;
    }

    setInverseTransform(fn: (x: number, y: number) => { x: number; y: number }) {
        this.inverseTransform = fn;
        this.invalidateCache();
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

        // Viewport bounds are in rendered space. Inverse-transform to Cartesian
        // to find the grid range that covers the visible area.
        const inv = this.inverseTransform;
        const {minX: vMinX, maxX: vMaxX, minY: vMinY, maxY: vMaxY} = viewportBounds;
        const c1 = inv(vMinX, vMinY);
        const c2 = inv(vMaxX, vMinY);
        const c3 = inv(vMaxX, vMaxY);
        const c4 = inv(vMinX, vMaxY);
        const cartMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const cartMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const cartMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const cartMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);

        const buffer = this.settings.gridSize * 2;
        const left = Math.floor((cartMinX - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const right = Math.ceil((cartMaxX + buffer) / this.settings.gridSize) * this.settings.gridSize;
        const top = Math.floor((cartMinY - buffer) / this.settings.gridSize) * this.settings.gridSize;
        const bottom = Math.ceil((cartMaxY + buffer) / this.settings.gridSize) * this.settings.gridSize;

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
