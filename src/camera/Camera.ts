import type {ViewportBounds} from "../types/Settings";
import {TypedEventEmitter} from "../TypedEventEmitter";

/** Pixels-per-world-unit at zoom = 1. Multiply by `Camera.zoom` for actual scale. */
export const BASE_SCALE = 75;

function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** Events fired by {@link Camera}. */
export type CameraEventMap = {
    /** Any state change: zoom, pan, size, animation tick. */
    change: void;
};

/**
 * Engine-agnostic camera — owns transform state, drag, and animation.
 *
 * Subscribers ({@link KonvaRenderer}, {@link CullingManager}, {@link HitTester},
 * scene overlays) listen to the `change` event to react to view updates.
 *
 * No Konva, no DOM. Only dependency is requestAnimationFrame (with a
 * setTimeout fallback for Node.js).
 */
export class Camera extends TypedEventEmitter<CameraEventMap> {
    zoom: number = 1;
    minZoom: number = 0.05;
    position: { x: number; y: number } = {x: 0, y: 0};
    width: number;
    height: number;

    /** When true, resizing re-centers on the last panToMapPoint target. */
    centerOnResize: boolean = true;

    private dragging = false;
    private dragStart = {x: 0, y: 0};
    private positionAtDragStart = {x: 0, y: 0};

    private animationId?: number;

    private batchDepth = 0;
    private batchDirty = false;

    constructor(width: number, height: number) {
        super();
        this.width = width;
        this.height = height;
    }

    getScale(): number {
        return BASE_SCALE * this.zoom;
    }

    setZoom(zoom: number): boolean {
        const clamped = Math.max(this.minZoom, zoom);
        if (this.zoom === clamped) return false;
        this.zoom = clamped;
        this.notify();
        return true;
    }

    /** Zoom keeping the center of the viewport fixed. */
    zoomToCenter(zoom: number): boolean {
        const clamped = Math.max(this.minZoom, zoom);
        if (this.zoom === clamped) return false;

        const oldScale = this.getScale();
        const centerX = this.width / 2;
        const centerY = this.height / 2;

        const centerMapPoint = {
            x: (centerX - this.position.x) / oldScale,
            y: (centerY - this.position.y) / oldScale,
        };

        this.zoom = clamped;
        const newScale = this.getScale();

        this.position = {
            x: centerX - centerMapPoint.x * newScale,
            y: centerY - centerMapPoint.y * newScale,
        };

        this.notify();
        return true;
    }

    /** Zoom keeping a specific screen point fixed (for mouse wheel zoom). */
    zoomToPoint(zoom: number, screenX: number, screenY: number): boolean {
        const oldScale = this.getScale();
        const mapPoint = {
            x: (screenX - this.position.x) / oldScale,
            y: (screenY - this.position.y) / oldScale,
        };

        const clamped = Math.max(this.minZoom, zoom);
        if (this.zoom === clamped) return false;
        this.zoom = clamped;

        const newScale = this.getScale();
        this.position = {
            x: screenX - mapPoint.x * newScale,
            y: screenY - mapPoint.y * newScale,
        };
        this.notify();
        return true;
    }

    /** Bounds of the visible area in map space. */
    getViewportBounds(): ViewportBounds {
        const scale = this.getScale();
        return {
            minX: (0 - this.position.x) / scale,
            maxX: (this.width - this.position.x) / scale,
            minY: (0 - this.position.y) / scale,
            maxY: (this.height - this.position.y) / scale,
        };
    }

    /**
     * Map-space bounds to use for culling. When `cullingBounds` is a
     * screen-pixel sub-rect it is converted to map space via the current
     * camera transform; otherwise the full viewport is returned.
     */
    getCullingViewport(cullingBounds?: {x: number; y: number; width: number; height: number} | null): ViewportBounds {
        if (!cullingBounds) return this.getViewportBounds();
        const scale = this.getScale();
        const pos = this.position;
        return {
            minX: (cullingBounds.x - pos.x) / scale,
            maxX: (cullingBounds.x + cullingBounds.width - pos.x) / scale,
            minY: (cullingBounds.y - pos.y) / scale,
            maxY: (cullingBounds.y + cullingBounds.height - pos.y) / scale,
        };
    }

    /**
     * Create a Camera whose full viewport covers exactly the given world-space bounds.
     * Used by headless exporters that need a Camera but have no real display.
     */
    static forMapBounds(minX: number, maxX: number, minY: number, maxY: number): Camera {
        const scale = BASE_SCALE;
        const camera = new Camera((maxX - minX) * scale, (maxY - minY) * scale);
        camera.zoom = 1;
        camera.position = {x: -minX * scale, y: -minY * scale};
        return camera;
    }

    /**
     * Create a Camera from an explicit render-camera transform (scale + offset).
     * Used by {@link CanvasExporter} to derive culling bounds from the already-
     * computed fitted transform without re-doing the letterbox math.
     */
    static forRenderCamera(width: number, height: number, scale: number, offsetX: number, offsetY: number): Camera {
        const camera = new Camera(width, height);
        camera.zoom = scale / BASE_SCALE;
        camera.position = {x: offsetX, y: offsetY};
        return camera;
    }

