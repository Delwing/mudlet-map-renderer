import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import type {SvgExportOptions} from "../SvgTypes";
import {KonvaRenderBackend} from "./KonvaRenderBackend";
import type {
    DrawingBackend, InteractiveDrawingBackend, CoordFn, Style,
} from "../backend/DrawingBackend";
import {identityStyle} from "../backend/DrawingBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import type {CanvasExportOptions, CanvasExportOverlays} from "../HeadlessRenderer";
import type {Viewport} from "../Viewport";
import type {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";
import type {OverlayPlugin} from "../types/OverlayPlugin";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {Exporter} from "../export/Exporter";
import {SvgExporter} from "../export/SvgExporter";
import {PngExporter, PngBlobExporter} from "../export/PngExporter";

/** Contract for interactive render backends. */
export interface InteractiveBackend {
    readonly viewport: Viewport;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;
    /** Forward map → render-space transform from the current drawing backend. */
    readonly coordinateTransform: CoordFn;
    setDrawingBackend(backend: InteractiveDrawingBackend): void;
    updateBackground(): void;
    refresh(): void;
    /** Render a specific region to canvas (for headless / bounded export). */
    toCanvas(options: { width: number; height: number; roomId?: number; padding?: number }): any;
    /** Capture the current viewport as a canvas with background fill. */
    exportCanvas(options?: { pixelRatio?: number }): HTMLCanvasElement | undefined;
    addLiveEffect(id: string, effect: LiveEffect): void;
    removeLiveEffect(id: string): void;
    addSceneOverlay(id: string, overlay: SceneOverlay): void;
    removeSceneOverlay(id: string): void;
    getSceneOverlays(): Iterable<SceneOverlay>;
    /** @deprecated Use {@link addLiveEffect}. */
    addOverlayPlugin(id: string, plugin: OverlayPlugin): void;
    /** @deprecated Use {@link removeLiveEffect}. */
    removeOverlayPlugin(id: string): void;
    destroy(): void;
}

/**
 * Unified map renderer facade.
 *
 * All public methods mutate MapState. State events drive the rendering backend.
 */
export class MapRenderer {
    readonly state: MapState;
    readonly backend: InteractiveBackend;
    private currentStyle: Style = identityStyle;

    get settings(): Settings {
        return this.state.settings;
    }

    /**
     * @param mapReader       Map data source.
     * @param settings        Renderer settings. Defaults to `createSettings()`.
     * @param container       DOM element for interactive rendering. Omit for headless.
     * @param backendFactory  Optional factory that receives the `MapState` and returns
     *   a custom `InteractiveBackend`. When omitted, a `KonvaRenderBackend` is created.
     * @param drawingBackend  Optional DrawingBackend for interactive scene rendering.
     *   Must be an `InteractiveDrawingBackend` — i.e. {@link CanvasBackend} or a decorator
     *   chain over one (e.g. `new SketchyBackend(new CanvasBackend(), 0.015, '#444')`).
     *   Defaults to a fresh `CanvasBackend()`.
     * @param svgDrawingBackendFactory  @deprecated Set a {@link Style} via
     *   {@link setStyle} instead — one style drives every output path.
     */
    constructor(
        mapReader: MapReader,
        settings?: Settings,
        container?: HTMLDivElement,
        backendFactory?: (state: MapState) => InteractiveBackend,
        drawingBackend?: InteractiveDrawingBackend,
        svgDrawingBackendFactory?: (innerSvgBackend: DrawingBackend) => DrawingBackend,
    ) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.backend = backendFactory
            ? backendFactory(this.state)
            : new KonvaRenderBackend(this.state, container, drawingBackend);
        if (svgDrawingBackendFactory) {
            this.currentStyle = svgDrawingBackendFactory as unknown as Style;
        }
    }

    destroy() {
        this.backend.destroy();
    }

    // --- State mutations (emit events → backend reacts) ---

    drawArea(id: number, zIndex: number) {
        this.state.setArea(id, zIndex);
    }

    getCurrentArea(): Area | undefined {
        return this.state.currentAreaInstance;
    }

    setPosition(roomId: number, center: boolean = true) {
        this.state.setPosition(roomId, center);
    }

    updatePositionMarker(roomId: number) {
        this.state.updatePositionMarker(roomId);
    }

    clearPosition() {
        this.state.clearPosition();
    }

    centerOn(roomId: number, instant?: boolean) {
        this.state.setCenterRoom(roomId, instant);
    }

    renderHighlight(roomId: number, color: string) {
        this.state.addHighlight(roomId, color);
    }

    removeHighlight(roomId: number) {
        this.state.removeHighlight(roomId);
    }

    hasHighlight(roomId: number): boolean {
        return this.state.hasHighlight(roomId);
    }

    clearHighlights() {
        this.state.clearHighlights();
    }

    renderPath(locations: number[], color?: string) {
        this.state.addPath(locations, color);
    }

    clearPaths() {
        this.state.clearPaths();
    }

    refreshCurrentRoomOverlay() {
        this.state.refreshPosition();
    }

    /**
     * Apply a {@link Style} to all rendering paths — interactive canvas, SVG export,
     * PNG export. One style, every output. Pass `identityStyle` (or call {@link clearStyle})
     * to remove the current style.
     *
     * ```ts
     * import {compose, Parchment, Sketchy} from 'mudlet-map-renderer';
     * renderer.setStyle(compose(Parchment, Sketchy({jitter: 0.012, color: '#4a3728'})));
     * ```
     */
    setStyle(style: Style) {
        this.currentStyle = style;
        const styledInteractive = style(new CanvasBackend());
        this.backend.setDrawingBackend(styledInteractive);
    }

    /** Remove the current style. Equivalent to `setStyle(identityStyle)`. */
    clearStyle() {
        this.setStyle(identityStyle);
    }

    /** Returns the style currently applied (defaults to {@link identityStyle}). */
    getStyle(): Style {
        return this.currentStyle;
    }

    /** @deprecated Use {@link setStyle}. */
    setDrawingBackend(backend: InteractiveDrawingBackend) {
        this.backend.setDrawingBackend(backend);
        this.currentStyle = identityStyle;
    }

    /** @deprecated Use {@link setStyle}. */
    setDrawingBackendFactory(factory: ((inner: DrawingBackend) => DrawingBackend) | null) {
        this.currentStyle = (factory ?? identityStyle) as unknown as Style;
    }

    updateBackground() {
        this.backend.updateBackground();
    }

    refresh() {
        this.backend.updateBackground();
        this.backend.refresh();
    }

    /**
     * Add a {@link SceneOverlay} — target-agnostic, appears in every output
     * (interactive canvas, SVG, PNG, and any custom exporter).
     */
    addSceneOverlay(id: string, overlay: SceneOverlay) {
        this.backend.addSceneOverlay(id, overlay);
    }

    removeSceneOverlay(id: string) {
        this.backend.removeSceneOverlay(id);
    }

    /**
     * Add a {@link LiveEffect} — interactive-only animated effect. Skipped by
     * exporters. For export-compatible overlays use {@link addSceneOverlay}.
     */
    addLiveEffect(id: string, effect: LiveEffect) {
        this.backend.addLiveEffect(id, effect);
    }

    removeLiveEffect(id: string) {
        this.backend.removeLiveEffect(id);
    }

    /** @deprecated Use {@link addLiveEffect} (identical behaviour) or {@link addSceneOverlay}. */
    addOverlayPlugin(id: string, plugin: OverlayPlugin) {
        this.backend.addLiveEffect(id, plugin);
    }

    /** @deprecated Use {@link removeLiveEffect}. */
    removeOverlayPlugin(id: string) {
        this.backend.removeLiveEffect(id);
    }

    // --- Export ---

    /**
     * Run an {@link Exporter} against the current scene and return its output.
     *
     * New output formats (PDF, tile atlases, JSON scene graph, …) are added by
     * shipping a new `Exporter<T>` — no changes to `MapRenderer` required.
     *
     * ```ts
     * const svg  = renderer.export(new SvgExporter({padding: 5}));
     * const url  = renderer.export(new PngExporter(renderer.backend, {pixelRatio: 2}));
     * const blob = await renderer.export(new PngBlobExporter(renderer.backend));
     * ```
     */
    export<T>(exporter: Exporter<T>): T {
        return exporter.render(this.state, this.currentStyle, this.backend.getSceneOverlays());
    }

    /** @deprecated Use `renderer.export(new SvgExporter(options))`. */
    exportSvg(options?: SvgExportOptions): string | undefined {
        return this.export(new SvgExporter(options));
    }

    /** @deprecated Use `renderer.export(new PngExporter(renderer.backend, options))`. */
    exportPng(options?: { pixelRatio?: number }): string | undefined {
        return this.export(new PngExporter(this.backend, options));
    }

    /** @deprecated Use `renderer.export(new PngBlobExporter(renderer.backend, options))`. */
    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined {
        return this.export(new PngBlobExporter(this.backend, options));
    }

    renderToCanvas(options: CanvasExportOptions & { overlays?: CanvasExportOverlays }): any {
        return this.backend.toCanvas(options);
    }

    // --- Viewport & interaction ---

    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend.events.off(event, handler);
    }

    setZoom(zoom: number): boolean {
        return this.backend.viewport.setZoom(zoom);
    }

    zoomToCenter(zoom: number): boolean {
        return this.backend.viewport.zoomToCenter(zoom);
    }

    getZoom(): number {
        return this.backend.viewport.zoom;
    }

    getViewportBounds(): ViewportBounds {
        return this.backend.viewport.getViewportBounds();
    }

    getAreaBounds(): ViewportBounds | null {
        if (!this.state.currentAreaInstance || this.state.currentZIndex === undefined) return null;
        const plane = this.state.currentAreaInstance.getPlane(this.state.currentZIndex);
        if (!plane) return null;
        const b = this.state.getEffectiveBounds(this.state.currentAreaInstance, plane);
        const hasAreaName = this.state.settings.areaName && this.state.currentAreaInstance.getAreaName();
        const raw: ViewportBounds = {
            minX: hasAreaName ? b.minX - 4 : b.minX,
            maxX: b.maxX,
            minY: hasAreaName ? b.minY - 7 : b.minY,
            maxY: b.maxY,
        };
        // Transform the 4 corners and compute the AABB in rendered space
        const fn = this.backend.coordinateTransform;
        const c1 = fn(raw.minX, raw.minY);
        const c2 = fn(raw.maxX, raw.minY);
        const c3 = fn(raw.maxX, raw.maxY);
        const c4 = fn(raw.minX, raw.maxY);
        return {
            minX: Math.min(c1.x, c2.x, c3.x, c4.x),
            maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
            minY: Math.min(c1.y, c2.y, c3.y, c4.y),
            maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
        };
    }

    fitArea(insets?: { top?: number; right?: number; bottom?: number; left?: number }) {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.backend.viewport.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, insets);
    }

    get centerOnResize(): boolean {
        return this.backend.viewport.centerOnResize;
    }

    set centerOnResize(value: boolean) {
        this.backend.viewport.centerOnResize = value;
    }

    get minZoom(): number {
        return this.backend.viewport.minZoom;
    }

    set minZoom(value: number) {
        this.backend.viewport.minZoom = value;
    }

    setCullingMode(mode: CullingMode) {
        this.state.settings.cullingMode = mode;
        this.state.settings.cullingEnabled = mode !== "none";
        this.backend.culling.scheduleCulling();
    }

    getCullingMode(): CullingMode {
        return this.state.settings.cullingMode;
    }
}
