import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import type {DrawingBackend, GroupNode, CoordFn, Style} from "../backend/DrawingBackend";
import {identityStyle, IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import {Camera} from "../Camera";
import {CullingManager} from "../CullingManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {ScenePipeline} from "../ScenePipeline";
import type {SceneBuildResult, AreaExitHitZone, DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from "../ScenePipeline";
import Konva from "konva";
import {KonvaLayerManager} from "./KonvaLayerManager";
import type {ExportCanvas} from "../export/Exporter";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay, SceneOverlayContext} from "../overlay/SceneOverlay";
import type {Exporter, ExportContext} from "../export/Exporter";
import ExplorationArea from "../reader/ExplorationArea";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {computeInnerExits} from "../scene/InnerExitStyle";
import {
    renderHighlight, renderPositionMarker, renderPathOverlay,
    renderSpecialExitGroup, renderStubsGroup, renderInnerExitsGroup,
} from "../scene/OverlayRenderer";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Unified map renderer. Owns all rendering state directly:
 * camera, culling, pipeline, drawing backend, overlays, and interaction.
 *
 * KonvaLayerManager manages the physical Konva Stage and layers.
 * SVG and headless exports reuse the same ScenePipeline with a swapped backend.
 */
export class MapRenderer {
    readonly state: MapState;
    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private drawingBackend: DrawingBackend;
    private pipeline: ScenePipeline;
    private readonly layerManager: KonvaLayerManager;
    private interactionHandler?: InteractionHandler;
    private currentStyle: Style = identityStyle;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;
    private lastBuildResult?: SceneBuildResult;
    private destroyed = false;

    private positionMarker?: GroupNode;
    private highlightShapes: Map<number, GroupNode> = new Map();
    private pathShapes: GroupNode[] = [];
    private currentRoomOverlay: GroupNode[] = [];
    private areaExitHitZones: AreaExitHitZone[] = [];
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: Map<string, GroupNode[]> = new Map();
    private cameraSubscribers: Set<() => void> = new Set();

    get coordinateTransform(): CoordFn {
        return this._coordinateTransform;
    }

    get settings(): Settings {
        return this.state.settings;
    }

    constructor(
        mapReader: MapReader,
        settings?: Settings,
        container?: HTMLDivElement,
    ) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.camera = new Camera(
            container?.clientWidth ?? 1,
            container?.clientHeight ?? 1,
        );

        this.drawingBackend = new CanvasBackend();
        this.events = new TypedEventEmitter<RendererEventMap>(container);
        this.layerManager = new KonvaLayerManager(container, resolvedSettings, this.camera);

        this.pipeline = new ScenePipeline(mapReader, resolvedSettings, this.drawingBackend, {
            gridLayer: this.layerManager.gridLayerNode,
            linkLayer: this.layerManager.sceneNode,
            roomLayer: this.layerManager.sceneNode,
            topLabelLayer: this.layerManager.topLabelLayerNode,
        });

        this.culling = new CullingManager(
            this.layerManager.getStageInfo(),
            this.layerManager.sceneNode,
            this.layerManager.sceneNode,
            resolvedSettings,
        );

        this.camera.onChange = () => this.applyViewportToStage();

        if (container) {
            this.interactionHandler = new InteractionHandler(container, this.camera, this.state, resolvedSettings, {
                clientToMapPoint: (cx, cy) => this.camera.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => this.culling.findRoomAtMapPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
                renderedToMapPoint: (x, y) => this.coordinateInverse(x, y),
            }, this.events);
        }

        this.applyDrawingBackendTransforms(this.drawingBackend);
        this.subscribeToState(this.state);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        this.state.events.removeAllListeners();
        this.interactionHandler?.destroy();

        for (const effect of this.liveEffects.values()) effect.destroy();
        this.liveEffects.clear();

        for (const overlay of this.sceneOverlays.values()) overlay.detach?.();
        this.sceneOverlays.clear();
        for (const nodes of this.sceneOverlayNodes.values()) {
            for (const node of nodes) node.destroy();
        }
        this.sceneOverlayNodes.clear();
        this.cameraSubscribers.clear();

        this.layerManager.restoreCameraSetSize(this.camera);
        this.camera.onChange = undefined;

        this.clearOverlayShapes();
        this.clearCurrentRoomOverlay();
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }

        this.layerManager.destroy();
        this.events.removeAllListeners();
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
        this.applyDrawingBackend(style(new CanvasBackend()));
    }

    clearStyle() { this.setStyle(identityStyle); }
    getStyle(): Style { return this.currentStyle; }

    private applyDrawingBackend(backend: DrawingBackend) {
        this.drawingBackend = backend;
        this.pipeline = new ScenePipeline(this.state.mapReader, this.state.settings, backend, {
            gridLayer: this.layerManager.gridLayerNode,
            linkLayer: this.layerManager.sceneNode,
            roomLayer: this.layerManager.sceneNode,
            topLabelLayer: this.layerManager.topLabelLayerNode,
        });
        this.applyDrawingBackendTransforms(backend);
    }

    updateBackground() {}

    refresh() {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.culling.clear();
            this.areaExitHitZones = [];
            this.lastBuildResult = undefined;
            this.layerManager.gridLayer.destroyChildren();
            this.layerManager.sceneNode.destroyChildren();
            this.layerManager.stage.batchDraw();
            return;
        }
        const result = this.buildScene(currentAreaInstance, plane, currentZIndex, this.camera.getViewportBounds());
        this.onSceneBuilt(result);
        this.syncHighlights();
        this.syncPaths();
        if (positionRoomId !== undefined) this.onPositionChanged(positionRoomId, false, false);
        for (const [id, overlay] of this.sceneOverlays) this.renderSceneOverlay(id, overlay);
    }

    // --- Overlays ---

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) { existing.detach?.(); this.clearSceneOverlayNodes(id); }
        this.sceneOverlays.set(id, overlay);
        overlay.attach?.(this.createOverlayContext(id, overlay));
        this.renderSceneOverlay(id, overlay);
    }

    removeSceneOverlay(id: string) {
        const overlay = this.sceneOverlays.get(id);
        if (!overlay) return;
        overlay.detach?.();
        this.sceneOverlays.delete(id);
        this.clearSceneOverlayNodes(id);
        this.layerManager.overlayLayer.batchDraw();
    }

    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        const requestRedraw = () => this.layerManager.overlayLayer.batchDraw();
        effect.attach(this.drawingBackend, requestRedraw);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this._coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) { existing.destroy(); this.liveEffects.delete(id); }
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

    getDrawnExits(): readonly DrawnExitEntry[] { return this.lastBuildResult?.drawnExits ?? []; }
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] { return this.lastBuildResult?.drawnSpecialExits ?? []; }
    getDrawnStubs(): readonly DrawnStubEntry[] { return this.lastBuildResult?.drawnStubs ?? []; }

    // --- Export ---

    export<T>(exporter: Exporter<T>): T {
        const context: ExportContext = {
            state: this.state,
            renderer: this,
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
        const {currentArea, currentZIndex, currentAreaInstance} = this.state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) return;

        const {width, height, padding = 3} = options;
        const savedWidth = this.camera.width;
        const savedHeight = this.camera.height;
        const savedZoom = this.camera.zoom;
        const savedMinZoom = this.camera.minZoom;
        const savedPos = {...this.camera.position};
        const savedOnChange = this.camera.onChange;
        this.camera.onChange = undefined;

        const rawBounds = this.state.computeExportBounds(currentAreaInstance, plane, options.roomId, padding);
        const fn = this._coordinateTransform;
        const c1 = fn(rawBounds.x, rawBounds.y);
        const c2 = fn(rawBounds.x + rawBounds.w, rawBounds.y);
        const c3 = fn(rawBounds.x + rawBounds.w, rawBounds.y + rawBounds.h);
        const c4 = fn(rawBounds.x, rawBounds.y + rawBounds.h);
        const tMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const tMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const tMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const tMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);
        const bounds = {x: tMinX, y: tMinY, w: tMaxX - tMinX, h: tMaxY - tMinY};
        const scale = Math.min(width / bounds.w, height / bounds.h);
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        const exportPosition = {
            x: (width - mapPixelW) / 2 - bounds.x * scale,
            y: (height - mapPixelH) / 2 - bounds.y * scale,
        };

        this.camera.width = width;
        this.camera.height = height;
        this.camera.zoom = scale / (this.camera.getScale() / this.camera.zoom);
        this.camera.position = exportPosition;

        const stage = this.layerManager.stage;
        stage.width(width);
        stage.height(height);
        stage.scale({x: scale, y: scale});
        stage.position(exportPosition);

        this.pipeline.gridRenderer.render(this.camera.getViewportBounds());
        this.culling.updateCulling();

        const stageCanvas = stage.toCanvas({width, height}) as HTMLCanvasElement;
        const composite = Konva.Util.createCanvasElement();
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);

        this.camera.width = savedWidth;
        this.camera.height = savedHeight;
        this.camera.zoom = savedZoom;
        this.camera.minZoom = savedMinZoom;
        this.camera.position = savedPos;
        this.camera.onChange = savedOnChange;
        stage.width(savedWidth);
        stage.height(savedHeight);
        this.applyViewportToStage();
        this.culling.updateCulling();

        return composite;
    }

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;
        const stageCanvas = this.layerManager.stage.toCanvas({pixelRatio: options?.pixelRatio ?? 1});
        const composite = Konva.Util.createCanvasElement();
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite;
    }

    // --- Viewport & interaction ---

    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.events.off(event, handler);
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
        const fn = this._coordinateTransform;
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

    // --- Internal: viewport → stage ---

    private applyViewportToStage() {
        this.layerManager.applyCamera(this.camera);
        const gridStart = performance.now();
        this.pipeline.gridRenderer.render(this.camera.getViewportBounds());
        this.culling.recordGridMs(performance.now() - gridStart);
        this.culling.scheduleCulling();
        const vpBounds = this.camera.getViewportBounds();
        const scale = this.camera.getScale();
        for (const cb of this.cameraSubscribers) cb();
        for (const effect of this.liveEffects.values()) {
            effect.updateViewport(vpBounds, scale, this._coordinateTransform);
        }
    }

    private applyDrawingBackendTransforms(backend: DrawingBackend) {
        const forward = backend.getTransform();
        const newInverse = backend.getInverseTransform();
        const oldInverse = this.coordinateInverse;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.culling.setCoordinateTransform(forward);
        this.pipeline.gridRenderer.setInverseTransform(newInverse);

        const scale = this.camera.getScale();
        const screenCX = this.camera.width / 2;
        const screenCY = this.camera.height / 2;
        const oldRX = (screenCX - this.camera.position.x) / scale;
        const oldRY = (screenCY - this.camera.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);
        this.camera.position = {x: screenCX - nr.x * scale, y: screenCY - nr.y * scale};
        this.applyViewportToStage();
    }

    private mapPoint(x: number, y: number) { return this._coordinateTransform(x, y); }

    // --- Internal: scene lifecycle ---

    private buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: ViewportBounds): SceneBuildResult {
        this.layerManager.positionLayer.destroyChildren();
        this.positionMarker = undefined;
        this.clearOverlayShapes();
        this.currentRoomOverlay = [];
        const result = this.pipeline.buildScene(area, plane, zIndex, viewportBounds);
        this.lastBuildResult = result;
        return result;
    }

    private onSceneBuilt(result: SceneBuildResult) {
        this.culling.clear();
        this.areaExitHitZones = [];
        this.culling.computeBucketSize();
        const scale = this.camera.getScale();
        this.layerManager.stage.scale({x: scale, y: scale});
        for (const [, entry] of result.roomNodes) {
            this.culling.roomNodes.set(entry.room.id, entry);
            this.culling.addRoomToSpatialIndex(entry);
        }
        for (const entry of result.standaloneExitNodes) {
            this.culling.standaloneExitNodes.push(entry);
            this.culling.addStandaloneExitToSpatialIndex(entry);
        }
        this.culling.setExitBoundsRoomSize();
        this.areaExitHitZones = result.areaExitHitZones;
        this.culling.updateCulling();
        this.layerManager.stage.batchDraw();
    }

    private subscribeToState(state: MapState) {
        state.events.on('area', () => this.refresh());

        state.events.on('position', ({roomId, center, areaChanged}) => {
            this.onPositionChanged(roomId, center, areaChanged);
        });

        state.events.on('center', ({roomId, instant}) => {
            const room = state.mapReader.getRoom(roomId);
            if (room) {
                const p = this.mapPoint(room.x, room.y);
                if (instant || this.state.settings.instantMapMove) {
                    this.camera.panToMapPoint(p.x, p.y);
                } else {
                    this.interactionHandler?.animatePanTo(p.x, p.y);
                }
            }
        });

        state.events.on('highlight', ({roomId, color}) => this.syncHighlight(roomId, color));
        state.events.on('path', () => this.syncPaths());
        state.events.on('clear', () => this.syncHighlights());
    }

    // --- Internal: position & current-room overlay ---

    private onPositionChanged(roomId: number | undefined, center: boolean, instant: boolean) {
        if (roomId === undefined) {
            if (this.positionMarker) { this.positionMarker.destroy(); this.positionMarker = undefined; }
            this.layerManager.positionLayerNode.batchDraw();
            this.clearCurrentRoomOverlay();
            this.layerManager.overlayLayerNode.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        if (center) {
            const p = this.mapPoint(room.x, room.y);
            if (instant || this.state.settings.instantMapMove) {
                this.camera.panToMapPoint(p.x, p.y);
            } else {
                this.interactionHandler?.animatePanTo(p.x, p.y);
            }
        }

        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        if (this.positionMarker) this.positionMarker.destroy();
        const data = computePositionMarker(room, this.state.settings);
        this.positionMarker = renderPositionMarker(this.drawingBackend, data);
        this.layerManager.positionLayerNode.addNode(this.positionMarker);
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.layerManager.positionLayerNode.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            this.layerManager.positionLayerNode.batchDraw();
            return;
        }

        const settings = this.state.settings;
        if (!settings.highlightCurrentRoom) {
            if (this.positionMarker) this.positionMarker.moveToTop();
            this.layerManager.positionLayerNode.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);
        const preRoomNodes: GroupNode[] = [];
        const exitRenderer = this.pipeline.exitRenderer;

        const explorationArea =
            this.state.currentAreaInstance instanceof ExplorationArea ? this.state.currentAreaInstance : undefined;

        if (this.state.currentAreaInstance && this.state.currentZIndex !== undefined) {
            const exits = this.state.currentAreaInstance
                .getLinkExits(this.state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const data = exitRenderer.renderDataWithColor(exit, currentRoomColor, this.state.currentZIndex!);
                if (data) preRoomNodes.push(this.pipeline.renderExitData(data));
            });
        }

        for (const se of computeSpecialExits(room, settings, currentRoomColor)) {
            preRoomNodes.push(renderSpecialExitGroup(this.drawingBackend, se));
        }
        const stubs = computeStubs(room, settings, currentRoomColor);
        if (stubs.length > 0) preRoomNodes.push(renderStubsGroup(this.drawingBackend, stubs));

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.state.mapReader.getRoom(id);
            const canRender = !explorationArea || explorationArea.hasVisitedRoom(id);
            if (otherRoom && otherRoom.area === this.state.currentArea && otherRoom.z === this.state.currentZIndex && canRender) {
                roomsToRedraw.set(id, otherRoom);
            }
        });

        preRoomNodes.forEach(node => {
            this.layerManager.positionLayerNode.addNode(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayNode = this.pipeline.roomShapeRenderer.createRoomGroup(roomToRedraw, {
                strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
            });
            this.layerManager.positionLayerNode.addNode(overlayNode);
            this.currentRoomOverlay.push(overlayNode);
        });

        roomsToRedraw.forEach(roomToRedraw => {
            const {triangles} = computeInnerExits(roomToRedraw, this.state.mapReader, settings);
            if (triangles.length > 0) {
                const group = renderInnerExitsGroup(this.drawingBackend, triangles);
                this.layerManager.positionLayerNode.addNode(group);
                this.currentRoomOverlay.push(group);
            }
        });

        if (this.positionMarker) this.positionMarker.moveToTop();
        this.layerManager.positionLayerNode.batchDraw();
    }

    // --- Internal: highlight & path sync ---

    syncHighlight(roomId: number, color: string | undefined) {
        const existing = this.highlightShapes.get(roomId);
        if (existing) { existing.destroy(); this.highlightShapes.delete(roomId); }
        if (color !== undefined) {
            const room = this.state.mapReader.getRoom(roomId);
            if (room && room.area === this.state.currentArea && room.z === this.state.currentZIndex) {
                const data = computeHighlight(room, color, this.state.settings);
                const shape = renderHighlight(this.drawingBackend, data);
                this.layerManager.overlayLayerNode.addNode(shape);
                this.highlightShapes.set(roomId, shape);
            }
        }
        this.layerManager.overlayLayerNode.batchDraw();
    }

    syncHighlights() {
        for (const shape of this.highlightShapes.values()) shape.destroy();
        this.highlightShapes.clear();
        for (const [roomId, entry] of this.state.highlights) {
            if (entry.area !== this.state.currentArea || entry.z !== this.state.currentZIndex) continue;
            const room = this.state.mapReader.getRoom(roomId);
            if (!room) continue;
            const data = computeHighlight(room, entry.color, this.state.settings);
            const shape = renderHighlight(this.drawingBackend, data);
            this.layerManager.overlayLayerNode.addNode(shape);
            this.highlightShapes.set(roomId, shape);
        }
        this.layerManager.overlayLayerNode.batchDraw();
    }

    syncPaths() {
        this.clearPathShapes();
        const {currentArea, currentZIndex} = this.state;
        if (currentArea === undefined || currentZIndex === undefined) return;
        for (const path of this.state.paths) {
            const data = computePathOverlay(
                this.state.mapReader, this.state.settings,
                path.locations, path.color, currentArea, currentZIndex,
            );
            const group = renderPathOverlay(this.drawingBackend, data);
            this.layerManager.overlayLayerNode.addNode(group);
            this.pathShapes.push(group);
        }
        this.layerManager.overlayLayerNode.batchDraw();
    }

    private clearOverlayShapes() {
        for (const shape of this.highlightShapes.values()) shape.destroy();
        this.highlightShapes.clear();
        this.clearPathShapes();
    }

    private clearPathShapes() {
        for (const shape of this.pathShapes) shape.destroy();
        this.pathShapes = [];
    }

    // --- Internal: scene overlays ---

    private createOverlayContext(id: string, overlay: SceneOverlay): SceneOverlayContext {
        return {
            state: this.state,
            onViewportChange: (cb) => {
                this.cameraSubscribers.add(cb);
                return () => this.cameraSubscribers.delete(cb);
            },
            invalidate: () => {
                if (this.sceneOverlays.get(id) !== overlay) return;
                this.renderSceneOverlay(id, overlay);
            },
        };
    }

    private renderSceneOverlay(id: string, overlay: SceneOverlay) {
        this.clearSceneOverlayNodes(id);
        const bounds = this.camera.getViewportBounds();
        const out = overlay.render(this.drawingBackend, this.state, bounds);
        if (out) {
            const nodes = Array.isArray(out) ? out : [out];
            const stored: GroupNode[] = [];
            for (const node of nodes) {
                this.layerManager.overlayLayerNode.addNode(node);
                stored.push(node);
            }
            this.sceneOverlayNodes.set(id, stored);
        }
        this.layerManager.overlayLayer.batchDraw();
    }

    private clearSceneOverlayNodes(id: string) {
        const nodes = this.sceneOverlayNodes.get(id);
        if (!nodes) return;
        for (const node of nodes) node.destroy();
        this.sceneOverlayNodes.delete(id);
    }
}
