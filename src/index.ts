// --- Re-exports from old Renderer (types, settings, color utils) ---
export * from './Renderer';
export { createSettings } from "./Renderer";
export type { Settings, RendererEventMap } from "./Renderer";

// --- New unified MapRenderer ---
export { MapRenderer } from './rendering/MapRenderer';
export type { InteractiveBackend } from './rendering/MapRenderer';
export { MapState } from './MapState';
export type { MapStateEventMap, HighlightEntry, PathEntry } from './MapState';
export { KonvaRenderBackend } from './rendering/KonvaRenderBackend';
export { Viewport } from './Viewport';

// --- Core ---
export { default as MapReader } from './reader/MapReader';
export { default as PathFinder } from './PathFinder';
export type { PathFindingAlgorithm } from './PathFinder';
export { MapGraph } from './MapGraph';
export type { Edge, GraphData } from './MapGraph';
export { default as ExplorationArea } from './reader/ExplorationArea';

// --- Area map ---
export { AreaMapRenderer, createAreaMapSettings } from './AreaMapRenderer';
export type { AreaMapSettings } from './AreaMapRenderer';
export type { AreaDomainInfo, DomainFilter } from './AreaMapRenderer';

// --- Export ---
export { SvgExporter } from './SvgExporter';
export type { SvgExportOptions, SvgOverlays } from './SvgExporter';
export { computePathData } from './PathData';
export type { PathResult, PathSegment, PathInnerMarker } from './PathData';

// --- Backward compat aliases ---
export { HeadlessRenderer } from './HeadlessRenderer';
export type { CanvasExportOptions, CanvasExportOverlays } from './HeadlessRenderer';
// Old MapRenderer interface — keep for backward compat type consumers
export type { MapRenderer as MapRendererInterface } from './MapRenderer';
