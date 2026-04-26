import type {SceneBuildResult, SceneShapesByLayer} from "../ScenePipeline";
import type {ViewportBounds, Settings} from "../types/Settings";
import type {Shape} from "../scene/Shape";
import {layoutGrid} from "../scene/elements/GridLayout";

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
 * generate the grid for that viewport — the shared cull step used by every
 * rendering path.
 *
 * Interactive path: {@link KonvaRenderBackend} calls this on every camera
 * change and applies the result by toggling {@link DrawEntry.visible}. The
 * grid output is ignored there (the backend manages its own cached grid).
 *
 * Export paths (SVG, PNG): called once; result is flushed through
 * {@link flushSceneShapes}. The grid in the returned `SceneShapesByLayer`
 * is the authoritative grid for the export.
 *
 * Culled shape types:
 *  - Rooms: by room-centre bbox (`roomShapeRefs`).
 *  - Standalone exits: by exit bounds (`standaloneExitShapeRefs`).
 *  - Labels (non-noScaling): by world-space bounds (`labelShapeRefs`).
 *  - Custom lines (special exits): by line bounds (`specialExitShapeRefs`).
 *  - Stubs: by line-segment bounds (`stubShapeRefs`).
 *  - Area-exit labels: by placed box bounds (`areaExitLabelShapeRefs`).
 *  - noScaling labels: always included.
 *  - topLabel layer: always included.
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

    // Rooms
    const managedRoomShapes = new Set<Shape>();
    const visibleRoomShapes = new Set<Shape>();
    for (const {room, shape} of result.roomShapeRefs.values()) {
        managedRoomShapes.add(shape);
        if (inView(room.x - half, room.y - half, room.x + half, room.y + half)) {
            visibleRoomShapes.add(shape);
        }
    }

    // Standalone inter-room exits
    const standaloneExitShapes = new Set<Shape>();
    const visibleExitShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.standaloneExitShapeRefs) {
        standaloneExitShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleExitShapes.add(shape);
        }
    }

    // Labels (non-noScaling only; noScaling labels are always included because
    // their Width/Height are in screen pixels, not map units).
    const managedLabelShapes = new Set<Shape>();
    const visibleLabelShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.labelShapeRefs) {
        managedLabelShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleLabelShapes.add(shape);
        }
    }

    // Custom lines (special exits)
    const managedSpecialExitShapes = new Set<Shape>();
    const visibleSpecialExitShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.specialExitShapeRefs) {
        managedSpecialExitShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleSpecialExitShapes.add(shape);
        }
    }

    // Stubs
    const managedStubShapes = new Set<Shape>();
    const visibleStubShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.stubShapeRefs) {
        managedStubShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleStubShapes.add(shape);
        }
    }

    // Area-exit labels (on the room layer)
    const managedAreaExitLabelShapes = new Set<Shape>();
    const visibleAreaExitLabelShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.areaExitLabelShapeRefs) {
        managedAreaExitLabelShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleAreaExitLabelShapes.add(shape);
        }
    }

    return {
        grid,
        link: result.sceneShapes.link.filter(s => {
            if (managedLabelShapes.has(s)) return visibleLabelShapes.has(s);
            if (managedSpecialExitShapes.has(s)) return visibleSpecialExitShapes.has(s);
            if (managedStubShapes.has(s)) return visibleStubShapes.has(s);
            if (standaloneExitShapes.has(s)) return visibleExitShapes.has(s);
            return true;
        }),
        room: result.sceneShapes.room.filter(s => {
            if (managedAreaExitLabelShapes.has(s)) return visibleAreaExitLabelShapes.has(s);
            return !managedRoomShapes.has(s) || visibleRoomShapes.has(s);
        }),
        topLabel: result.sceneShapes.topLabel,
    };
}
