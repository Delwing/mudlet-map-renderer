import type Konva from "konva";
import type {ViewportBounds} from "./Settings";

/**
 * Interface for pluggable visual effects rendered on the map overlay layer.
 *
 * Plugins receive a Konva layer to draw on and viewport updates on pan/zoom.
 * The renderer manages the lifecycle: attach → updateViewport (repeated) → destroy.
 *
 * Built-in example: {@link WeatherOverlay}.
 *
 * ```ts
 * class MyEffect implements OverlayPlugin {
 *     private shape?: Konva.Shape;
 *
 *     attach(layer: Konva.Layer) {
 *         this.shape = new Konva.Shape({ sceneFunc: (ctx) => { ... } });
 *         layer.add(this.shape);
 *     }
 *
 *     updateViewport(bounds: ViewportBounds, scale: number) {
 *         // React to pan/zoom
 *     }
 *
 *     destroy() {
 *         this.shape?.destroy();
 *     }
 * }
 *
 * renderer.addOverlayPlugin('my-effect', new MyEffect());
 * renderer.removeOverlayPlugin('my-effect');
 * ```
 */
export interface OverlayPlugin {
    /** Called once when the plugin is added to the renderer. Draw on this layer. */
    attach(layer: Konva.Layer): void;
    /** Called on every pan/zoom with the visible map bounds and pixel scale. */
    updateViewport(bounds: ViewportBounds, scale: number): void;
    /** Called when the plugin is removed or the renderer is destroyed. Clean up Konva nodes. */
    destroy(): void;
}
