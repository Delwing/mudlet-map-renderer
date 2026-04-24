import Konva from "konva";
import type {Camera} from "../Camera";
import type {Settings, RendererEventMap} from "../types/Settings";
import {KonvaLayerNode} from "../backend/KonvaBackend";
import {RecordingLayerNode} from "../backend/CanvasBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import type {DrawingBackend, GroupNode, LayerNode, CoordFn, Style} from "../backend/DrawingBackend";
import {identityStyle, IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {InteractionHandler} from "../InteractionHandler";
import type {SceneBuildResult, AreaExitHitZone} from "../ScenePipeline";
import type {MapState} from "../MapState";
import type {MapRenderer, RenderingBackend} from "./MapRenderer";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay, SceneOverlayContext} from "../overlay/SceneOverlay";
import type {ExportCanvas} from "../export/Exporter";
import ExplorationArea from "../reader/ExplorationArea";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {computeInnerExits} from "../scene/InnerExitStyle";
import {
    renderHighlight, renderPositionMarker, renderPathOverlay,
    renderSpecialExitGroup, renderStubsGroup, renderInnerExitsGroup,
} from "../scene/OverlayRenderer";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Konva rendering backend for MapRenderer. Creates and manages the Konva
 * Stage and layers, owns the interactive rendering pipeline (scene building,
 * overlays, interaction, live effects).
 *
 * Implements RenderingBackend so MapRenderer can forward style/refresh/overlay
 * calls to it without a Konva dependency.
 *
 * ```ts
 * const renderer = new MapRenderer(mapReader, settings);
 * const konva = new KonvaLayerManager(container, renderer);
 * konva.addLiveEffect('fog', new FogOverlay());
 * ```
 */
export class KonvaLayerManager implements RenderingBackend {
    readonly stage: Konva.Stage;
    readonly gridLayer: Konva.Layer;
    readonly overlayLayer: Konva.Layer;
    readonly positionLayer: Konva.Layer;
    readonly topLabelLayer: Konva.Layer;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private readonly sceneLayer: Konva.Layer;
    readonly sceneNode: RecordingLayerNode;
    readonly gridLayerNode: RecordingLayerNode;
    readonly topLabelLayerNode: RecordingLayerNode;
    readonly overlayLayerNode: KonvaLayerNode;
    readonly positionLayerNode: KonvaLayerNode;

    private drawingBackend: DrawingBackend;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;

    get coordinateTransform(): CoordFn { return this._coordinateTransform; }

    private readonly renderer: MapRenderer;
    private readonly state: MapState;
    private readonly camera: Camera;
    private interactionHandler?: InteractionHandler;
    private origCameraSetSize?: (w: number, h: number) => void;
    private unsubscribeCamera?: () => void;
    private origCameraOnChange?: (() => void) | undefined;
    private destroyed = false;
    private lastBuildResult?: SceneBuildResult;

    private positionMarker?: GroupNode;
    private highlightShapes: Map<number, GroupNode> = new Map();
    private pathShapes: GroupNode[] = [];
    private currentRoomOverlay: GroupNode[] = [];
    private areaExitHitZones: AreaExitHitZone[] = [];
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: Map<string, GroupNode[]> = new Map();
    private cameraSubscribers: Set<() => void> = new Set();

    private readonly container?: HTMLDivElement;

    constructor(container: HTMLDivElement | undefined, renderer: MapRenderer) {
        this.renderer = renderer;
        this.state = renderer.state;
        this.camera = renderer.camera;
        this.container = container;

        const settings = this.state.settings;

        if (container) {
            this.stage = new Konva.Stage({
                container,
                width: container.clientWidth,
                height: container.clientHeight,
                draggable: false,
            });
            container.style.backgroundColor = settings.backgroundColor;
        } else {
            this.stage = new Konva.Stage({ width: 1, height: 1 });
        }

        this.gridLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.gridLayer);

