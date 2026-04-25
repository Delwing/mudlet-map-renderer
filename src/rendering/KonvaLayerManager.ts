import Konva from "konva";
import type {Camera} from "../Camera";
import type {RendererEventMap, ViewportBounds} from "../types/Settings";
import {KonvaLayerNode} from "../backend/KonvaLayerNode";
import {CanvasLayerNode} from "../backend/CanvasBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import type {DrawingBackend, LayerNode, GroupNode, CoordFn, Style} from "../backend/DrawingBackend";
import {IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {InteractionHandler} from "../InteractionHandler";
import type {AreaExitHitZone} from "../ScenePipeline";
import type {MapState} from "../MapState";
import type {MapRenderer, RenderingBackend} from "./MapRenderer";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay, SceneOverlayContext} from "../overlay/SceneOverlay";
import type {ExportCanvas} from "../export/Exporter";
import ExplorationArea from "../reader/ExplorationArea";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {computeInnerExits} from "../scene/InnerExitStyle";
import {
    renderSpecialExitGroup, renderStubsGroup, renderInnerExitsGroup,
} from "../scene/OverlayRenderer";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Konva rendering backend for MapRenderer. Creates and manages the Konva
 * Stage and layers. Passive: exposes layers and drawingBackend, responds to
 * camera/position changes driven by MapRenderer. All orchestration (scene
 * building, overlay sync, culling) is handled externally by MapRenderer.
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
    readonly events: TypedEventEmitter<RendererEventMap>;

    // Raw Konva.Layer references — used for toCanvas/exportCanvas and layer setup
    private readonly _gridKonvaLayer: Konva.Layer;
    private readonly _sceneKonvaLayer: Konva.Layer;
    private readonly _positionKonvaLayer: Konva.Layer;
    private readonly _overlayKonvaLayer: Konva.Layer;
    private readonly _topLabelKonvaLayer: Konva.Layer;

    // CanvasLayerNode / KonvaLayerNode wrappers
    private readonly _gridLayerNode: CanvasLayerNode;
    readonly sceneNode: CanvasLayerNode;
    private readonly _topLabelLayerNode: CanvasLayerNode;
    private readonly _overlayLayerNode: KonvaLayerNode;
    private readonly _positionLayerNode: KonvaLayerNode;

    // --- RenderingBackend: LayerNode layer properties ---
    get gridLayer(): LayerNode { return this._gridLayerNode; }
    get linkLayer(): LayerNode { return this.sceneNode; }
    get roomLayer(): LayerNode { return this.sceneNode; }
    get topLabelLayer(): LayerNode { return this._topLabelLayerNode; }
    get overlayLayer(): LayerNode { return this._overlayLayerNode; }
    get positionLayer(): LayerNode { return this._positionLayerNode; }

    drawingBackend: DrawingBackend;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;

    get coordinateTransform(): CoordFn { return this._coordinateTransform; }

    private readonly renderer: MapRenderer;
    private readonly state: MapState;
    readonly camera: Camera;
    private interactionHandler?: InteractionHandler;
    private origCameraSetSize?: (w: number, h: number) => void;

    private destroyed = false;

    private currentRoomOverlay: GroupNode[] = [];
    areaExitHitZones: AreaExitHitZone[] = [];
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: Map<string, GroupNode[]> = new Map();

    private readonly container?: HTMLDivElement;

    constructor(container: HTMLDivElement | undefined, renderer: MapRenderer, camera?: Camera) {
        this.renderer = renderer;
        this.state = renderer.state;
        this.camera = camera ?? renderer.camera;
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

        this._gridKonvaLayer = new Konva.Layer({ listening: false });
        this.stage.add(this._gridKonvaLayer);

        this._sceneKonvaLayer = new Konva.Layer({ listening: false });
        this.stage.add(this._sceneKonvaLayer);

        this._positionKonvaLayer = new Konva.Layer({ listening: false });
        this.stage.add(this._positionKonvaLayer);

        this._overlayKonvaLayer = new Konva.Layer({ listening: false });
        this.stage.add(this._overlayKonvaLayer);

        this._topLabelKonvaLayer = new Konva.Layer({ listening: false });
        this.stage.add(this._topLabelKonvaLayer);

        this._gridLayerNode = new CanvasLayerNode(this._gridKonvaLayer);
        this.sceneNode = new CanvasLayerNode(this._sceneKonvaLayer);
        this._topLabelLayerNode = new CanvasLayerNode(this._topLabelKonvaLayer);
        this._overlayLayerNode = new KonvaLayerNode(this._overlayKonvaLayer);
        this._positionLayerNode = new KonvaLayerNode(this._positionKonvaLayer);

        this.drawingBackend = new CanvasBackend();
        this.events = new TypedEventEmitter<RendererEventMap>(container);

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

    /**
     * Called by MapRenderer when the camera changes. Updates stage transform
     * and live effects. Does NOT render the grid or schedule culling — MapRenderer
     * handles those.
     */
    onCameraChanged(scale: number, position: { x: number; y: number }, viewportBounds: ViewportBounds) {
        this.stage.scale({x: scale, y: scale});
        this.stage.position(position);
        this.stage.batchDraw();
        for (const effect of this.liveEffects.values()) {
            effect.updateViewport(viewportBounds, scale, this._coordinateTransform);
        }
    }

    /**
     * Called by MapRenderer when the tracked position room changes.
     * Rebuilds the currentRoomOverlay on positionLayerNode. Does NOT add the
     * position marker and does NOT call batchDraw on positionLayer —
     * MapRenderer does both after this returns.
     */
    onPositionChanged(roomId: number | undefined, center: boolean, areaChanged: boolean) {
        this._positionLayerNode.destroyChildren();
        this.clearCurrentRoomOverlay();

        if (roomId === undefined) {
            this._overlayLayerNode.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        this.updateCurrentRoomOverlay(room);
    }

    /**
     * Animate a pan to the given render-space coordinates via InteractionHandler.
     * Called by MapRenderer when handling a 'center' state event.
     */
    animatePanTo(renderX: number, renderY: number) {
        this.interactionHandler?.animatePanTo(renderX, renderY);
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
        this._overlayKonvaLayer.batchDraw();
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

        // Temporarily suppress camera change notifications during export framing
        const tempUnsub = this.camera.addChangeListener(() => {});
        tempUnsub();

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

        this.renderer.pipeline.gridRenderer.render(this._gridLayerNode, this.camera.getViewportBounds());
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

        this.stage.width(savedWidth);
        this.stage.height(savedHeight);
        this.stage.scale({x: this.camera.getScale(), y: this.camera.getScale()});
        this.stage.position(savedPos);
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

    getDrawnExits() { return [] as const; }
    getDrawnSpecialExits() { return [] as const; }
    getDrawnStubs() { return [] as const; }

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

        if (this.origCameraSetSize) this.camera.setSize = this.origCameraSetSize;

        this.clearCurrentRoomOverlay();

        this.stage.destroy();
        this.events.removeAllListeners();
        this.renderer._detachBackend(this);
    }

    // --- Live effects ---

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        const requestRedraw = () => this._overlayKonvaLayer.batchDraw();
        effect.attach(this._overlayKonvaLayer, requestRedraw);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this._coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) { existing.destroy(); this.liveEffects.delete(id); }
    }

    // --- Internal: drawing backend ---

    private applyDrawingBackend(backend: DrawingBackend) {
        const forward = backend.getTransform();
        const newInverse = backend.getInverseTransform();
        const oldInverse = this.coordinateInverse;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.renderer.culling.setCoordinateTransform(forward);
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
        // MapRenderer.setStyle() will call pipeline.setBackend() + culling.setCoordinateTransform()
        // again and then _buildScene(), so no need to trigger a redraw here.
    }

    private applyDrawingBackendTransforms(backend: DrawingBackend) {
        this._coordinateTransform = backend.getTransform();
        this.coordinateInverse = backend.getInverseTransform();
        this.renderer.culling.setCoordinateTransform(this._coordinateTransform);
        this.renderer.pipeline.gridRenderer.setInverseTransform(this.coordinateInverse);
    }

    // --- Internal: current-room overlay ---

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            return;
        }

        const settings = this.state.settings;
        if (!settings.highlightCurrentRoom) {
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
            this._positionLayerNode.addNode(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayNode = this.renderer.pipeline.roomShapeRenderer.createRoomGroup(roomToRedraw, {
                strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
            });
            this._positionLayerNode.addNode(overlayNode);
            this.currentRoomOverlay.push(overlayNode);
        });

        roomsToRedraw.forEach(roomToRedraw => {
            const {triangles} = computeInnerExits(roomToRedraw, this.state.mapReader, settings);
            if (triangles.length > 0) {
                const group = renderInnerExitsGroup(this.drawingBackend, triangles);
                this._positionLayerNode.addNode(group);
                this.currentRoomOverlay.push(group);
            }
        });
    }

    // --- Internal: scene overlays ---

    private createOverlayContext(id: string, overlay: SceneOverlay): SceneOverlayContext {
        return {
            state: this.state,
            onViewportChange: (cb) => this.camera.addChangeListener(cb),
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
                this._overlayLayerNode.addNode(node);
                stored.push(node);
            }
            this.sceneOverlayNodes.set(id, stored);
        }
        this._overlayKonvaLayer.batchDraw();
    }

    private clearSceneOverlayNodes(id: string) {
        const nodes = this.sceneOverlayNodes.get(id);
        if (!nodes) return;
        for (const node of nodes) node.destroy();
        this.sceneOverlayNodes.delete(id);
    }
}