    /** Convert client/screen coordinates to map coordinates. */
    clientToMapPoint(clientX: number, clientY: number, containerOffset?: { left: number; top: number }) {
        const stageX = clientX - (containerOffset?.left ?? 0);
        const stageY = clientY - (containerOffset?.top ?? 0);
        const scale = this.getScale();
        if (!scale) return null;
        return {
            x: (stageX - this.position.x) / scale,
            y: (stageY - this.position.y) / scale,
        };
    }

    /** Center on a map coordinate, instantly. */
    panToMapPoint(x: number, y: number) {
        const scale = this.getScale();
        this.position = {
            x: this.width / 2 - x * scale,
            y: this.height / 2 - y * scale,
        };
        this.notify();
    }

    /** Center on a map coordinate, with optional animation. */
    panToMapPointAnimated(x: number, y: number, instant: boolean) {
        if (instant) {
            this.panToMapPoint(x, y);
            return;
        }

        const startPos = {...this.position};
        const scale = this.getScale();
        const targetPos = {
            x: this.width / 2 - x * scale,
            y: this.height / 2 - y * scale,
        };

        this.animate(200, (t) => {
            this.position = {
                x: startPos.x + (targetPos.x - startPos.x) * t,
                y: startPos.y + (targetPos.y - startPos.y) * t,
            };
        });
    }

    /**
     * Compute the zoom level that would fit the given map bounds in the current
     * viewport (with the same padding/insets as {@link fitToMapBounds}).
     */
    computeFitZoom(
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
        insets?: { top?: number; right?: number; bottom?: number; left?: number },
    ): number {
        const mapW = maxX - minX;
        const mapH = maxY - minY;
        if (mapW <= 0 || mapH <= 0) return this.zoom;

        const top = insets?.top ?? 0;
        const right = insets?.right ?? 0;
        const bottom = insets?.bottom ?? 0;
        const left = insets?.left ?? 0;
        const availW = Math.max(1, this.width - left - right);
        const availH = Math.max(1, this.height - top - bottom);

        const padding = 2;
        const zoomX = availW / ((mapW + padding * 2) * BASE_SCALE);
        const zoomY = availH / ((mapH + padding * 2) * BASE_SCALE);
        return Math.min(zoomX, zoomY);
    }

    /**
     * Fit the camera to show the given map bounds with padding.
     * Optional `insets` (screen pixels) reserve space at each edge.
     */
    fitToMapBounds(
        minX: number,
        maxX: number,
        minY: number,
        maxY: number,
        insets?: { top?: number; right?: number; bottom?: number; left?: number },
    ) {
        const mapW = maxX - minX;
        const mapH = maxY - minY;
        if (mapW <= 0 || mapH <= 0) return;

        const top = insets?.top ?? 0;
        const left = insets?.left ?? 0;
        const availW = Math.max(1, this.width - left - (insets?.right ?? 0));
        const availH = Math.max(1, this.height - top - (insets?.bottom ?? 0));

        this.zoom = this.computeFitZoom(minX, maxX, minY, maxY, insets);
        this.minZoom = this.zoom;

        const scale = this.getScale();
        const centerMapX = (minX + maxX) / 2;
        const centerMapY = (minY + maxY) / 2;
        this.position = {
            x: left + availW / 2 - centerMapX * scale,
            y: top + availH / 2 - centerMapY * scale,
        };
        this.notify();
    }

    setSize(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.notify();
    }

    // --- Drag ---

    startDrag(screenX: number, screenY: number) {
        this.cancelAnimation();
        this.dragging = true;
        this.dragStart = {x: screenX, y: screenY};
        this.positionAtDragStart = {...this.position};
    }

    updateDrag(screenX: number, screenY: number) {
        if (!this.dragging) return;
        this.position = {
            x: this.positionAtDragStart.x + (screenX - this.dragStart.x),
            y: this.positionAtDragStart.y + (screenY - this.dragStart.y),
        };
        this.notify();
    }

    endDrag() {
        this.dragging = false;
    }

    isDragging(): boolean {
        return this.dragging;
    }

    // --- Animation ---

    private animate(durationMs: number, update: (t: number) => void) {
        this.cancelAnimation();

        const start = performance.now();
        const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

        const step = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / durationMs, 1);
            update(easeInOut(progress));
            this.notify();

            if (progress < 1) {
                this.animationId = raf(step);
            } else {
                this.animationId = undefined;
            }
        };

        this.animationId = raf(step);
    }

    cancelAnimation() {
        if (this.animationId !== undefined) {
            const caf = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : (id: number) => clearTimeout(id);
            caf(this.animationId);
            this.animationId = undefined;
        }
    }

    isAnimating(): boolean {
        return this.animationId !== undefined;
    }

    /**
     * Run a function that performs multiple camera mutations and emit only one
     * `change` event at the end (if anything actually mutated). Use this when a
     * single logical operation needs to touch more than one camera field —
     * resize-then-recenter, for example — so subscribers never observe a
     * transient inconsistent state (new size with stale position).
     *
     * Nested batches are supported: only the outermost batch emits.
     */
    batch<T>(fn: () => T): T {
        this.batchDepth++;
        try {
            return fn();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0 && this.batchDirty) {
                this.batchDirty = false;
                this.emit('change', undefined);
            }
        }
    }

    private notify() {
        if (this.batchDepth > 0) {
            this.batchDirty = true;
            return;
        }
        this.emit('change', undefined);
    }
}
