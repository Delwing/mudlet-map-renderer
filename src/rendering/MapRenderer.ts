import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import {KonvaRenderBackend} from "./KonvaRenderBackend";
import type {DrawingBackend, CoordFn, Style} from "../backend/DrawingBackend";
import {identityStyle} from "../backend/DrawingBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import type {Viewport} from "../Viewport";
import type {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {Exporter} from "../export/Exporter";

/** Contract for interactive render backends. */
export interface InteractiveBackend {
    readonly viewport: Viewport;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;
    /** Forward map → render-space transform from the current drawing backend. */
    readonly coordinateTransform: CoordFn;
    setDrawingBackend(backend: DrawingBackend): void;
    updateBackground(): void;
    refresh(): void;
    /** Render a specific region to canvas (for headless / bounded export). */
    toCanvas(options: {
        width: number;
        height: number;
        roomId?: number;
        padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): any;
    /** Capture the current viewport as a canvas with background fill. */
    exportCanvas(options?: { pixelRatio?: number }): HTMLCanvasElement | undefined;
    addLiveEffect(id: string, effect: LiveEffect): void;
    removeLiveEffect(id: string): void;
    addSceneOverlay(id: string, overlay: SceneOverlay): void;
    removeSceneOverlay(id: string): void;
    getSceneOverlays(): Iterable<SceneOverlay>;
    destroy(): void;
}

/**
 * Unified map renderer facade.
 *
 * Public surface is intentionally narrow:
 * - **State mutations** (`drawArea`, `setPosition`, `renderHighlight`, …) emit
 *   events through `MapState` that the interactive backend reacts to.
 * - **{@link setStyle}** applies a target-agnostic visual transformation to the
 *   interactive canvas and every exporter.
 * - **{@link export}** runs an {@link Exporter} plug-in and returns its output
 *   (SVG string, PNG data URL, canvas, PDF bytes, …). New formats are added by
 *   shipping new `Exporter<T>` implementations — no new methods on this class.
 * - **{@link addSceneOverlay}** / **{@link addLiveEffect}** distinguish scene
 *   content (appears everywhere) from animated effects (interactive only).
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
     */
    constructor(
        mapReader: MapReader,
        settings?: Settings,
        container?: HTMLDivElement,
        backendFactory?: (state: MapState) => InteractiveBackend,
    ) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.backend = backendFactory
            ? backendFactory(this.state)
            : new KonvaRenderBackend(this.state, container);
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

    // --- Style ---

    /**
     * Apply a {@link Style} to the interactive canvas and every export path.
     *
     * ```ts
     * import {compose, Parchment, Sketchy} from 'mudlet-map-renderer';
     * renderer.setStyle(compose(Parchment, Sketchy({jitter: 0.012, color: '#4a3728'})));
     * ```
     *
     * Pass `identityStyle` (or call {@link clearStyle}) to remove the current style.
     */
    setStyle(style: Style) {
        this.currentStyle = style;
        this.backend.setDrawingBackend(style(new CanvasBackend()));
    }

    /** Equivalent to `setStyle(identityStyle)`. */
    clearStyle() {
        this.setStyle(identityStyle);
    }

    /** Returns the style currently applied (defaults to identity). */
    getStyle(): Style {
        return this.currentStyle;
    }

    updateBackground() {
        this.backend.updateBackground();
    }

    refresh() {
        this.backend.updateBackground();
        this.backend.refresh();
    }

    // --- Overlays ---

    /** Target-agnostic overlay; appears in every output including exporters. */
    addSceneOverlay(id: string, overlay: SceneOverlay) {
        this.backend.addSceneOverlay(id, overlay);
    }

    removeSceneOverlay(id: string) {
        this.backend.removeSceneOverlay(id);
    }

    /** Interactive-only animated effect; skipped by exporters. */
    addLiveEffect(id: string, effect: LiveEffect) {
        this.backend.addLiveEffect(id, effect);
    }

    removeLiveEffect(id: string) {
        this.backend.removeLiveEffect(id);
    }

    // --- Export ---

    /**
     * Run an {@link Exporter} against the current scene and return its output.
     *
     * ```ts
     * const svg  = renderer.export(new SvgExporter({padding: 5}));
     * const url  = renderer.export(new PngExporter(renderer.backend, {pixelRatio: 2}));
     * const blob = await renderer.export(new PngBlobExporter(renderer.backend));
     * const canvas = renderer.export(new CanvasExporter(renderer.backend, {width, height}));
     * ```
     */
    export<T>(exporter: Exporter<T>): T {
        return exporter.render(this.state, this.currentStyle, this.backend.getSceneOverlays());
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
