// --- Settings, types, colour utils ---
export { createSettings } from './types/Settings';
export type {
    Settings, ViewportBounds, RendererEventMap, PerfSnapshot,
    CullingMode, RoomShape, LabelRenderMode, PlayerMarkerStyle,
    RoomClickEventDetail, RoomContextMenuEventDetail,
    ZoomChangeEventDetail, AreaExitClickEventDetail, PanEventDetail,
} from './types/Settings';
export { darkenColor, colorLightness, hexToRgba } from './utils/color';

// --- Core renderer ---
export { MapRenderer } from './rendering/MapRenderer';
export type { InteractiveBackend } from './rendering/MapRenderer';
export type { DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry } from './ScenePipeline';
export type { ExitDrawData, ExitDrawLine, ExitDrawArrow, ExitDrawDoor } from './ExitRenderer';
export { MapState } from './MapState';
export type { MapStateEventMap, HighlightEntry, PathEntry } from './MapState';
export { KonvaRenderBackend } from './rendering/KonvaRenderBackend';
export { Camera } from './camera/Camera';
export type { CameraEventMap } from './camera/Camera';

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

// --- Style classes (low-level; the Style factories below are preferred) ---
export {
    SketchyStyle, ParchmentStyle, BlueprintStyle, NeonStyle, IsometricStyle,
} from './style';
export type { IsometricRotation } from './style';

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
export { CanvasExporter, PngBytesExporter } from './export/CanvasExporter';
export type { CanvasExportOptions, PngBytesExportOptions } from './export/CanvasExporter';
export { canvasToBytes } from './export/canvasToBytes';

// --- Overlays ---
export type { SceneOverlay, SceneOverlayContext } from './overlay/SceneOverlay';
export type { LiveEffect, CoordinateTransform } from './overlay/LiveEffect';
export { AmbientLightOverlay } from './overlay/AmbientLightOverlay';
export type { AmbientLightOptions } from './overlay/AmbientLightOverlay';

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
