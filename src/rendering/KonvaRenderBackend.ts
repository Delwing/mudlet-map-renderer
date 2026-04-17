import Konva from "konva";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";
import type {RendererEventMap} from "../types/Settings";
import {ScenePipeline} from "../ScenePipeline";
import type {SceneBuildResult, AreaExitHitZone} from "../ScenePipeline";
import type {MapState} from "../MapState";
import {Viewport} from "../Viewport";
import {CullingManager} from "../CullingManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {KonvaLayerNode} from "../backend/KonvaBackend";
import {CanvasBackend, RecordingLayerNode} from "../backend/CanvasBackend";
import type {InteractiveBackend} from "./MapRenderer";
import type {DrawingBackend, GroupNode, LayerNode, CoordFn} from "../backend/DrawingBackend";
import {IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeAmbientLight} from "../scene/AmbientLightStyle";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {computeInnerExits} from "../scene/InnerExitStyle";
import {
    renderHighlight, renderPositionMarker, renderPathOverlay,
    renderSpecialExitGroup, renderStubsGroup, renderInnerExitsGroup,
    renderAmbientLight,
} from "../scene/OverlayRenderer";
import ExplorationArea from "../reader/ExplorationArea";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay} from "../overlay/SceneOverlay";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Konva rendering engine. Owns the full rendering pipeline:
 * stage, layers, scene builder, culling, overlays.
 *
 * Viewport is the source of truth for transform state.
 * This backend subscribes to viewport.onChange and applies state to the Konva stage.
 *
 * Works identically in both modes:
 * - DOM container → stage attached to DOM, mouse/touch → viewport
 * - No container → headless stage, same viewport/culling, no input
 */
export class KonvaRenderBackend implements InteractiveBackend {
    readonly stage: Konva.Stage;
    readonly gridLayer: Konva.Layer;
    readonly linkLayer: Konva.Layer;
    readonly roomLayer: Konva.Layer;
    readonly overlayLayer: Konva.Layer;
    readonly positionLayer: Konva.Layer;

    readonly viewport: Viewport;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private readonly state: MapState;
    private readonly container?: HTMLDivElement;
    private drawingBackend: DrawingBackend;
    private readonly positionLayerNode: LayerNode;
    private readonly overlayLayerNode: LayerNode;
    private pipeline: ScenePipeline;
    private lastBuildResult?: SceneBuildResult;

    private positionMarker?: GroupNode;
    private ambientLightNode?: GroupNode;
    private highlightShapes: Map<number, GroupNode> = new Map();
    private pathShapes: GroupNode[] = [];
    private currentRoomOverlay: GroupNode[] = [];
    private areaExitHitZones: AreaExitHitZone[] = [];
    private interactionHandler?: InteractionHandler;
    private origSetSize?: (w: number, h: number) => void;
    private destroyed = false;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;

    get coordinateTransform(): CoordFn {
        return this._coordinateTransform;
    }
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: GroupNode[] = [];

