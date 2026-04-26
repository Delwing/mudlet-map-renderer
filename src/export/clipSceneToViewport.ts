import type {SceneBuildResult, SceneShapesByLayer} from "../ScenePipeline";
import type {ViewportBounds, Settings} from "../types/Settings";
import type {Shape} from "../scene/Shape";
import {layoutGrid} from "../scene/elements/GridLayout";

/**
 * Interactive-path optimised alternative to {@link clipSceneToViewport}.
 *
 * Returns a single `Map<Shape, boolean>` where `true` means the shape is
 * inside the viewport and `false` means it should be hidden.  Shapes absent
 * from the map are "unmanaged" pass-throughs (noScaling labels, overlays) and
 * should be treated as visible.
 *
 * Allocation budget per frame: 1 Map instead of the 12 Sets + 2 filtered
 * arrays that {@link clipSceneToViewport} produces.
 */
export function buildCullingVisibilityMap(
    result: SceneBuildResult,
    viewportBounds: ViewportBounds,
    settings: Settings,
    transforms?: SceneTransforms,
): Map<Shape, boolean> {
    if (!settings.cullingEnabled) return new Map();

    const {minX, maxX, minY, maxY} = viewportBounds;
    const half = settings.roomSize / 2;
    const fn = transforms?.forward;

    const inView = (bMinX: number, bMinY: number, bMaxX: number, bMaxY: number): boolean => {
        if (fn) {
            const tb = transformedBbox(bMinX, bMinY, bMaxX, bMaxY, fn);
            return tb.maxX >= minX && tb.minX <= maxX && tb.maxY >= minY && tb.minY <= maxY;
        }
        return bMaxX >= minX && bMinX <= maxX && bMaxY >= minY && bMinY <= maxY;
    };

    const visibility = new Map<Shape, boolean>();

    for (const {room, shape} of result.roomShapeRefs.values()) {
        visibility.set(shape, inView(room.x - half, room.y - half, room.x + half, room.y + half));
    }
    for (const {shape, bounds: b} of result.standaloneExitShapeRefs) {
        visibility.set(shape, inView(b.x, b.y, b.x + b.width, b.y + b.height));
    }
    for (const {shape, bounds: b} of result.labelShapeRefs) {
        visibility.set(shape, inView(b.x, b.y, b.x + b.width, b.y + b.height));
    }
    for (const {shape, bounds: b} of result.specialExitShapeRefs) {
        visibility.set(shape, inView(b.x, b.y, b.x + b.width, b.y + b.height));
    }
    for (const {shape, bounds: b} of result.stubShapeRefs) {
        visibility.set(shape, inView(b.x, b.y, b.x + b.width, b.y + b.height));
    }
    for (const {shape, bounds: b} of result.areaExitLabelShapeRefs) {
        visibility.set(shape, inView(b.x, b.y, b.x + b.width, b.y + b.height));
    }

    return visibility;
}

type TransformFn = (x: number, y: number) => {x: number; y: number};

/** Forward and inverse coordinate transforms for styles that warp space (e.g. Isometric). */
export type SceneTransforms = {
    /** World → scene (for culling bounding-box projection). */
    forward?: TransformFn;
    /** Scene → world (for grid-line Cartesian-bounds computation). */
    inverse?: TransformFn;
};

function transformedBbox(
    minX: number, minY: number, maxX: number, maxY: number,
    fn: TransformFn,
): {minX: number; minY: number; maxX: number; maxY: number} {
    const c1 = fn(minX, minY);
    const c2 = fn(maxX, minY);
    const c3 = fn(maxX, maxY);
    const c4 = fn(minX, maxY);
    return {
        minX: Math.min(c1.x, c2.x, c3.x, c4.x),
        minY: Math.min(c1.y, c2.y, c3.y, c4.y),
        maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
        maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
    };
}

/**
 * Filter scene shapes to only those that intersect the given viewport, and
 * generate the grid for that viewport — the shared cull step used by export
 * paths (SVG, PNG).
 *
 * Uses {@link buildCullingVisibilityMap} for the predicate so culling logic
 * lives in one place.  Shapes absent from the map are unmanaged pass-throughs
 * (noScaling labels, overlays) and are always included.
 *
 * Interactive path uses {@link buildCullingVisibilityMap} directly and skips
 * building these filtered arrays.
 *
 * When `settings.cullingEnabled` is false the original {@link SceneShapesByLayer}
 * is returned (with grid appended).
 *
 * `transforms.forward` projects world → rendered space for styles like
 * Isometric that warp coordinates (pass `style.worldToScene` when available).
 * `transforms.inverse` projects rendered → world space (pass `style.sceneToWorld`)
 * for correct grid-line Cartesian-bounds computation under warped styles.
 */
export function clipSceneToViewport(
    result: SceneBuildResult,
    viewportBounds: ViewportBounds,
    settings: Settings,
    transforms?: SceneTransforms,
): SceneShapesByLayer {
    const grid = layoutGrid(viewportBounds, settings, {inverseTransform: transforms?.inverse});

    if (!settings.cullingEnabled) {
        return {...result.sceneShapes, grid};
    }

    const visibility = buildCullingVisibilityMap(result, viewportBounds, settings, transforms);
    return {
        grid,
        link: result.sceneShapes.link.filter(s => visibility.get(s) ?? true),
        room: result.sceneShapes.room.filter(s => visibility.get(s) ?? true),
        topLabel: result.sceneShapes.topLabel,
    };
}