        this.sceneLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.sceneLayer);

        this.positionLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.positionLayer);

        this.overlayLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.overlayLayer);

        this.topLabelLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.topLabelLayer);

        this.sceneNode = new RecordingLayerNode(this.sceneLayer);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.overlayLayerNode = new KonvaLayerNode(this.overlayLayer);
        this.positionLayerNode = new KonvaLayerNode(this.positionLayer);

        this.drawingBackend = new CanvasBackend();
        this.events = new TypedEventEmitter<RendererEventMap>(container);

        renderer.culling.setRedrawCallback((roomDirty, linkDirty) => {
            if (roomDirty || linkDirty) this.sceneNode.batchDraw();
        });

        if (container) {
            // Sync camera to container dimensions immediately
            this.camera.setSize(container.clientWidth, container.clientHeight);

            this.origCameraSetSize = this.camera.setSize.bind(this.camera);
            const origSetSize = this.origCameraSetSize;
            this.camera.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };

            this.interactionHandler = new InteractionHandler(container, this.camera, this.state, settings, {
                clientToMapPoint: (cx, cy) => this.camera.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => renderer.culling.findRoomAtMapPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
                renderedToMapPoint: (x, y) => this.coordinateInverse(x, y),
            }, this.events);
        }

        this.applyDrawingBackendTransforms(this.drawingBackend);

        this.unsubscribeCamera = this.camera.addChangeListener(() => this.applyViewportToStage());

        this.subscribeToState();
        renderer._attachBackend(this);
    }

    // --- RenderingBackend implementation ---

    setStyle(style: Style) {
        this.applyDrawingBackend(style(new CanvasBackend()));
    }

    updateBackground() {
        if (this.container) {
            this.container.style.backgroundColor = this.state.settings.backgroundColor;
        }
    }

    refresh() {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.clearScene();
            return;
        }
        const result = this.buildScene(currentAreaInstance, plane, currentZIndex, this.camera.getViewportBounds());
        this.onSceneBuilt(result);
        this.syncHighlights();
        this.syncPaths();
        if (positionRoomId !== undefined) this.onPositionChanged(positionRoomId, false, false);
        for (const [id, overlay] of this.sceneOverlays) this.renderSceneOverlay(id, overlay);
    }

    private clearScene() {
        this.renderer.culling.clear();
        this.areaExitHitZones = [];
        this.lastBuildResult = undefined;
        this.gridLayer.destroyChildren();
        this.sceneNode.destroyChildren();
        this.stage.batchDraw();
    }

    onSceneOverlayAdded(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) { existing.detach?.(); this.clearSceneOverlayNodes(id); }
        this.sceneOverlays.set(id, overlay);
        overlay.attach?.(this.createOverlayContext(id, overlay));
        this.renderSceneOverlay(id, overlay);
    }

    onSceneOverlayRemoved(id: string) {
        const overlay = this.sceneOverlays.get(id);
        if (!overlay) return;
        overlay.detach?.();
        this.sceneOverlays.delete(id);
        this.clearSceneOverlayNodes(id);
        this.overlayLayer.batchDraw();
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
        // Suppress camera notifications during export framing
        this.unsubscribeCamera?.();
        this.unsubscribeCamera = undefined;

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
        const exportPosition = {
            x: (width - bounds.w * scale) / 2 - bounds.x * scale,
            y: (height - bounds.h * scale) / 2 - bounds.y * scale,
        };

        this.camera.width = width;
        this.camera.height = height;
        this.camera.zoom = scale / (this.camera.getScale() / this.camera.zoom);
        this.camera.position = exportPosition;

        this.stage.width(width);
        this.stage.height(height);
        this.stage.scale({x: scale, y: scale});
        this.stage.position(exportPosition);

        this.renderer.pipeline.gridRenderer.render(this.gridLayerNode, this.camera.getViewportBounds());
        this.renderer.culling.updateCulling();

        const stageCanvas = this.stage.toCanvas({width, height}) as HTMLCanvasElement;
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
        this.unsubscribeCamera = this.camera.addChangeListener(() => this.applyViewportToStage());
        this.stage.width(savedWidth);
        this.stage.height(savedHeight);
        this.applyViewportToStage();
        this.renderer.culling.updateCulling();

        return composite;
    }

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;
        const stageCanvas = this.stage.toCanvas({pixelRatio: options?.pixelRatio ?? 1});
        const composite = Konva.Util.createCanvasElement();
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite;
    }

    getDrawnExits() { return this.lastBuildResult?.drawnExits ?? []; }
    getDrawnSpecialExits() { return this.lastBuildResult?.drawnSpecialExits ?? []; }
    getDrawnStubs() { return this.lastBuildResult?.drawnStubs ?? []; }

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

        if (this.origCameraSetSize) this.camera.setSize = this.origCameraSetSize;
        this.unsubscribeCamera?.();

        this.clearOverlayShapes();
        this.clearCurrentRoomOverlay();
        if (this.positionMarker) { this.positionMarker.destroy(); this.positionMarker = undefined; }

        this.stage.destroy();
        this.events.removeAllListeners();
        this.renderer._detachBackend();
    }

    // --- Live effects ---

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        const requestRedraw = () => this.overlayLayer.batchDraw();
        effect.attach(this.overlayLayer, requestRedraw);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this._coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) { existing.destroy(); this.liveEffects.delete(id); }
    }

    // --- Internal: viewport → stage ---

    private applyViewportToStage() {
        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});
        this.stage.position(this.camera.position);
        this.stage.batchDraw();
        const gridStart = performance.now();
        this.renderer.pipeline.gridRenderer.render(this.gridLayerNode, this.camera.getViewportBounds());
        this.renderer.culling.recordGridMs(performance.now() - gridStart);
        this.renderer.culling.scheduleCulling();
        const vpBounds = this.camera.getViewportBounds();
        for (const cb of this.cameraSubscribers) cb();
        for (const effect of this.liveEffects.values()) {
            effect.updateViewport(vpBounds, scale, this._coordinateTransform);
        }
    }

    private applyDrawingBackend(backend: DrawingBackend) {
        const forward = backend.getTransform();
        const newInverse = backend.getInverseTransform();
        const oldInverse = this.coordinateInverse;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.renderer.culling.setCoordinateTransform(forward);
        this.renderer.pipeline.gridRenderer.setInverseTransform(newInverse);
        this.renderer.pipeline.gridRenderer.setInverseTransform(newInverse);

        const scale = this.camera.getScale();
        const screenCX = this.camera.width / 2;
        const screenCY = this.camera.height / 2;
        const oldRX = (screenCX - this.camera.position.x) / scale;
        const oldRY = (screenCY - this.camera.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);
        this.camera.position = {x: screenCX - nr.x * scale, y: screenCY - nr.y * scale};

        this.drawingBackend = backend;
        this.renderer.pipeline.setBackend(backend);
        this.applyViewportToStage();
    }

    private applyDrawingBackendTransforms(backend: DrawingBackend) {
        this._coordinateTransform = backend.getTransform();
        this.coordinateInverse = backend.getInverseTransform();
        this.renderer.culling.setCoordinateTransform(this._coordinateTransform);
        this.renderer.pipeline.gridRenderer.setInverseTransform(this.coordinateInverse);
        this.renderer.pipeline.gridRenderer.setInverseTransform(this.coordinateInverse);
    }

    private mapPoint(x: number, y: number) { return this._coordinateTransform(x, y); }

    // --- Internal: scene lifecycle ---

    private buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: import("../types/Settings").ViewportBounds): SceneBuildResult {
        this.positionLayer.destroyChildren();
        this.positionMarker = undefined;
        this.clearOverlayShapes();
        this.currentRoomOverlay = [];

        const result = this.renderer.pipeline.buildScene(area, plane, zIndex, {
            gridLayer: this.gridLayerNode,
            linkLayer: this.sceneNode,
            roomLayer: this.sceneNode,
            topLabelLayer: this.topLabelLayerNode,
        }, viewportBounds);

        this.lastBuildResult = result;
        return result;
    }

    private onSceneBuilt(result: SceneBuildResult) {
        this.renderer.culling.clear();
        this.areaExitHitZones = [];
        this.renderer.culling.computeBucketSize();

        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});

        for (const [, entry] of result.roomNodes) {
            this.renderer.culling.roomNodes.set(entry.room.id, entry);
            this.renderer.culling.addRoomToSpatialIndex(entry);
        }
        for (const entry of result.standaloneExitNodes) {
            this.renderer.culling.standaloneExitNodes.push(entry);
            this.renderer.culling.addStandaloneExitToSpatialIndex(entry);
        }
        this.renderer.culling.setExitBoundsRoomSize();
        this.areaExitHitZones = result.areaExitHitZones;

        this.renderer.culling.updateCulling();
        this.stage.batchDraw();
    }

    private subscribeToState() {
        const state = this.state;
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
            this.positionLayerNode.batchDraw();
            this.clearCurrentRoomOverlay();
            this.overlayLayerNode.batchDraw();
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
        this.positionLayerNode.addNode(this.positionMarker);
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.positionLayerNode.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            this.positionLayerNode.batchDraw();
            return;
        }

        const settings = this.state.settings;
        if (!settings.highlightCurrentRoom) {
            if (this.positionMarker) this.positionMarker.moveToTop();
            this.positionLayerNode.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);
        const preRoomNodes: GroupNode[] = [];
        const exitRenderer = this.renderer.pipeline.exitRenderer;

        const explorationArea =
            this.state.currentAreaInstance instanceof ExplorationArea ? this.state.currentAreaInstance : undefined;

        if (this.state.currentAreaInstance && this.state.currentZIndex !== undefined) {
            const exits = this.state.currentAreaInstance
                .getLinkExits(this.state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const data = exitRenderer.renderDataWithColor(exit, currentRoomColor, this.state.currentZIndex!);
                if (data) preRoomNodes.push(this.renderer.pipeline.renderExitData(data));
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
            this.positionLayerNode.addNode(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayNode = this.renderer.pipeline.roomShapeRenderer.createRoomGroup(roomToRedraw, {
                strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
            });
            this.positionLayerNode.addNode(overlayNode);
            this.currentRoomOverlay.push(overlayNode);
        });

        roomsToRedraw.forEach(roomToRedraw => {
            const {triangles} = computeInnerExits(roomToRedraw, this.state.mapReader, settings);
            if (triangles.length > 0) {
                const group = renderInnerExitsGroup(this.drawingBackend, triangles);
                this.positionLayerNode.addNode(group);
                this.currentRoomOverlay.push(group);
            }
        });

        if (this.positionMarker) this.positionMarker.moveToTop();
        this.positionLayerNode.batchDraw();
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
                this.overlayLayerNode.addNode(shape);
                this.highlightShapes.set(roomId, shape);
            }
        }
        this.overlayLayerNode.batchDraw();
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
            this.overlayLayerNode.addNode(shape);
            this.highlightShapes.set(roomId, shape);
        }
        this.overlayLayerNode.batchDraw();
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
            this.overlayLayerNode.addNode(group);
            this.pathShapes.push(group);
        }
        this.overlayLayerNode.batchDraw();
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
                this.overlayLayerNode.addNode(node);
                stored.push(node);
            }
            this.sceneOverlayNodes.set(id, stored);
        }
        this.overlayLayer.batchDraw();
    }

    private clearSceneOverlayNodes(id: string) {
        const nodes = this.sceneOverlayNodes.get(id);
        if (!nodes) return;
        for (const node of nodes) node.destroy();
        this.sceneOverlayNodes.delete(id);
    }
}

