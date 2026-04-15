import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import type {SvgExportOptions} from "../SvgTypes";
import {KonvaRenderBackend} from "./KonvaRenderBackend";
import {SvgRenderBackend} from "./SvgRenderBackend";
import type {CanvasExportOptions, CanvasExportOverlays} from "../HeadlessRenderer";
import type {Viewport} from "../Viewport";
import type {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";

/** Contract for interactive render backends. */
export interface InteractiveBackend {
    readonly viewport: Viewport;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;
    updateBackground(): void;
    refresh(): void;
    /** Render a specific region to canvas (for headless / bounded export). */
    toCanvas(options: { width: number; height: number; roomId?: number; padding?: number }): any;
    /** Capture the current viewport as a canvas with background fill. */
    exportCanvas(options?: { pixelRatio?: number }): HTMLCanvasElement | undefined;
    destroy?(): void;
}

/**
 * Unified map renderer facade.
 *
 * All public methods mutate MapState. State events drive the rendering backend.
 */
export class MapRenderer {
    readonly state: MapState;
    readonly backend: InteractiveBackend;

    get settings(): Settings {
        return this.state.settings;
    }

    /**
     * @param mapReader       Map data source.
     * @param settings        Renderer settings. Defaults to `createSettings()`.
     * @param container       DOM element for interactive rendering. Omit for headless.
     * @param backendFactory  Optional factory that receives the `MapState` and returns
     *   a custom `InteractiveBackend`. When omitted, a `KonvaRenderBackend` is created.
     *
     *   ```ts
     *   new MapRenderer(mapReader, settings, container,
     *       (state) => new PaperRenderBackend(state, container));
     *   ```
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

    updateBackground() {
        this.backend.updateBackground();
    }

    refresh() {
        this.backend.updateBackground();
        this.backend.refresh();
    }

    // --- Export ---

    exportSvg(options?: SvgExportOptions): string | undefined {
        const mergedOptions: SvgExportOptions = {
            ...options,
            overlays: this.state.getOverlaysForArea(options?.overlays),
        };
        const svgBackend = new SvgRenderBackend(this.state);
        return svgBackend.exportSvg(mergedOptions);
    }

    exportPng(options?: { pixelRatio?: number }): string | undefined {
        const canvas = this.backend.exportCanvas(options);
        return canvas?.toDataURL('image/png');
    }

    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined {
        const canvas = this.backend.exportCanvas(options);
        if (!canvas) return;
        return new Promise<Blob>((resolve) => {
            canvas.toBlob((blob: Blob | null) => { if (blob) resolve(blob); }, 'image/png');
        });
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
        return {
            minX: hasAreaName ? b.minX - 4 : b.minX,
            maxX: b.maxX,
            minY: hasAreaName ? b.minY - 7 : b.minY,
            maxY: b.maxY,
        };
    }

    fitArea() {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.backend.viewport.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
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
