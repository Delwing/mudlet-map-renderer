import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import type {CoordFn, Style} from "../backend/DrawingBackend";
import {identityStyle, IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import {Camera} from "../Camera";
import {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {Exporter, ExportContext, ExportCanvas} from "../export/Exporter";
import type {DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from "../ScenePipeline";
import {ScenePipeline} from "../ScenePipeline";
import type {KonvaLayerManager} from "./KonvaLayerManager";

/**
 * Slim interface that KonvaLayerManager satisfies. Keeps MapRenderer
 * decoupled from Konva while still being able to forward rendering calls.
 */
export interface RenderingBackend {
    readonly events: TypedEventEmitter<RendererEventMap>;
    readonly coordinateTransform: CoordFn;
    setStyle(style: Style): void;
    refresh(): void;
    onSceneOverlayAdded(id: string, overlay: SceneOverlay): void;
    onSceneOverlayRemoved(id: string): void;
    toCanvas(options: {
        width: number; height: number; roomId?: number; padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): ExportCanvas | undefined;
    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined;
    getDrawnExits(): readonly DrawnExitEntry[];
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[];
    getDrawnStubs(): readonly DrawnStubEntry[];
    destroy(): void;
}

/**
 * Konva-free renderer core. Owns map state, camera, culling, style, and
 * scene overlays. Rendering is handled by an optional injected backend
 * (KonvaLayerManager for interactive canvas, absent for SVG-only use).
 *
 * ```ts
 * // SVG-only — no Konva loaded
 * const renderer = new MapRenderer(mapReader, settings);
 * const svg = renderer.export(new SvgExporter());
 *
 * // Interactive — inject Konva backend separately
 * const renderer = new MapRenderer(mapReader, settings);
 * const konva = new KonvaLayerManager(container, renderer);
 * konva.addLiveEffect('fog', new FogOverlay());
 * ```
 */
export class MapRenderer {
    readonly state: MapState;
    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly pipeline: ScenePipeline;

    private currentStyle: Style = identityStyle;
    private backend?: RenderingBackend;
    private readonly sceneOverlays: Map<string, SceneOverlay> = new Map();
    private destroyed = false;

    get settings(): Settings {
        return this.state.settings;
    }

    /** Forward map → render-space transform from the active backend (identity when no backend). */
    get coordinateTransform(): CoordFn {
        return this.backend?.coordinateTransform ?? IDENTITY_TRANSFORM;
    }

    /** Event emitter — only available when a backend is attached. */
    get events(): TypedEventEmitter<RendererEventMap> | undefined {
        return this.backend?.events;
    }

    constructor(mapReader: MapReader, settings?: Settings) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.camera = new Camera(1, 1);
        this.culling = new CullingManager(this.camera, resolvedSettings);
        this.pipeline = new ScenePipeline(mapReader, resolvedSettings, new CanvasBackend());
    }

    /**
     * Attach a rendering backend (KonvaLayerManager). Called by KonvaLayerManager
     * itself during construction — do not call this manually.
     * @internal
     */
    _attachBackend(backend: RenderingBackend): void {
        this.backend = backend;
        // Forward any already-registered overlays to the backend
        for (const [id, overlay] of this.sceneOverlays) {
            backend.onSceneOverlayAdded(id, overlay);
        }
    }

    /** @internal */
    _detachBackend(): void {
        this.backend = undefined;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.backend?.destroy();
        this.sceneOverlays.clear();
    }

    // --- State mutations ---

    drawArea(id: number, zIndex: number) { this.state.setArea(id, zIndex); }
    getCurrentArea(): Area | undefined { return this.state.currentAreaInstance; }
    setPosition(roomId: number, center = true) { this.state.setPosition(roomId, center); }
    updatePositionMarker(roomId: number) { this.state.updatePositionMarker(roomId); }
    clearPosition() { this.state.clearPosition(); }
    centerOn(roomId: number, instant?: boolean) { this.state.setCenterRoom(roomId, instant); }
    renderHighlight(roomId: number, color: string) { this.state.addHighlight(roomId, color); }
    removeHighlight(roomId: number) { this.state.removeHighlight(roomId); }
    hasHighlight(roomId: number): boolean { return this.state.hasHighlight(roomId); }
    clearHighlights() { this.state.clearHighlights(); }
    renderPath(locations: number[], color?: string) { this.state.addPath(locations, color); }
    clearPaths() { this.state.clearPaths(); }
    refreshCurrentRoomOverlay() { this.state.refreshPosition(); }

    // --- Style ---

    setStyle(style: Style) {
        this.currentStyle = style;
        this.backend?.setStyle(style);
    }

    clearStyle() { this.setStyle(identityStyle); }
    getStyle(): Style { return this.currentStyle; }

    refresh() { this.backend?.refresh(); }

    // --- Scene overlays ---

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) {
            this.backend?.onSceneOverlayRemoved(id);
        }
        this.sceneOverlays.set(id, overlay);
        this.backend?.onSceneOverlayAdded(id, overlay);
    }

    removeSceneOverlay(id: string) {
        if (!this.sceneOverlays.has(id)) return;
        this.sceneOverlays.delete(id);
        this.backend?.onSceneOverlayRemoved(id);
    }

    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    // --- Hit-testing ---

    findRoomAtMap(mapX: number, mapY: number): MapData.Room | null {
        return this.culling.findRoomAtMapPoint(mapX, mapY);
    }

    findRoomAtScreen(screenX: number, screenY: number, containerOffset?: { left: number; top: number }): MapData.Room | null {
        const p = this.camera.clientToMapPoint(screenX, screenY, containerOffset);
        if (!p) return null;
        return this.culling.findRoomAtMapPoint(p.x, p.y);
    }

    // --- Drawn geometry ---

    getDrawnExits(): readonly DrawnExitEntry[] { return this.backend?.getDrawnExits() ?? []; }
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] { return this.backend?.getDrawnSpecialExits() ?? []; }
    getDrawnStubs(): readonly DrawnStubEntry[] { return this.backend?.getDrawnStubs() ?? []; }

    // --- Export ---

    export<T>(exporter: Exporter<T>): T {
        const context: ExportContext = {
            state: this.state,
            renderer: this,
            pipeline: this.pipeline,
            style: this.currentStyle,
            sceneOverlays: this.sceneOverlays.values(),
        };
        return exporter.render(context);
    }

    toCanvas(options: {
        width: number; height: number; roomId?: number; padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): ExportCanvas | undefined {
        return this.backend?.toCanvas(options);
    }

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
        return this.backend?.exportCanvas(options);
    }

    // --- Viewport & events ---

    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend?.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend?.events.off(event, handler);
    }

    setZoom(zoom: number): boolean { return this.camera.setZoom(zoom); }
    zoomToCenter(zoom: number): boolean { return this.camera.zoomToCenter(zoom); }
    getZoom(): number { return this.camera.zoom; }
    getViewportBounds(): ViewportBounds { return this.camera.getViewportBounds(); }

    getAreaBounds(): ViewportBounds | null {
        if (!this.state.currentAreaInstance || this.state.currentZIndex === undefined) return null;
        const plane = this.state.currentAreaInstance.getPlane(this.state.currentZIndex);
        if (!plane) return null;
        const b = this.state.getEffectiveBounds(this.state.currentAreaInstance, plane);
        const hasAreaName = this.state.settings.areaName && this.state.currentAreaInstance.getAreaName();
        const raw: ViewportBounds = {
            minX: hasAreaName ? b.minX - 4 : b.minX, maxX: b.maxX,
            minY: hasAreaName ? b.minY - 7 : b.minY, maxY: b.maxY,
        };
        const fn = this.coordinateTransform;
        const c1 = fn(raw.minX, raw.minY);
        const c2 = fn(raw.maxX, raw.minY);
        const c3 = fn(raw.maxX, raw.maxY);
        const c4 = fn(raw.minX, raw.maxY);
        return {
            minX: Math.min(c1.x, c2.x, c3.x, c4.x), maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
            minY: Math.min(c1.y, c2.y, c3.y, c4.y), maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
        };
    }

    fitArea(insets?: { top?: number; right?: number; bottom?: number; left?: number }) {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.camera.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, insets);
    }

    get centerOnResize(): boolean { return this.camera.centerOnResize; }
    set centerOnResize(value: boolean) { this.camera.centerOnResize = value; }
    get minZoom(): number { return this.camera.minZoom; }
    set minZoom(value: number) { this.camera.minZoom = value; }

    setCullingMode(mode: CullingMode) {
        this.state.settings.cullingMode = mode;
        this.state.settings.cullingEnabled = mode !== "none";
        this.culling.scheduleCulling();
    }

    getCullingMode(): CullingMode { return this.state.settings.cullingMode; }
}
