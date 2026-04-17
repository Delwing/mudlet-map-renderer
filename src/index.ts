// --- Settings, types, colour utils ---
export { createSettings } from './types/Settings';
export type {
    Settings, ViewportBounds, RendererEventMap, PerfSnapshot,
    CullingMode, RoomShape, LabelRenderMode, PlayerMarkerStyle, AmbientLightStyle,
    RoomClickEventDetail, RoomContextMenuEventDetail,
    ZoomChangeEventDetail, AreaExitClickEventDetail, PanEventDetail,
} from './types/Settings';
export { darkenColor, colorLightness, hexToRgba } from './utils/color';

// --- Core renderer ---
export { MapRenderer } from './rendering/MapRenderer';
export type { InteractiveBackend } from './rendering/MapRenderer';
export { MapState } from './MapState';
export type { MapStateEventMap, HighlightEntry, PathEntry } from './MapState';
export { KonvaRenderBackend } from './rendering/KonvaRenderBackend';
export { Viewport } from './Viewport';

// --- Drawing primitives ---
export type {
    DrawingBackend, GroupNode, LayerNode, CoordFn,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
    Style,
} from './backend/DrawingBackend';
export { BaseStyle, compose, identityStyle, IDENTITY_TRANSFORM } from './backend/DrawingBackend';

// --- Target classes (exposed for custom styles / exporters) ---
export { CanvasBackend } from './backend/CanvasBackend';
export { SvgBackend, SvgGroupNode, SvgLayerNode } from './backend/SvgBackend';

// --- Decorator classes (low-level; the Style factories below are preferred) ---
export { SketchyBackend } from './backend/SketchyBackend';
export { ParchmentBackend } from './backend/ParchmentBackend';
export { BlueprintBackend } from './backend/BlueprintBackend';
export { NeonBackend } from './backend/NeonBackend';
export { IsometricBackend } from './backend/IsometricBackend';
export type { IsometricRotation } from './backend/IsometricBackend';

// --- Styles (target-agnostic; preferred API) ---
export {
    Parchment, Blueprint, Neon, Sketchy, Isometric,
} from './style';
export type { SketchyOptions, IsometricOptions } from './style';

// --- Exporters (pluggable output formats) ---
export type { Exporter, ExportContext, ExportCanvas } from './export/Exporter';
export { SvgExporter } from './export/SvgExporter';
export { PngExporter, PngBlobExporter } from './export/PngExporter';
export type { PngExportOptions } from './export/PngExporter';
export { CanvasExporter } from './export/CanvasExporter';
export type { CanvasExportOptions } from './export/CanvasExporter';

// --- Overlays ---
export type { SceneOverlay } from './overlay/SceneOverlay';
export type { LiveEffect, CoordinateTransform } from './overlay/LiveEffect';

// --- Map data & pathfinding ---
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

// --- Export options types ---
export type { SvgExportOptions, SvgOverlays } from './SvgTypes';
export { computePathData } from './PathData';
export type { PathResult, PathSegment, PathInnerMarker } from './PathData';