    constructor(state: MapState, container?: HTMLDivElement, drawingBackend?: DrawingBackend) {
        this.state = state;
        this.container = container;

        if (container) {
            this.stage = new Konva.Stage({
                container,
                width: container.clientWidth,
                height: container.clientHeight,
                draggable: false,
            });
            container.style.backgroundColor = state.settings.backgroundColor;
            this.viewport = new Viewport(container.clientWidth, container.clientHeight);
        } else {
            this.stage = new Konva.Stage({width: 1, height: 1});
            this.viewport = new Viewport(1, 1);
        }

        this.gridLayer = new Konva.Layer({listening: false});
        this.stage.add(this.gridLayer);
        this.linkLayer = new Konva.Layer({listening: false});
        this.stage.add(this.linkLayer);
        this.roomLayer = new Konva.Layer({listening: false});
        this.stage.add(this.roomLayer);
        this.positionLayer = new Konva.Layer({listening: false});
        this.stage.add(this.positionLayer);
        this.overlayLayer = new Konva.Layer({listening: false});
        this.stage.add(this.overlayLayer);

        this.drawingBackend = drawingBackend ?? new CanvasBackend();
        this.positionLayerNode = new KonvaLayerNode(this.positionLayer);
        this.overlayLayerNode = new KonvaLayerNode(this.overlayLayer);

        const sceneRoomLayer = new RecordingLayerNode(this.roomLayer);
        const sceneLinkLayer = new RecordingLayerNode(this.linkLayer);
        this.pipeline = new ScenePipeline(state.mapReader, state.settings, this.drawingBackend, {
            gridLayer: new RecordingLayerNode(this.gridLayer),
            linkLayer: sceneLinkLayer,
            roomLayer: sceneRoomLayer,
        });

        this.events = new TypedEventEmitter<RendererEventMap>(container);

        this.culling = new CullingManager(
            this.stage,
            sceneRoomLayer,
            sceneLinkLayer,
            state.settings,
        );

        // Viewport drives the stage
        this.viewport.onChange = () => this.applyViewportToStage();

        if (container) {
            // Sync stage size when viewport resizes
            this.origSetSize = this.viewport.setSize.bind(this.viewport);
            const origSetSize = this.origSetSize;
            this.viewport.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };

            this.interactionHandler = new InteractionHandler(container, this.viewport, state, state.settings, {
                clientToMapPoint: (cx, cy) => this.viewport.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => this.culling.findRoomAtMapPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
            }, this.events);
        }

