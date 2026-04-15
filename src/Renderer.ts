import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type {MapRenderer as MapRendererInterface} from "./MapRenderer";
import type {SvgExportOptions} from "./SvgTypes";
import {MapRenderer} from "./rendering/MapRenderer";

// Re-export types and createSettings from canonical location for backward compat
export {createSettings} from "./types/Settings";
export {darkenColor, colorLightness} from "./utils/color";
export type {
    Settings, ViewportBounds, RendererEventMap, PerfSnapshot,
    CullingMode, RoomShape, LabelRenderMode, PlayerMarkerStyle,
    RoomClickEventDetail, RoomContextMenuEventDetail,
    ZoomChangeEventDetail, AreaExitClickEventDetail, PanEventDetail,
} from "./types/Settings";

/**
 * Backward-compatible interactive renderer.
 * Delegates to the unified MapRenderer with the old constructor signature.
 *
 * @deprecated Use MapRenderer directly:
 *   new MapRenderer(mapReader, settings, container)
 */
export class Renderer implements MapRendererInterface {
    private readonly renderer: MapRenderer;

    get settings() {
        return this.renderer.settings;
    }

    constructor(container: HTMLDivElement, mapReader: MapReader, settings?: import("./types/Settings").Settings) {
        this.renderer = new MapRenderer(mapReader, settings, container);
    }

    drawArea(id: number, zIndex: number) { this.renderer.drawArea(id, zIndex); }
    getCurrentArea(): Area | undefined { return this.renderer.getCurrentArea(); }
    setPosition(roomId: number, center: boolean = true) { this.renderer.setPosition(roomId, center); }
    updatePositionMarker(roomId: number) { this.renderer.updatePositionMarker(roomId); }
    clearPosition() { this.renderer.clearPosition(); }
    centerOn(roomId: number, instant?: boolean) { this.renderer.centerOn(roomId, instant); }
    renderHighlight(roomId: number, color: string) { this.renderer.renderHighlight(roomId, color); }
    removeHighlight(roomId: number) { this.renderer.removeHighlight(roomId); }
    hasHighlight(roomId: number) { return this.renderer.hasHighlight(roomId); }
    clearHighlights() { this.renderer.clearHighlights(); }
    renderPath(locations: number[], color?: string) { this.renderer.renderPath(locations, color); }
    clearPaths() { this.renderer.clearPaths(); }
    exportSvg(options?: SvgExportOptions): string | undefined { return this.renderer.exportSvg(options); }
    exportPng(options?: { pixelRatio?: number }): string | undefined { return this.renderer.exportPng(options); }
    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined { return this.renderer.exportPngBlob(options); }
    setZoom(zoom: number): boolean { return this.renderer.setZoom(zoom); }
    zoomToCenter(zoom: number): boolean { return this.renderer.zoomToCenter(zoom); }
    getZoom() { return this.renderer.getZoom(); }
    getViewportBounds() { return this.renderer.getViewportBounds(); }
    getAreaBounds() { return this.renderer.getAreaBounds(); }
    fitArea() { this.renderer.fitArea(); }
    get centerOnResize(): boolean { return this.renderer.centerOnResize; }
    set centerOnResize(value: boolean) { this.renderer.centerOnResize = value; }
    get minZoom(): number { return this.renderer.minZoom; }
    set minZoom(value: number) { this.renderer.minZoom = value; }
    on<K extends keyof import("./types/Settings").RendererEventMap>(event: K, handler: (detail: import("./types/Settings").RendererEventMap[K]) => void): void { this.renderer.on(event, handler); }
    off<K extends keyof import("./types/Settings").RendererEventMap>(event: K, handler: (detail: import("./types/Settings").RendererEventMap[K]) => void): void { this.renderer.off(event, handler); }
    setCullingMode(mode: import("./types/Settings").CullingMode) { this.renderer.setCullingMode(mode); }
    getCullingMode() { return this.renderer.getCullingMode(); }
    refreshCurrentRoomOverlay() { this.renderer.refreshCurrentRoomOverlay(); }
    updateBackground() { this.renderer.updateBackground(); }
    refresh() { this.renderer.refresh(); }
}
