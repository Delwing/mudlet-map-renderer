import type {ViewportBounds} from "../types/Settings";

/**
 * Optional capability interface for readers that materialise rooms
 * per-viewport instead of holding a full object graph (see
 * `SkeletonMapReader` in `src/bigmap/`).
 *
 * The interactive backend detects this capability (via
 * {@link isViewportDataSource}) and, when present:
 *  - pushes padded viewport bounds into the reader before every scene build,
 *    rebuilding the scene when the camera leaves the previously applied
 *    window (rebuild-on-pan), and
 *  - drives the raster LOD overview through {@link forEachInBounds}, which
 *    visits raw room positions without materialising `MapData.Room` objects.
 *
 * All bounds are renderer space (the space `getViewportBounds()` reports).
 */
export interface ViewportDataSource {
    readonly viewportAware: true;
    /**
     * Set the window that subsequent `getPlane().getRooms()` /
     * `getLinkExits()` calls materialise. Implementations must bump their
     * areas' `getVersion()` when the bounds actually change.
     */
    setViewport(bounds: ViewportBounds): void;
    getViewport(): ViewportBounds;
    /** Total rooms on the (area, z) plane — input to the LOD mode decision. */
    getPlaneRoomCount(areaId: number, z: number): number;
    /** Cheap upper bound of the rooms inside `bounds` on that plane. */
    estimateVisibleCount(areaId: number, z: number, bounds: ViewportBounds): number;
    /** Visit every room inside `bounds` (renderer-space x/y + env id). */
    forEachInBounds(
        areaId: number, z: number, bounds: ViewportBounds,
        fn: (x: number, y: number, envId: number) => void,
    ): void;
}

export function isViewportDataSource(reader: unknown): reader is ViewportDataSource {
    return !!reader && (reader as ViewportDataSource).viewportAware === true;
}
