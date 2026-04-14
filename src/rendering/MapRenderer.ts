import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../Renderer";
import {createSettings} from "../Renderer";
import type {Settings} from "../Renderer";
import {MapState} from "../MapState";
import type {SvgExportOptions} from "../SvgExporter";
import {SvgExporter} from "../SvgExporter";
import {KonvaRenderBackend} from "./KonvaRenderBackend";
import type {CanvasExportOptions, CanvasExportOverlays} from "../HeadlessRenderer";

/**
 * Unified map renderer facade.
 *
 * - `new MapRenderer(mapReader)` — headless (no DOM, same rendering pipeline)
 * - `new MapRenderer(mapReader, settings, container)` — interactive (DOM + mouse/touch)
 *
 * Both modes share the same stage, viewport, culling, and scene graph.
 * The only difference: interactive mode adds mouse/touch event listeners.
 *
 * All public methods mutate MapState. State events drive the rendering backend.
 */
export class MapRenderer {
    readonly state: MapState;
    readonly backend: KonvaRenderBackend;

    get settings(): Settings {
        return this.state.settings;
    }

    constructor(mapReader: MapReader, settings?: Settings, container?: HTMLDivElement) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.backend = new KonvaRenderBackend(this.state, container);
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
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;

        const mergedOptions: SvgExportOptions = {
            ...options,
            overlays: this.state.getOverlaysForArea(options?.overlays),
        };

        const exporter = new SvgExporter(this.state.mapReader, this.state.settings);
        return exporter.export(this.state.currentArea, this.state.currentZIndex, mergedOptions);
    }

    exportPng(options?: { pixelRatio?: number }): string | undefined {
        const canvas = this.compositeStageCanvas(options?.pixelRatio);
        return canvas?.toDataURL('image/png');
    }

    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined {
        const canvas = this.compositeStageCanvas(options?.pixelRatio);
        if (!canvas) return;
        return new Promise<Blob>((resolve) => {
            canvas.toBlob((blob: Blob | null) => { if (blob) resolve(blob); }, 'image/png');
        });
    }

    private compositeStageCanvas(pixelRatio?: number): HTMLCanvasElement | undefined {
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;
        const stageCanvas = this.backend.stage.toCanvas({pixelRatio: pixelRatio ?? 1});
        const composite = document.createElement('canvas');
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite;
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
        return this.backend.viewport.getZoom();
    }

    getViewportBounds(): ViewportBounds {
        return this.backend.viewport.getViewportBounds();
    }

    getAreaBounds(): ViewportBounds | null {
        if (!this.state.currentAreaInstance || this.state.currentZIndex === undefined) return null;
        const plane = this.state.currentAreaInstance.getPlane(this.state.currentZIndex);
        if (!plane) return null;
        const b = this.backend.getEffectiveBounds(this.state.currentAreaInstance, plane);
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
