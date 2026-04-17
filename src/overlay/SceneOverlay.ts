import type {DrawingBackend, GroupNode} from "../backend/DrawingBackend";
import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";

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
 * to the scene by calling draw primitives on the provided target, so it renders
 * in every output path: interactive canvas, SVG export, PNG export, and any
 * future {@link Exporter}.
 *
 * Overlays may opt into reactivity via {@link attach}: subscribe to MapState or
 * viewport events, then call `ctx.invalidate()` to re-render. Exporters skip
 * `attach`/`detach` — they just call {@link render} once.
 *
 * ```ts
 * class BadgeOverlay implements SceneOverlay {
 *     render(target: DrawingBackend, state: MapState, bounds: ViewportBounds) {
 *         const group = target.createGroup(0, 0);
 *         target.addCircle(group, {cx: 5, cy: 5, radius: 0.4, fill: '#ff0'});
 *         return group;
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
     * @returns a `GroupNode` (or array of them) that the renderer will attach
     *   to the overlay layer. Return `void` to emit nothing this frame.
     */
    render(
        target: DrawingBackend,
        state: MapState,
        bounds: ViewportBounds,
    ): GroupNode | GroupNode[] | void;
}
