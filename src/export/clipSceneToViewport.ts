import type {SceneBuildResult, SceneShapesByLayer} from "../ScenePipeline";
import type {ViewportBounds, Settings} from "../types/Settings";
import type {Shape} from "../scene/Shape";

type TransformFn = (x: number, y: number) => {x: number; y: number};

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
 * Filter scene shapes to only those that intersect the given viewport —
 * the shared culling step used by every rendering path.
 *
 * Interactive path: {@link KonvaRenderBackend} calls this on every camera
 * change and applies the result by toggling {@link DrawEntry.visible}.
 *
 * Export paths (SVG, PNG): called once before {@link flushSceneShapes}.
 *
 * Mirrors the former CullingManager entry logic exactly:
 *  - Rooms: culled by room-centre bbox (from {@link SceneBuildResult.roomShapeRefs}).
 *  - Standalone exits: culled by exit bounds (from
 *    {@link SceneBuildResult.standaloneExitShapeRefs}).
 *  - All other link shapes (stubs, special exits, labels): always included —
 *    they carry no independent bbox and are typically attached to a room that
 *    is already being culled.
 *  - Grid and topLabel layers: always included.
 *
 * When `settings.cullingEnabled` is false the original {@link SceneShapesByLayer}
 * is returned unchanged.
 *
 * `coordinateTransform` projects world → rendered space for styles like
 * Isometric that warp coordinates (pass `style.worldToScene` when available).
 */
export function clipSceneToViewport(
    result: SceneBuildResult,
    viewportBounds: ViewportBounds,
    settings: Settings,
    coordinateTransform?: TransformFn,
): SceneShapesByLayer {
    if (!settings.cullingEnabled) return result.sceneShapes;

    const {minX, maxX, minY, maxY} = viewportBounds;
    const half = settings.roomSize / 2;
    const fn = coordinateTransform;

    const inView = (bMinX: number, bMinY: number, bMaxX: number, bMaxY: number): boolean => {
        if (fn) {
            const tb = transformedBbox(bMinX, bMinY, bMaxX, bMaxY, fn);
            return tb.maxX >= minX && tb.minX <= maxX && tb.maxY >= minY && tb.minY <= maxY;
        }
        return bMaxX >= minX && bMinX <= maxX && bMaxY >= minY && bMinY <= maxY;
    };

    // Room shapes that have a bbox entry — actual room bodies.
    // Other shapes on the room layer (area name, area-exit labels) have no
    // roomShapeRef and are always included, mirroring the former CullingManager
    // behaviour where only room bodies carried CullEntries.
    const managedRoomShapes = new Set<Shape>();
    const visibleRoomShapes = new Set<Shape>();
    for (const {room, shape} of result.roomShapeRefs.values()) {
        managedRoomShapes.add(shape);
        if (inView(room.x - half, room.y - half, room.x + half, room.y + half)) {
            visibleRoomShapes.add(shape);
        }
    }

    // Standalone exit shapes — inter-room lines with known bbox.
    // Other link shapes (stubs, special exits, labels) have no entry and are
    // always included, same as the former CullingManager where they had no CullEntry.
    const standaloneExitShapes = new Set<Shape>();
    const visibleExitShapes = new Set<Shape>();
    for (const {shape, bounds: b} of result.standaloneExitShapeRefs) {
        standaloneExitShapes.add(shape);
        if (inView(b.x, b.y, b.x + b.width, b.y + b.height)) {
            visibleExitShapes.add(shape);
        }
    }

    return {
        grid: result.sceneShapes.grid,
        link: result.sceneShapes.link.filter(s =>
            !standaloneExitShapes.has(s) || visibleExitShapes.has(s),
        ),
        room: result.sceneShapes.room.filter(s =>
            !managedRoomShapes.has(s) || visibleRoomShapes.has(s),
        ),
        topLabel: result.sceneShapes.topLabel,
    };
}
