// --- Types, settings, color utils ---
export { createSettings } from './types/Settings';
export type {
    Settings, ViewportBounds, RendererEventMap, PerfSnapshot,
    CullingMode, RoomShape, LabelRenderMode, PlayerMarkerStyle, AmbientLightStyle,
    RoomClickEventDetail, RoomContextMenuEventDetail,
    ZoomChangeEventDetail, AreaExitClickEventDetail, PanEventDetail,
} from './types/Settings';
export { darkenColor, colorLightness, hexToRgba } from './utils/color';
export type { OverlayPlugin, CoordinateTransform } from './types/OverlayPlugin';

// --- Backward compat (deprecated — use MapRenderer directly) ---
/** @deprecated Use MapRenderer with container argument instead */
export { Renderer } from './Renderer';

// --- New unified MapRenderer ---
export { MapRenderer } from './rendering/MapRenderer';
export type { InteractiveBackend } from './rendering/MapRenderer';
export { MapState } from './MapState';
export type { MapStateEventMap, HighlightEntry, PathEntry } from './MapState';
export { KonvaRenderBackend } from './rendering/KonvaRenderBackend';
export { Viewport } from './Viewport';
export type { DrawingBackend } from './backend/DrawingBackend';
export { KonvaBackend } from './backend/KonvaBackend';
export { SketchyBackend } from './backend/SketchyBackend';
export { ParchmentBackend } from './backend/ParchmentBackend';
export { BlueprintBackend } from './backend/BlueprintBackend';
export { NeonBackend } from './backend/NeonBackend';
export { IsometricBackend } from './backend/IsometricBackend';
export type { IsometricRotation } from './backend/IsometricBackend';

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
export type { SvgExportOptions, SvgOverlays } from './SvgTypes';
export { computePathData } from './PathData';
export type { PathResult, PathSegment, PathInnerMarker } from './PathData';

// --- Backward compat (deprecated — use MapRenderer directly) ---
/** @deprecated Use MapRenderer without container argument instead */
export { HeadlessRenderer } from './HeadlessRenderer';
export type { CanvasExportOptions, CanvasExportOverlays } from './HeadlessRenderer';
/** @deprecated Use the MapRenderer class directly */
export type { MapRenderer as MapRendererInterface } from './MapRenderer';