        this.applyDrawingBackendTransforms(this.drawingBackend);
        this.subscribeToState(state);
    }

    setDrawingBackend(backend: DrawingBackend) {
        this.drawingBackend = backend;
        this.pipeline = new ScenePipeline(this.state.mapReader, this.state.settings, backend, {
            gridLayer: new RecordingLayerNode(this.gridLayer),
            linkLayer: new RecordingLayerNode(this.linkLayer),
            roomLayer: new RecordingLayerNode(this.roomLayer),
        });
        this.applyDrawingBackendTransforms(backend);
    }

    /**
     * Pull forward/inverse transforms from the drawing backend and propagate them
     * to culling, grid rendering, and the viewport. Repositions the viewport so the
     * same map point stays under the screen center across transform changes.
     */
    private applyDrawingBackendTransforms(backend: DrawingBackend) {
        const forward = backend.getTransform();
        const newInverse = backend.getInverseTransform();
        const oldInverse = this.coordinateInverse;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.culling.setCoordinateTransform(forward);
        this.pipeline.gridRenderer.setInverseTransform(newInverse);

        // Reposition viewport so the same map point stays at screen center
        const scale = this.viewport.getScale();
        const screenCX = this.viewport.width / 2;
        const screenCY = this.viewport.height / 2;

        // Screen center → old rendered space → map space → new rendered space
        const oldRX = (screenCX - this.viewport.position.x) / scale;
        const oldRY = (screenCY - this.viewport.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);

        this.viewport.position = {
            x: screenCX - nr.x * scale,
            y: screenCY - nr.y * scale,
        };
        this.applyViewportToStage();
    }

    private mapPoint(x: number, y: number): { x: number; y: number } {
        return this._coordinateTransform(x, y);
    }

    get exitRenderer() {
        return this.pipeline.exitRenderer;
    }

    get roomShapeRenderer() {
        return this.pipeline.roomShapeRenderer;
    }

    get gridRenderer() {
        return this.pipeline.gridRenderer;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        // Remove all MapState event subscriptions
        this.state.events.removeAllListeners();

        // Destroy interaction handler (removes DOM listeners)
        this.interactionHandler?.destroy();

        // Stop overlay plugins
        for (const plugin of this.liveEffects.values()) plugin.destroy();
        this.liveEffects.clear();

        // Cancel any running viewport animation
        this.viewport.cancelAnimation();

        // Restore monkey-patched setSize
        if (this.origSetSize) {
            this.viewport.setSize = this.origSetSize;
        }

        // Disconnect viewport from stage
        this.viewport.onChange = undefined;

        // Destroy all Konva nodes and the stage
        this.clearOverlayShapes();
        this.clearCurrentRoomOverlay();
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }
        if (this.ambientLightNode) {
            this.ambientLightNode.destroy();
            this.ambientLightNode = undefined;
        }
        this.stage.destroy();

        // Clear renderer events
        this.events.removeAllListeners();
    }

    updateBackground() {
        if (this.container) {
            this.container.style.backgroundColor = this.state.settings.backgroundColor;
        }
    }

    exportCanvas(options?: { pixelRatio?: number }): HTMLCanvasElement | undefined {
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;
        const stageCanvas = this.stage.toCanvas({ pixelRatio: options?.pixelRatio ?? 1 });
        const composite = document.createElement('canvas');
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite;
    }

    // --- Viewport → Stage (one-way, called from onChange) ---

    private applyViewportToStage() {
        const scale = this.viewport.getScale();
        this.stage.scale({x: scale, y: scale});
        this.stage.position(this.viewport.position);
        this.stage.batchDraw();
        this.pipeline.gridRenderer.render(this.viewport.getViewportBounds());
        this.culling.scheduleCulling();
        this.refreshAmbientLight();
        const vpBounds = this.viewport.getViewportBounds();
        for (const plugin of this.liveEffects.values()) {
            plugin.updateViewport(vpBounds, scale, this.coordinateTransform);
        }
    }

    // --- Canvas export ---

    toCanvas(options: {
        width: number;
        height: number;
        roomId?: number;
        padding?: number;
    }): any {
        const {currentArea, currentZIndex, currentAreaInstance} = this.state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const {width, height} = options;
        const padding = options.padding ?? 3;

        // Save current viewport state
        const savedWidth = this.viewport.width;
        const savedHeight = this.viewport.height;
        const savedZoom = this.viewport.zoom;
        const savedMinZoom = this.viewport.minZoom;
        const savedPos = {...this.viewport.position};

        // Suppress onChange during export framing
        const savedOnChange = this.viewport.onChange;
        this.viewport.onChange = undefined;

        // Frame for export — use transformed bounds so iso/transformed renders fill the canvas
        const rawBounds = this.state.computeExportBounds(area, plane, options.roomId, padding);
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
        const scaleX = width / bounds.w;
        const scaleY = height / bounds.h;
        const scale = Math.min(scaleX, scaleY);
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        const offsetX = (width - mapPixelW) / 2;
        const offsetY = (height - mapPixelH) / 2;

        // Update viewport to match export framing so grid/culling use correct bounds.
        // Set zoom so that viewport.getScale() === export scale.
        const exportPosition = {x: offsetX - bounds.x * scale, y: offsetY - bounds.y * scale};
        this.viewport.width = width;
        this.viewport.height = height;
        this.viewport.zoom = scale / (this.viewport.getScale() / this.viewport.zoom);
        this.viewport.position = exportPosition;

        this.stage.width(width);
        this.stage.height(height);
        this.stage.scale({x: scale, y: scale});
        this.stage.position(exportPosition);

        this.pipeline.gridRenderer.render(this.viewport.getViewportBounds());
        this.culling.updateCulling();

        // Temporary background layer
        const bgLayer = new Konva.Layer({listening: false});
        bgLayer.scale({x: 1 / scale, y: 1 / scale});
        bgLayer.position({x: -(offsetX - bounds.x * scale) / scale, y: -(offsetY - bounds.y * scale) / scale});
        bgLayer.add(new Konva.Rect({x: 0, y: 0, width, height, fill: this.state.settings.backgroundColor}));
        this.stage.add(bgLayer);
        bgLayer.moveToBottom();

        const canvas = this.stage.toCanvas({width, height});

        // Restore
        bgLayer.destroy();
        this.viewport.width = savedWidth;
        this.viewport.height = savedHeight;
        this.viewport.zoom = savedZoom;
        this.viewport.minZoom = savedMinZoom;
        this.viewport.position = savedPos;
        this.viewport.onChange = savedOnChange;

        this.stage.width(savedWidth);
        this.stage.height(savedHeight);
        this.applyViewportToStage();
        this.culling.updateCulling();

        return canvas;
    }

    // --- State event handlers ---

    refresh() {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) return;
        this.updateBackground();
        const result = this.buildScene(currentAreaInstance, plane, currentZIndex, this.viewport.getViewportBounds());
        this.onSceneBuilt(result);
        this.syncHighlights();
        this.syncPaths();
        if (positionRoomId !== undefined) {
            this.onPositionChanged(positionRoomId, false, false);
        }
    }

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        effect.attach(this.overlayLayer);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.viewport.getViewportBounds(), this.viewport.getScale(), this.coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) {
            existing.destroy();
            this.liveEffects.delete(id);
        }
    }

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        this.sceneOverlays.set(id, overlay);
        this.renderSceneOverlays();
    }

    removeSceneOverlay(id: string) {
        this.sceneOverlays.delete(id);
        this.renderSceneOverlays();
    }

    /** Iterable of scene overlays — used by exporters to apply them over static outputs. */
    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    private renderSceneOverlays() {
        for (const node of this.sceneOverlayNodes) node.destroy();
        this.sceneOverlayNodes.length = 0;
        if (this.sceneOverlays.size === 0) return;

        const bounds = this.viewport.getViewportBounds();
        for (const overlay of this.sceneOverlays.values()) {
            const out = overlay.render(this.drawingBackend, this.state, bounds);
            if (!out) continue;
            const nodes = Array.isArray(out) ? out : [out];
            for (const node of nodes) {
                this.overlayLayerNode.addNode(node);
                this.sceneOverlayNodes.push(node);
            }
        }
        this.overlayLayer.batchDraw();
    }

    private subscribeToState(state: MapState) {
        state.events.on('area', () => {
            this.refresh();
        });

        state.events.on('position', ({roomId, center, areaChanged}) => {
            this.onPositionChanged(roomId, center, areaChanged);
        });

        state.events.on('center', ({roomId, instant}) => {
            const room = state.mapReader.getRoom(roomId);
            if (room) {
                const p = this.mapPoint(room.x, room.y);
                this.viewport.panToMapPointAnimated(p.x, p.y,
                    instant || this.state.settings.instantMapMove);
            }
        });

        state.events.on('highlight', ({roomId, color}) => {
            this.syncHighlight(roomId, color);
        });

        state.events.on('path', () => {
            this.syncPaths();
        });

        state.events.on('clear', () => {
            this.syncHighlights();
        });
    }

    // --- Scene lifecycle ---

    private buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: import("../types/Settings").ViewportBounds): SceneBuildResult {
        this.positionLayer.destroyChildren();
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

        // Apply current viewport scale to stage
        const scale = this.viewport.getScale();
        this.stage.scale({x: scale, y: scale});

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
        this.stage.batchDraw();
    }

    // --- Position & overlay ---

    private onPositionChanged(roomId: number | undefined, center: boolean, instant: boolean) {
        if (roomId === undefined) {
            if (this.positionMarker) {
                this.positionMarker.destroy();
                this.positionMarker = undefined;
            }
            if (this.ambientLightNode) {
                this.ambientLightNode.destroy();
                this.ambientLightNode = undefined;
            }
            this.positionLayerNode.batchDraw();
            this.clearCurrentRoomOverlay();
            this.overlayLayerNode.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        if (center) {
            const p = this.mapPoint(room.x, room.y);
            this.viewport.panToMapPointAnimated(p.x, p.y,
                instant || this.state.settings.instantMapMove);
        }

        this.updateCurrentRoomOverlay(room);
        this.applyAmbientLight(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        if (this.positionMarker) {
            this.positionMarker.destroy();
        }
        const data = computePositionMarker(room, this.state.settings);
        this.positionMarker = renderPositionMarker(this.drawingBackend, data);
        this.positionLayerNode.addNode(this.positionMarker);
    }

    private applyAmbientLight(room: MapData.Room) {
        if (this.ambientLightNode) {
            this.ambientLightNode.destroy();
            this.ambientLightNode = undefined;
        }
        if (!this.state.settings.ambientLight.enabled) return;

        const bounds = this.viewport.getViewportBounds();
        const data = computeAmbientLight(room.x, room.y, bounds, this.state.settings);
        this.ambientLightNode = renderAmbientLight(this.drawingBackend, data);
        this.overlayLayerNode.addNode(this.ambientLightNode);
        this.overlayLayerNode.batchDraw();
    }

    private refreshAmbientLight() {
        if (!this.state.settings.ambientLight.enabled || this.state.positionRoomId === undefined) return;
        const room = this.state.mapReader.getRoom(this.state.positionRoomId);
        if (room) this.applyAmbientLight(room);
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
        const exitRenderer = this.pipeline.exitRenderer;

        const explorationArea =
            this.state.currentAreaInstance instanceof ExplorationArea ? this.state.currentAreaInstance : undefined;

        // Link exits for this room → rendered as ExitDrawData through DrawingBackend
        if (this.state.currentAreaInstance && this.state.currentZIndex !== undefined) {
            const exits = this.state.currentAreaInstance
                .getLinkExits(this.state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const data = exitRenderer.renderDataWithColor(exit, currentRoomColor, this.state.currentZIndex!);
                if (data) {
                    preRoomNodes.push(this.pipeline.renderExitData(data));
                }
            });
        }

        // Special exits
        for (const se of computeSpecialExits(room, settings, currentRoomColor)) {
            preRoomNodes.push(renderSpecialExitGroup(this.drawingBackend, se));
        }

        // Stubs
        const stubs = computeStubs(room, settings, currentRoomColor);
        if (stubs.length > 0) {
            preRoomNodes.push(renderStubsGroup(this.drawingBackend, stubs));
        }

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.state.mapReader.getRoom(id);
            const canRenderOtherRoom =
                !explorationArea || explorationArea.hasVisitedRoom(id);

            if (
                otherRoom &&
                otherRoom.area === this.state.currentArea &&
                otherRoom.z === this.state.currentZIndex &&
                canRenderOtherRoom
            ) {
                roomsToRedraw.set(id, otherRoom);
            }
        });

        preRoomNodes.forEach(node => {
            this.positionLayerNode.addNode(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayNode = this.pipeline.roomShapeRenderer.createRoomGroup(
                roomToRedraw,
                {
                    strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
                },
            );
            this.positionLayerNode.addNode(overlayNode);
            this.currentRoomOverlay.push(overlayNode);
        });

        roomsToRedraw.forEach((roomToRedraw) => {
            const {triangles} = computeInnerExits(roomToRedraw, this.state.mapReader, settings);
            if (triangles.length > 0) {
                const group = renderInnerExitsGroup(this.drawingBackend, triangles);
                this.positionLayerNode.addNode(group);
                this.currentRoomOverlay.push(group);
            }
        });

        if (this.positionMarker) {
            this.positionMarker.moveToTop();
        }

        this.positionLayerNode.batchDraw();
    }

    // --- Highlight & path sync ---

    syncHighlight(roomId: number, color: string | undefined) {
        const existing = this.highlightShapes.get(roomId);
        if (existing) {
            existing.destroy();
            this.highlightShapes.delete(roomId);
        }
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
        for (const shape of this.highlightShapes.values()) {
            shape.destroy();
        }
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
                path.locations, path.color,
                currentArea, currentZIndex,
            );
            const group = renderPathOverlay(this.drawingBackend, data);
            this.overlayLayerNode.addNode(group);
            this.pathShapes.push(group);
        }
        this.overlayLayerNode.batchDraw();
    }

    // --- Private helpers ---

    private clearOverlayShapes() {
        for (const shape of this.highlightShapes.values()) {
            shape.destroy();
        }
        this.highlightShapes.clear();
        this.clearPathShapes();
    }

    private clearPathShapes() {
        for (const shape of this.pathShapes) {
            shape.destroy();
        }
        this.pathShapes = [];
    }
}
