import {isViewportDataSource} from "../reader/ViewportDataSource";
import type {IMapReader} from "../reader/MapReader";

/**
 * Headless exporters (`CanvasExporter`, `SvgExporter`) rebuild their scene
 * directly from `state.mapReader`, independent of the live interactive
 * camera. For a viewport-virtualized reader (`SkeletonMapReader`) that reader
 * only materialises rooms inside whatever viewport was LAST pushed onto it —
 * normally by the interactive backend, whose viewport push is itself
 * deferred to a `requestAnimationFrame` (see `KonvaRenderBackend.refresh()`),
 * so an export that runs synchronously right after a camera change (e.g. a
 * `fitArea()` call, as `MapController.renderArea()` does before generating a
 * preview thumbnail) can race it and capture a stale, wrong window instead
 * of the region it was actually asked to export.
 *
 * Pushes a viewport covering exactly `bounds` (world space, the same shape
 * `computeExportBounds` returns) before the caller builds its scene, and
 * returns a restore function that puts back whatever viewport was active
 * before — so the export never leaves the shared reader (and the interactive
 * backend's next incremental refresh) in a different state than it found it.
 */
export function pushExportViewport(
    mapReader: IMapReader,
    bounds: {x: number; y: number; w: number; h: number},
): () => void {
    if (!isViewportDataSource(mapReader)) return () => {};
    const prev = mapReader.getViewport();
    mapReader.setViewport({minX: bounds.x, maxX: bounds.x + bounds.w, minY: bounds.y, maxY: bounds.y + bounds.h});
    return () => mapReader.setViewport(prev);
}
