import type {DrawingBackend} from "../backend/DrawingBackend";
import type {ViewportBounds} from "../types/Settings";

/** Map-space → render-space coordinate transform. */
export type CoordinateTransform = (x: number, y: number) => { x: number; y: number };

/**
 * Interactive-only animated effect. A {@link LiveEffect} receives the active
 * drawing backend and a scoped redraw callback so it can react to pan/zoom
 * and run its own animation loop without touching Konva internals directly.
 *
 * The `requestRedraw` callback redraws only the overlay layer — prefer it over
 * full stage repaints. Effects that need raw Konva access can cast `backend`
 * to a Konva-specific backend type as an escape hatch.
 *
 * Exporters (SVG, PNG, PDF, …) skip `LiveEffect`s by design — use
 * `SceneOverlay` when you need an overlay to appear in exports.
 *
 * ```ts
 * class PulseEffect implements LiveEffect {
 *     attach(backend: DrawingBackend, requestRedraw: () => void) { ... }
 *     updateViewport(bounds, scale, transform) { ... }
 *     destroy() { ... }
 * }
 * renderer.addLiveEffect('pulse', new PulseEffect());
 * ```
 */
export interface LiveEffect {
    /**
     * Called once when the effect is registered. Set up any animation loops or
     * event listeners here. Use `requestRedraw()` to trigger an overlay repaint.
     */
    attach(backend: DrawingBackend, requestRedraw: () => void): void;
    /**
     * Called on every camera change (pan, zoom, resize). Use this to reposition
     * effect elements or update clipping bounds.
     */
    updateViewport(
        bounds: ViewportBounds,
        scale: number,
        coordinateTransform: CoordinateTransform,
    ): void;
    destroy(): void;
}
