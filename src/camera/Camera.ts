import type {ViewportBounds} from "../types/Settings";
import {TypedEventEmitter} from "../TypedEventEmitter";

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

    private notify() {
        this.emit('change', undefined);
    }
}
