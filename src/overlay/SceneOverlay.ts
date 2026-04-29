import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";
import type {Shape} from "../scene/Shape";

/**
 * Context handed to a {@link SceneOverlay} when it is registered. Gives the
 * overlay access to {@link MapState} events, viewport changes, and a way to
 * request its own re-render.
 */
export interface SceneOverlayContext {
    readonly state: MapState;
    /**
     * Subscribe to viewport changes (pan, zoom, resize). Returns an unsubscribe
     * function — call it from {@link SceneOverlay.detach} to avoid leaks.
     */
    onViewportChange(cb: () => void): () => void;
    /** Request a re-render of this overlay only. Cheap — no full scene rebuild. */
    invalidate(): void;
}

/**
 * Target-agnostic overlay. A {@link SceneOverlay} contributes static geometry
 * to the scene by emitting one or more {@link Shape}s, so it renders in every
 * output path: interactive canvas, SVG export, PNG export, and any future
 * {@link Exporter}.
 *
 * Overlays may opt into reactivity via {@link attach}: subscribe to MapState or
 * viewport events, then call `ctx.invalidate()` to re-render. Exporters skip
 * `attach`/`detach` — they just call {@link render} once.
 *
 * ```ts
 * class BadgeOverlay implements SceneOverlay {
 *     render(state: MapState, bounds: ViewportBounds): Shape {
 *         return {
 *             type: 'circle',
 *             cx: 5, cy: 5,
 *             radius: 0.4,
 *             paint: { fill: '#ff0' },
 *             layer: 'overlay',
 *         };
 *     }
 * }
 *
 * renderer.addSceneOverlay('badge', new BadgeOverlay());
 * ```
 */
export interface SceneOverlay {
    /**
     * Optional. Called once when the overlay is registered with an interactive
     * renderer. Subscribe to events here and call `ctx.invalidate()` when the
     * overlay needs to re-render.
     *
     * Not called by exporters — they render statically via {@link render}.
     */
    attach?(ctx: SceneOverlayContext): void;

    /**
     * Optional. Called when the overlay is removed (or the renderer is
     * destroyed). Unsubscribe from any events registered in {@link attach}.
     */
    detach?(): void;

    /**
     * Contribute geometry to the scene. Called on register, on invalidate, and
     * by every exporter.
     *
     * @returns one or more world-space {@link Shape}s, or `void` to emit
     *   nothing this frame. Shapes carry their own {@link Shape.layer} hint;
     *   leaving it unset routes them to the overlay layer.
     */
    render(
        state: MapState,
        bounds: ViewportBounds,
    ): Shape | Shape[] | void;
}
