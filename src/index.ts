// --- Types, settings, color utils ---
export { createSettings } from './types/Settings';
export type {
    Settings, ViewportBounds, RendererEventMap, PerfSnapshot,
    CullingMode, RoomShape, LabelRenderMode, PlayerMarkerStyle, AmbientLightStyle,
    RoomClickEventDetail, RoomContextMenuEventDetail,
    ZoomChangeEventDetail, AreaExitClickEventDetail, PanEventDetail,
} from './types/Settings';
export { darkenColor, colorLightness, hexToRgba } from './utils/color';

// --- Backward compat (deprecated — use MapRenderer directly) ---
/** @deprecated Use MapRenderer with container argument instead */
export { Renderer } from './Renderer';

// --- Unified MapRenderer ---
export { MapRenderer } from './rendering/MapRenderer';
export type { InteractiveBackend } from './rendering/MapRenderer';
export { MapState } from './MapState';
export type { MapStateEventMap, HighlightEntry, PathEntry } from './MapState';
export { KonvaRenderBackend } from './rendering/KonvaRenderBackend';
export { Viewport } from './Viewport';

// --- Drawing primitives + branded targets ---
export type {
    DrawingBackend,
    InteractiveDrawingBackend, ExportDrawingBackend,
    InteractiveTarget, ExportTarget,
    PreserveBrand,
    Style,
} from './backend/DrawingBackend';
export { BaseDecoratorBackend, BaseStyle, compose, identityStyle } from './backend/DrawingBackend';

// --- Target leaf classes (interactive canvas + SVG export) ---
export { CanvasBackend } from './backend/CanvasBackend';
export { SvgBackend, SvgGroupNode, SvgLayerNode } from './backend/SvgBackend';

// --- Decorator backend classes (low-level; prefer the Style factories below) ---
export { SketchyBackend } from './backend/SketchyBackend';
export { ParchmentBackend } from './backend/ParchmentBackend';
export { BlueprintBackend } from './backend/BlueprintBackend';
export { NeonBackend } from './backend/NeonBackend';
export { IsometricBackend } from './backend/IsometricBackend';
export type { IsometricRotation } from './backend/IsometricBackend';

// --- Styles (target-agnostic visual transformers; preferred API) ---
export {
    Parchment, Blueprint, Neon,
    Sketchy, Isometric,
} from './style';
export type { SketchyOptions, IsometricOptions } from './style';

// --- Exporters (pluggable output formats) ---
export type { Exporter } from './export/Exporter';
export { SvgExporter } from './export/SvgExporter';
export { PngExporter, PngBlobExporter } from './export/PngExporter';
export type { PngExportOptions } from './export/PngExporter';

// --- Overlays ---
export type { SceneOverlay } from './overlay/SceneOverlay';
export type { LiveEffect } from './overlay/LiveEffect';
/** @deprecated Renamed to `LiveEffect`. */
export type { OverlayPlugin, CoordinateTransform } from './types/OverlayPlugin';

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

// --- Export options ---
export type { SvgExportOptions, SvgOverlays } from './SvgTypes';
export { computePathData } from './PathData';
export type { PathResult, PathSegment, PathInnerMarker } from './PathData';

// --- Backward compat (deprecated — use MapRenderer directly) ---
/** @deprecated Use MapRenderer without container argument instead */
export { HeadlessRenderer } from './HeadlessRenderer';
export type { CanvasExportOptions, CanvasExportOverlays } from './HeadlessRenderer';
/** @deprecated Use the MapRenderer class directly */
export type { MapRenderer as MapRendererInterface } from './MapRenderer';
