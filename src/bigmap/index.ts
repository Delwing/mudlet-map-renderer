/**
 * Big-map support: render maps far too dense for a full object graph / Konva
 * scene by pairing a compact typed-array {@link MapSkeleton} with the
 * viewport-virtualized {@link SkeletonMapReader} and the renderer's raster
 * LOD overview (`settings.lodEnabled`).
 *
 * Eager path (map parses fine but renders slowly):
 * ```ts
 * import {buildSkeleton, SkeletonMapReader} from "mudlet-map-renderer/bigmap";
 * const reader = new SkeletonMapReader(buildSkeleton(mapData, colors));
 * const renderer = new MapRenderer(reader, {...createSettings(), lodEnabled: true}, container);
 * ```
 *
 * Streamed path (map too large to parse eagerly): produce a `MapSkeleton` in a
 * Web Worker and transfer the typed arrays — see `demo/streaming/` for a
 * reference implementation.
 */
export {default as SkeletonMapReader} from "./SkeletonMapReader";
export {buildSkeleton, hasVisualDetail} from "./buildSkeleton";
export type {BuildSkeletonOptions} from "./buildSkeleton";
export type {MapSkeleton} from "./Skeleton";
export {SKELETON_DIRS} from "./Skeleton";
export {buildPlaneIndex, forEachInBounds, countInBounds} from "./PlaneIndex";
export type {PlaneIndex} from "./PlaneIndex";
