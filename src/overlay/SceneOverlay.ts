import type {DrawingBackend, GroupNode} from "../backend/DrawingBackend";
import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";

/**
 * Target-agnostic overlay. A {@link SceneOverlay} contributes static geometry
 * to the scene by calling draw primitives on the provided target, so it renders
 * in every output path: interactive canvas, SVG export, PNG export, and any
 * future {@link Exporter}.
 *
 * Called once per scene build; not suited for animated effects — use
 * {@link LiveEffect} for those.
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
     * Contribute geometry to the scene. Called once per scene build by the
     * interactive renderer and by every exporter.
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
