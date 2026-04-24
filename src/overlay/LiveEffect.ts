import type Konva from "konva";
import type {ViewportBounds} from "../types/Settings";

/** Map-space → render-space coordinate transform. */
export type CoordinateTransform = (x: number, y: number) => { x: number; y: number };

/**
 * Interactive-only animated effect. A {@link LiveEffect} receives the Konva
 * overlay layer and a scoped redraw callback so it can add Konva nodes and
 * drive its own animation loop.
 *
 * The `requestRedraw` callback redraws only the overlay layer — prefer it
 * over calling `layer.batchDraw()` directly, as it keeps the repaint scope
 * minimal and backend-controlled.
 *
 * Exporters (SVG, PNG, PDF, …) skip `LiveEffect`s by design — use
 * `SceneOverlay` when you need an overlay to appear in exports.
 *
 * ```ts
 * class PulseEffect implements LiveEffect {
 *     attach(layer: Konva.Layer, requestRedraw: () => void) {
 *         const shape = new Konva.Shape({ sceneFunc: ... });
 *         layer.add(shape);
 *     }
 *     updateViewport(bounds, scale, transform) { ... }
 *     destroy() { ... }
 * }
 * renderer.addLiveEffect('pulse', new PulseEffect());
 * ```
 */
export interface LiveEffect {
    /**
     * Called once when the effect is registered. Add Konva nodes to `layer`
     * and use `requestRedraw()` to trigger overlay repaints.
     */
    attach(layer: Konva.Layer, requestRedraw: () => void): void;
    /**
     * Called on every camera change (pan, zoom, resize). Reposition effect
     * elements or update clipping bounds here.
     */
    updateViewport(
        bounds: ViewportBounds,
        scale: number,
        coordinateTransform: CoordinateTransform,
    ): void;
    destroy(): void;
}
