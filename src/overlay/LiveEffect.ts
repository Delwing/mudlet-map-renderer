import type Konva from "konva";
import type {ViewportBounds} from "../types/Settings";

/** Map-space → render-space coordinate transform. */
export type CoordinateTransform = (x: number, y: number) => { x: number; y: number };

/**
 * Interactive-only animated effect. A {@link LiveEffect} receives a live Konva
 * layer and viewport updates so it can react to pan/zoom and run its own
 * animation loop.
 *
 * Exporters (SVG, PNG, PDF, …) skip `LiveEffect`s by design — use
 * `SceneOverlay` when you need an overlay to appear in exports.
 *
 * ```ts
 * class PulseEffect implements LiveEffect {
 *     private shape?: Konva.Shape;
 *     attach(layer: Konva.Layer) {
 *         this.shape = new Konva.Shape({ sceneFunc: (ctx) => { ... } });
 *         layer.add(this.shape);
 *     }
 *     updateViewport(bounds, scale) { ... }
 *     destroy() { this.shape?.destroy(); }
 * }
 * renderer.konvaBackend?.addLiveEffect('pulse', new PulseEffect());
 * ```
 */
export interface LiveEffect {
    attach(layer: Konva.Layer): void;
    updateViewport(
        bounds: ViewportBounds,
        scale: number,
        coordinateTransform: CoordinateTransform,
    ): void;
    destroy(): void;
}
