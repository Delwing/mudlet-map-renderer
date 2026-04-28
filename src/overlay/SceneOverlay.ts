import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";
import type {Shape} from "../scene/Shape";

/**
 * State passed to {@link SceneOverlay.draw} on every repaint. Contains
 * everything needed to draw in world-space or screen-space without holding
 * any Konva references.
 */
export interface CanvasDrawState {
    /** Current viewport in world coordinates. */
    bounds: ViewportBounds;
    /** Current zoom scale (world units → canvas pixels). */
    scale: number;
    /** World → scene coordinate transform (identity for flat styles, isometric for IsometricBackend). */
    coordinateTransform: (x: number, y: number) => { x: number; y: number };
    /** Canvas element width in CSS pixels. */
    canvasWidth: number;
    /** Canvas element height in CSS pixels. */
    canvasHeight: number;
    /**
     * Stage offset in CSS pixels. Together with `scale` this lets you convert
     * a world point to screen coordinates:
     *   screenX = worldX * scale + canvasOffset.x
     */
    canvasOffset: { x: number; y: number };
}

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
    /**
     * Register a per-frame callback driven by the backend's animation loop.
     * `dt` is elapsed seconds since the last frame (capped at 0.1 s).
     * The backend repaints the overlay layer after all registered callbacks
     * fire each frame.
     *
     * Returns an unsubscribe function — call it from {@link SceneOverlay.detach}.
     */
    onFrame(cb: (dt: number) => void): () => void;
}

/**
 * Target-agnostic overlay. A {@link SceneOverlay} contributes geometry or
 * direct canvas drawing to the scene. Two rendering modes are available and
 * may be combined:
 *
 * - **{@link render}** — emits {@link Shape} descriptors. Shapes are converted to
 *   recording nodes and appear in every output path: interactive canvas, SVG
 *   export, PNG export, and any future {@link Exporter}.
 *
 * - **{@link draw}** — receives a raw `CanvasRenderingContext2D` and a
 *   {@link CanvasDrawState}. Used for effects that require gradients, compositing,
 *   or particle systems — anything that can't be expressed as a Shape. Exporters
 *   skip `draw()` overlays (same behaviour as the former `LiveEffect`).
 *
 * Overlays opt into reactivity via {@link attach}: subscribe to MapState or
 * viewport events, use {@link SceneOverlayContext.onFrame} for animation, then
 * call `ctx.invalidate()` for data-driven repaints.
 *
 * ```ts
 * // Shape-based (appears in exports)
 * class BadgeOverlay implements SceneOverlay {
 *     render(state, bounds) {
 *         return { type: 'circle', cx: 5, cy: 5, radius: 0.4, paint: { fill: '#ff0' } };
 *     }
 * }
 *
 * // Canvas-based with animation (interactive only)
 * class PulseOverlay implements SceneOverlay {
 *     private t = 0;
 *     attach(ctx) {
 *         this.unsub = ctx.onFrame((dt) => { this.t += dt; });
 *     }
 *     detach() { this.unsub?.(); }
 *     draw(ctx, state) {
 *         const alpha = 0.5 + 0.5 * Math.sin(this.t * 3);
 *         ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
 *         ctx.globalAlpha = alpha;
 *         // ...
 *         ctx.restore();
 *     }
 * }
 *
 * renderer.addSceneOverlay('badge', new BadgeOverlay());
 * renderer.addSceneOverlay('pulse', new PulseOverlay());
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
     * Contribute {@link Shape} geometry to the scene. Called on register, on
     * invalidate, and by every exporter.
     *
     * @returns one or more world-space {@link Shape}s, or `void` to emit
     *   nothing this frame. Shapes carry their own {@link Shape.layer} hint;
     *   leaving it unset routes them to the overlay layer.
     */
    render?(
        state: MapState,
        bounds: ViewportBounds,
    ): Shape | Shape[] | void;

    /**
     * Draw directly onto the canvas using the provided `CanvasRenderingContext2D`.
     * Called on every repaint of the overlay layer (including every animation
     * frame when {@link SceneOverlayContext.onFrame} is in use).
     *
     * The context already has the stage transform applied (world-space drawing
     * works at face value). Reset with `ctx.setTransform(1,0,0,1,0,0)` to
     * draw in screen space.
     *
     * Exporters skip `draw()` overlays — use {@link render} for geometry that
     * must appear in SVG/PNG exports.
     */
    draw?(ctx: CanvasRenderingContext2D, state: CanvasDrawState): void;
}
