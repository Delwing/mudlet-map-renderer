import Konva from "konva";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";
import type {RendererEventMap} from "../types/Settings";
import {ScenePipeline} from "../ScenePipeline";
import type {SceneBuildResult, AreaExitHitZone, DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from "../ScenePipeline";
import {GridRenderer} from "../GridRenderer";
import type {MapState} from "../MapState";
import {Camera} from "../camera/Camera";
import {CullingManager} from "../CullingManager";
import type {CullEntry} from "../CullingManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {KonvaLayerNode} from "../backend/KonvaBackend";
import {CanvasBackend, RecordingLayerNode, DrawCommandLayerNode} from "../backend/CanvasBackend";
import type {DrawEntry} from "../backend/CanvasBackend";
import type {InteractiveBackend} from "./MapRenderer";
import type {DrawingBackend, GroupNode, LayerNode, CoordFn} from "../backend/DrawingBackend";
import {IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {layoutRoom} from "../scene/elements/RoomLayout";
import {layoutInnerExits} from "../scene/elements/ExitLayout";
import {specialExitToShape} from "../scene/elements/SpecialExitLayout";
import {stubToShape} from "../scene/elements/StubLayout";
import {
    highlightToShapes, positionMarkerToShape, pathToShapes,
} from "../scene/elements/OverlayLayout";
import {renderShapeToBackend} from "../scene/elements/renderShapeToBackend";
import ExplorationArea from "../reader/ExplorationArea";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay, SceneOverlayContext} from "../overlay/SceneOverlay";
import type {ExportCanvas} from "../export/Exporter";
import {HitTester} from "../hit/HitTester";
import type {GroupShape, Shape} from "../scene/Shape";
import type {Style, StyleContext} from "../style/Style";
import {identityStyle} from "../style/Style";
import {applyStyleToShapes} from "../style/applyStyle";
import {BASE_SCALE} from "../camera/Camera";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Konva rendering engine. Owns the full rendering pipeline:
 * stage, layers, scene builder, culling, overlays.
 *
 * Camera is the source of truth for transform state.
 * This backend subscribes to the camera's `change` event and applies state to the Konva stage.
 *
 * Works identically in both modes:
 * - DOM container → stage attached to DOM, mouse/touch → camera
 * - No container → headless stage, same camera/culling, no input
 */
export class KonvaRenderBackend implements InteractiveBackend {
    readonly stage: Konva.Stage;
    readonly gridLayer: Konva.Layer;
    readonly linkLayer: Konva.Layer;
    readonly roomLayer: Konva.Layer;
    readonly topLabelLayer: Konva.Layer;
    readonly overlayLayer: Konva.Layer;
    readonly positionLayer: Konva.Layer;

    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private readonly state: MapState;
    private readonly container?: HTMLDivElement;
    private drawingBackend: DrawingBackend;
    private readonly positionLayerNode: LayerNode;
    private readonly overlayLayerNode: LayerNode;
    private gridLayerNode!: RecordingLayerNode;
    private topLabelLayerNode!: RecordingLayerNode;
    private pipeline: ScenePipeline;
    /** Grid renderer owned locally — drives the grid Konva layer for cached redraws. */
    private gridRenderer!: GridRenderer;
    private lastBuildResult?: SceneBuildResult;
    private currentStyle: Style = identityStyle;

    readonly hitTester: HitTester = new HitTester();
    private lastHitShapes: Shape[] = [];

    // Maps from CullEntry (owned by CullingManager) → DrawEntry so the
    // culling callbacks can toggle visibility without knowing about Konva.
    private roomCullEntries: Map<CullEntry, DrawEntry> = new Map();
    private exitCullEntries: Map<CullEntry, DrawEntry> = new Map();
    private sceneNode!: DrawCommandLayerNode;
    /** Lookup from a pipeline-emitted shape to the backend GroupNode it was walked into; rebuilt per buildScene. */
    private shapeToGroup: Map<Shape, GroupNode> = new Map();

    private positionMarker?: GroupNode;
    private highlightShapes: Map<number, GroupNode> = new Map();
    private pathShapes: GroupNode[] = [];
    private currentRoomOverlay: GroupNode[] = [];
    private areaExitHitZones: AreaExitHitZone[] = [];
    private interactionHandler?: InteractionHandler;
    private origSetSize?: (w: number, h: number) => void;
    private cameraChangeHandler?: () => void;
    private destroyed = false;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;

    get coordinateTransform(): CoordFn {
        return this._coordinateTransform;
    }
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: Map<string, GroupNode[]> = new Map();
    private viewportSubscribers: Set<() => void> = new Set();

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
            this.camera = new Camera(container.clientWidth, container.clientHeight);
        } else {
            this.stage = new Konva.Stage({width: 1, height: 1});
            this.camera = new Camera(1, 1);
        }

        this.gridLayer = new Konva.Layer({listening: false});
        this.stage.add(this.gridLayer);
        // linkLayer and roomLayer share one physical Konva.Layer to stay under
        // Konva's recommended layer count. Z-order between link exits and rooms
        // is preserved by insertion order within the shared RecordingLayerNode.
        const sceneLayer = new Konva.Layer({listening: false});
        this.linkLayer = sceneLayer;
        this.roomLayer = sceneLayer;
        this.stage.add(sceneLayer);
        this.positionLayer = new Konva.Layer({listening: false});
        this.stage.add(this.positionLayer);
        this.overlayLayer = new Konva.Layer({listening: false});
        this.stage.add(this.overlayLayer);
        this.topLabelLayer = new Konva.Layer({listening: false});
        this.stage.add(this.topLabelLayer);

        this.drawingBackend = drawingBackend ?? new CanvasBackend();
        this.positionLayerNode = new KonvaLayerNode(this.positionLayer);
        this.overlayLayerNode = new KonvaLayerNode(this.overlayLayer);

        this.sceneNode = new DrawCommandLayerNode(sceneLayer);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.pipeline = new ScenePipeline(state.mapReader, state.settings);
        this.gridRenderer = new GridRenderer(this.gridLayerNode, state.settings, this.drawingBackend);

        this.events = new TypedEventEmitter<RendererEventMap>(container);

        // linkLayer and roomLayer share sceneNode; one batchDraw covers both.
        this.culling = new CullingManager(this.camera, state.settings, {
            setRoomVisible: (entry, visible) => {
                const e = this.roomCullEntries.get(entry);
                if (e) e.visible = visible;
            },
            setExitVisible: (entry, visible) => {
                const e = this.exitCullEntries.get(entry);
                if (e) e.visible = visible;
            },
            afterCulling: (roomsChanged, exitsChanged) => {
                if (roomsChanged || exitsChanged) this.sceneNode.batchDraw();
            },
        });

        // Camera drives the stage
        this.cameraChangeHandler = () => this.applyViewportToStage();
        this.camera.on('change', this.cameraChangeHandler);

        if (container) {
            // Sync stage size when camera resizes
            this.origSetSize = this.camera.setSize.bind(this.camera);
            const origSetSize = this.origSetSize;
            this.camera.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };

            this.interactionHandler = new InteractionHandler(container, this.camera, state, state.settings, {
                clientToMapPoint: (cx, cy) => this.camera.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => this.hitTester.findRoomAtPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
                renderedToMapPoint: (x, y) => this.coordinateInverse(x, y),
            }, this.events);
        }

        this.applyStyleTransforms();
        this.subscribeToState(state);
    }

    setStyle(style: Style) {
        this.currentStyle = style;
        this.sceneNode = new DrawCommandLayerNode(this.linkLayer);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.pipeline = new ScenePipeline(this.state.mapReader, this.state.settings);
        this.gridRenderer = new GridRenderer(this.gridLayerNode, this.state.settings, this.drawingBackend);
        this.applyStyleTransforms();
    }

    /** Pull forward/inverse coord transforms from the active shape Style. */
    private applyStyleTransforms() {
        const forward: CoordFn = this.currentStyle.worldToScene
            ? (x, y) => this.currentStyle.worldToScene!(x, y)
            : IDENTITY_TRANSFORM;
        const newInverse: CoordFn = this.currentStyle.sceneToWorld
            ? (x, y) => this.currentStyle.sceneToWorld!(x, y)
            : IDENTITY_TRANSFORM;
        const oldInverse = this.coordinateInverse;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.culling.setCoordinateTransform(forward);
        this.gridRenderer.setInverseTransform(newInverse);
        if (this.lastHitShapes.length > 0) {
            this.hitTester.build(this.lastHitShapes, this.state.settings.roomSize, forward);
        }

        // Reposition camera so the same map point stays at screen center
        const scale = this.camera.getScale();
        const screenCX = this.camera.width / 2;
        const screenCY = this.camera.height / 2;
        const oldRX = (screenCX - this.camera.position.x) / scale;
        const oldRY = (screenCY - this.camera.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);

        this.camera.position = {
            x: screenCX - nr.x * scale,
            y: screenCY - nr.y * scale,
        };
        this.applyViewportToStage();
    }

    private styleContext(): StyleContext {
        return {
            scale: this.camera.getScale(),
            roomSize: this.state.settings.roomSize,
        };
    }

    private mapPoint(x: number, y: number): { x: number; y: number } {
        return this._coordinateTransform(x, y);
    }

    get exitRenderer() {
        return this.pipeline.exitRenderer;
    }

    getDrawnExits(): readonly DrawnExitEntry[] {
        return this.lastBuildResult?.drawnExits ?? [];
    }

    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] {
        return this.lastBuildResult?.drawnSpecialExits ?? [];
    }

    getDrawnStubs(): readonly DrawnStubEntry[] {
        return this.lastBuildResult?.drawnStubs ?? [];
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

        // Detach scene overlays so they can unsubscribe from events
        for (const overlay of this.sceneOverlays.values()) overlay.detach?.();
        this.sceneOverlays.clear();
        for (const nodes of this.sceneOverlayNodes.values()) {
            for (const node of nodes) node.destroy();
        }
        this.sceneOverlayNodes.clear();
        this.viewportSubscribers.clear();

        // Cancel any running camera animation
        this.camera.cancelAnimation();

        // Restore monkey-patched setSize
        if (this.origSetSize) {
            this.camera.setSize = this.origSetSize;
        }

        // Disconnect camera from stage
        if (this.cameraChangeHandler) {
            this.camera.off('change', this.cameraChangeHandler);
            this.cameraChangeHandler = undefined;
        }

        // Destroy all Konva nodes and the stage
        this.clearOverlayShapes();
        this.clearCurrentRoomOverlay();
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
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

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
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

    // --- Camera → Stage (one-way, called from the camera's change event) ---

    private applyViewportToStage() {
        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});
        this.stage.position(this.camera.position);
        this.stage.batchDraw();
        const gridStart = performance.now();
        this.gridRenderer.render(this.camera.getViewportBounds());
        this.culling.recordGridMs(performance.now() - gridStart);
        this.culling.scheduleCulling();
        const vpBounds = this.camera.getViewportBounds();
        for (const cb of this.viewportSubscribers) cb();
        for (const plugin of this.liveEffects.values()) {
            plugin.updateViewport(vpBounds, scale, this.coordinateTransform);
        }
    }

    // --- State event handlers ---

    refresh() {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.culling.clear();
            this.roomCullEntries.clear();
            this.exitCullEntries.clear();
            this.hitTester.clear();
            this.lastHitShapes = [];
            this.lastBuildResult = undefined;
            this.gridLayer.destroyChildren();
            this.linkLayer.destroyChildren();
            this.stage.batchDraw();
            return;
        }
        this.updateBackground();
        const result = this.buildScene(currentAreaInstance, plane, currentZIndex, this.camera.getViewportBounds());
        this.onSceneBuilt(result);
        this.syncHighlights();
        this.syncPaths();
        if (positionRoomId !== undefined) {
            this.onPositionChanged(positionRoomId, false, false);
        }
        for (const [id, overlay] of this.sceneOverlays) {
            this.renderSceneOverlay(id, overlay);
        }
    }

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        effect.attach(this.overlayLayer);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this.coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) {
            existing.destroy();
            this.liveEffects.delete(id);
        }
    }

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) {
            existing.detach?.();
            this.clearSceneOverlayNodes(id);
        }
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
        this.overlayLayer.batchDraw();
    }

    /** Iterable of scene overlays — used by exporters to apply them over static outputs. */
    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    private createOverlayContext(id: string, overlay: SceneOverlay): SceneOverlayContext {
        return {
            state: this.state,
            onViewportChange: (cb) => {
                this.viewportSubscribers.add(cb);
                return () => this.viewportSubscribers.delete(cb);
            },
            invalidate: () => {
                // Skip if the overlay was removed/replaced since attach.
                if (this.sceneOverlays.get(id) !== overlay) return;
                this.renderSceneOverlay(id, overlay);
            },
        };
    }

    private renderSceneOverlay(id: string, overlay: SceneOverlay) {
        this.clearSceneOverlayNodes(id);
        const bounds = this.camera.getViewportBounds();
        const out = overlay.render(this.state, bounds);
        if (out) {
            const shapes = Array.isArray(out) ? out : [out];
            const stored: GroupNode[] = [];
            for (const shape of shapes) {
                const node = this.addStyledShape(shape, this.overlayLayerNode);
                if (node) stored.push(node);
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
                this.camera.panToMapPointAnimated(p.x, p.y,
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

        // Reset the scene-driving layer nodes; pipeline.buildScene only
        // produces shapes now, so this renderer is responsible for walking
        // them onto the Konva layers via the drawingBackend.
        this.sceneNode.destroyChildren();
        this.gridLayerNode.destroyChildren();
        this.topLabelLayerNode.destroyChildren();

        const result = this.pipeline.buildScene(area, plane, zIndex, viewportBounds);

        // Track ORIGINAL shape (pre-style) → backend GroupNode so onSceneBuilt
        // can find each room/exit's DrawEntry inside `sceneNode` for culling.
        // When style.transform fans a shape into multiple, we record the first
        // resulting GroupNode against the original — cull toggles that one.
        this.shapeToGroup = new Map();

        for (const shape of result.sceneShapes.grid) {
            this.addStyledShape(shape, this.gridLayerNode);
        }
        for (const shape of result.sceneShapes.link) {
            const node = this.addStyledShape(shape, this.sceneNode);
            if (node) this.shapeToGroup.set(shape, node);
        }
        for (const shape of result.sceneShapes.room) {
            const node = this.addStyledShape(shape, this.sceneNode);
            if (node) this.shapeToGroup.set(shape, node);
        }
        for (const shape of result.sceneShapes.topLabel) {
            this.addStyledShape(shape, this.topLabelLayerNode);
        }

        this.lastBuildResult = result;
        return result;
    }

    /** Wrap a non-group shape and walk to backend, returning the GroupNode. */
    private shapeToGroupNode(shape: Shape): GroupNode {
        const groupShape: GroupShape = shape.type === "group"
            ? shape
            : {type: "group", x: 0, y: 0, children: [shape], layer: shape.layer};
        return renderShapeToBackend(this.drawingBackend, groupShape);
    }

    /**
     * Run the active {@link Style} over `shape`, walk every result through
     * {@link renderShapeToBackend}, and add it to `layerNode`. Returns the
     * first emitted GroupNode (used as the cull-tracking handle).
     */
    private addStyledShape(shape: Shape, layerNode: LayerNode): GroupNode | undefined {
        const styled = this.currentStyle === identityStyle
            ? [shape]
            : applyStyleToShapes([shape], this.currentStyle, this.styleContext());
        let first: GroupNode | undefined;
        for (const s of styled) {
            const node = this.shapeToGroupNode(s);
            layerNode.addNode(node);
            if (!first) first = node;
        }
        return first;
    }

    private onSceneBuilt(result: SceneBuildResult) {
        this.culling.clear();
        this.roomCullEntries.clear();
        this.exitCullEntries.clear();
        this.areaExitHitZones = [];
        this.culling.computeBucketSize();
        this.lastHitShapes = result.hitShapes;
        this.hitTester.build(result.hitShapes, this.state.settings.roomSize, this._coordinateTransform);

        // Apply current camera scale to stage
        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});

        const rs = this.state.settings.roomSize;
        const half = rs / 2;
        for (const [, ref] of result.roomShapeRefs) {
            const groupNode = this.shapeToGroup.get(ref.shape);
            if (!groupNode) continue;
            const drawEntry = this.sceneNode.getEntry(groupNode);
            if (!drawEntry) continue;
            const cull: CullEntry = {
                worldBbox: {
                    minX: ref.room.x - half, minY: ref.room.y - half,
                    maxX: ref.room.x + half, maxY: ref.room.y + half,
                },
            };
            this.roomCullEntries.set(cull, drawEntry);
            this.culling.addRoomEntry(cull);
        }
        for (const ref of result.standaloneExitShapeRefs) {
            const groupNode = this.shapeToGroup.get(ref.shape);
            if (!groupNode) continue;
            const drawEntry = this.sceneNode.getEntry(groupNode);
            if (!drawEntry) continue;
            const b = ref.bounds;
            const cull: CullEntry = {
                worldBbox: {minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height},
            };
            this.exitCullEntries.set(cull, drawEntry);
            this.culling.addExitEntry(cull);
        }
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
            this.positionLayerNode.batchDraw();
            this.clearCurrentRoomOverlay();
            this.overlayLayerNode.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        if (center) {
            const p = this.mapPoint(room.x, room.y);
            this.camera.panToMapPointAnimated(p.x, p.y,
                instant || this.state.settings.instantMapMove);
        }

        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        if (this.positionMarker) {
            this.positionMarker.destroy();
        }
        const data = computePositionMarker(room, this.state.settings);
        this.positionMarker = this.addStyledShape(positionMarkerToShape(data), this.positionLayerNode);
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

        const preRoomShapes: Shape[] = [];
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
                    preRoomShapes.push(this.pipeline.buildExitShape(data));
                }
            });
        }

        // Special exits
        for (const se of computeSpecialExits(room, settings, currentRoomColor)) {
            preRoomShapes.push(specialExitToShape(se, room.id));
        }

        // Stubs
        for (const stub of computeStubs(room, settings, currentRoomColor)) {
            preRoomShapes.push(stubToShape(stub));
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

        preRoomShapes.forEach(shape => {
            const node = this.addStyledShape(shape, this.positionLayerNode);
            if (node) this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayShape = layoutRoom(
                roomToRedraw,
                this.state.mapReader,
                settings,
                {
                    strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
                    flatPipeline: true,
                },
            );
            const node = this.addStyledShape(overlayShape, this.positionLayerNode);
            if (node) this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw) => {
            const triangles = layoutInnerExits(roomToRedraw, this.state.mapReader, settings);
            for (const triangle of triangles) {
                const node = this.addStyledShape(triangle, this.positionLayerNode);
                if (node) this.currentRoomOverlay.push(node);
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
                for (const s of highlightToShapes(data)) {
                    const node = this.addStyledShape(s, this.overlayLayerNode);
                    if (node) this.highlightShapes.set(roomId, node);
                }
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
            for (const s of highlightToShapes(data)) {
                const node = this.addStyledShape(s, this.overlayLayerNode);
                if (node) this.highlightShapes.set(roomId, node);
            }
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
            for (const s of pathToShapes(data)) {
                const node = this.addStyledShape(s, this.overlayLayerNode);
                if (node) this.pathShapes.push(node);
            }
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
