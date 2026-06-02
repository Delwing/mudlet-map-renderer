// --- Settings, types, colour utils ---
export { createSettings } from './types/Settings';
export type {
    Settings, ViewportBounds, RendererEventMap,
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
export { Camera } from './camera/Camera';
export type { CameraEventMap } from './camera/Camera';
export { HitTester } from './hit/HitTester';
export type { HitResult } from './hit/HitTester';
export { CullingManager } from './CullingManager';

// --- Coordinate helpers (kept for advanced consumers integrating styles) ---
export type { CoordFn } from './coord/CoordFn';
export { IDENTITY_TRANSFORM } from './coord/CoordFn';

// --- Konva-side replay infrastructure (advanced) ---
export {
    DrawCommandLayerNode, MaterializingLayerNode, RecordingLayerNode, RecordingGroupNode,
} from './render/RecordingLayer';
export type { DrawEntry, RecordingDrawCommand } from './render/RecordingLayer';
export { shapeToRecording } from './render/shapeToRecording';

// --- SceneIR types (Shape, DrawCommand, draw helpers) ---
export type {
    Shape, ShapeBase, RectShape, CircleShape, LineShape, PolygonShape,
    TextShape, ImageShape, GroupShape, Paint, HitInfo, LayerId, Bbox, SceneIR,
    FillStyle, LinearGradient, RadialGradient, GradientStop,
} from './scene/Shape';
export { isGradientFill, transformFill } from './scene/Shape';
export type {
    DrawCommand, DrawCommandBatch, RectCommand, CircleCommand, LineCommand,
    PolygonCommand, TextCommand, ImageCommand, PrimitiveDrawCommand, StackDrawCommand,
    PushTransformCommand, PopTransformCommand, PushClipCommand, PopClipCommand,
} from './draw/DrawCommand';
export { buildDrawCommands } from './draw/DrawCommandBuilder';
export type { CameraTransform } from './draw/DrawCommandBuilder';
export { svgFromBatches } from './render/SvgRenderer';
export { renderToCanvas } from './render/CanvasRenderer';
export type { ImageFactory, CanvasRenderOptions } from './render/CanvasRenderer';

// --- Styles (target-agnostic; engine-neutral shape transformers) ---
export {
    Parchment, Blueprint, Neon, Sketchy, Isometric, Construction, SciFi, GradientRooms,
    StainedGlass, GraphPaper, Topographic, Watercolor,
    compose, identityStyle, applyStyleToShapes,
} from './style';
export type {
    Style, StyleContext, SketchyOptions, IsometricOptions, IsometricRotation,
    GradientRoomsOptions, WatercolorOptions,
} from './style';

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
export type { IMapReader } from './reader/MapReader';
export { default as PathFinder } from './PathFinder';
export type { PathFindingAlgorithm } from './PathFinder';
export { MapGraph } from './MapGraph';
export type { Edge, GraphData } from './MapGraph';
export { default as Area } from './reader/Area';
export type { IArea } from './reader/Area';
export { default as Plane } from './reader/Plane';
export type { IPlane } from './reader/Plane';
export type { IExit, Kind as ExitKind } from './reader/Exit';

// --- Visibility lenses (filter what the renderer paints) ---
export type { RoomLens, ExitTreatment } from './lens/RoomLens';
export { ALL_VISIBLE, defaultExitTreatment } from './lens/RoomLens';
export { composeLenses } from './lens/composeLenses';
export type { ComposeOptions, ExitConflictStrategy } from './lens/composeLenses';
export { ExplorationLens } from './lens/ExplorationLens';

// --- Area map ---
export { AreaMapRenderer, createAreaMapSettings } from './AreaMapRenderer';
export type { AreaMapSettings } from './AreaMapRenderer';
export type { AreaDomainInfo, DomainFilter } from './AreaMapRenderer';

// --- Export options types ---
export type { SvgExportOptions, SvgOverlays } from './SvgTypes';
export { computePathData } from './PathData';
export type { PathResult, PathSegment, PathInnerMarker } from './PathData';
