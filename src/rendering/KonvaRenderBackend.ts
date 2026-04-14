import Konva from "konva";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";
import type {RendererEventMap} from "../Renderer";
import {buildPositionMarker, buildHighlight, buildPathOverlay} from "../SceneBuilder";
import {ScenePipeline} from "../ScenePipeline";
import type {SceneBuildResult, AreaExitHitZone} from "../ScenePipeline";
import type {MapState} from "../MapState";
import {Viewport} from "../Viewport";
import {CullingManager} from "../CullingManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {KonvaBackend, KonvaGroupNode, KonvaLayerNode} from "../backend/KonvaBackend";
import {drawExitDataToCanvas} from "../scene/ExitDataRenderer";
import ExplorationArea from "../reader/ExplorationArea";

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
export class KonvaRenderBackend {
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
    private pipeline: ScenePipeline;
    private lastBuildResult?: SceneBuildResult;

    private positionMarker?: Konva.Shape;
    private highlightShapes: Map<number, Konva.Shape> = new Map();
    private pathShapes: (Konva.Group | Konva.Shape)[] = [];
    private currentRoomOverlay: Konva.Node[] = [];
    private areaExitHitZones: AreaExitHitZone[] = [];

    constructor(state: MapState, container?: HTMLDivElement) {
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

        const konvaBackend = new KonvaBackend();
        this.pipeline = new ScenePipeline(state.mapReader, state.settings, konvaBackend, {
            gridLayer: new KonvaLayerNode(this.gridLayer),
            linkLayer: new KonvaLayerNode(this.linkLayer),
            roomLayer: new KonvaLayerNode(this.roomLayer),
        });

        this.events = new TypedEventEmitter<RendererEventMap>(container);

        this.culling = new CullingManager(
            this.stage,
            new KonvaLayerNode(this.roomLayer),
            new KonvaLayerNode(this.linkLayer),
            state.settings,
            this.pipeline.gridRenderer,
            this.viewport,
        );

        // Viewport drives the stage
        this.viewport.onChange = () => this.applyViewportToStage();

        if (container) {
            // Sync stage size when viewport resizes
            const origSetSize = this.viewport.setSize.bind(this.viewport);
            this.viewport.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };

            new InteractionHandler(container, this.viewport, state, state.settings, {
                clientToMapPoint: (cx, cy) => this.viewport.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => this.culling.findRoomAtMapPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
            }, this.events);
        }

        this.subscribeToState(state);
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

    updateBackground() {
        if (this.container) {
            this.container.style.backgroundColor = this.state.settings.backgroundColor;
        }
    }

    // --- Viewport → Stage (one-way, called from onChange) ---

    private applyViewportToStage() {
        const scale = this.viewport.getScale();
        this.stage.scale({x: scale, y: scale});
        this.stage.position(this.viewport.position);
        this.stage.batchDraw();
        this.culling.scheduleCulling();
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

        // Frame for export
        const bounds = this.state.computeExportBounds(area, plane, options.roomId, padding);
        const scaleX = width / bounds.w;
        const scaleY = height / bounds.h;
        const scale = Math.min(scaleX, scaleY);
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        const offsetX = (width - mapPixelW) / 2;
        const offsetY = (height - mapPixelH) / 2;

        this.viewport.width = width;
        this.viewport.height = height;
        this.stage.width(width);
        this.stage.height(height);
        this.stage.scale({x: scale, y: scale});
        this.stage.position({x: offsetX - bounds.x * scale, y: offsetY - bounds.y * scale});

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
        const result = this.buildScene(currentAreaInstance, plane, currentZIndex, this.viewport.getViewportBounds());
        this.onSceneBuilt(result);
        this.syncHighlights();
        if (positionRoomId !== undefined) {
            this.onPositionChanged(positionRoomId, false, false);
        }
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
                this.viewport.panToMapPointAnimated(room.x, room.y,
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

    private buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: import("../Renderer").ViewportBounds): SceneBuildResult {
        this.positionLayer.destroyChildren();
        this.positionMarker = undefined;
        this.clearOverlayShapes();
        this.currentRoomOverlay = [];

        const result = this.pipeline.buildScene(area, plane, zIndex, viewportBounds);

        // Konva-specific: batch exit rendering via sceneFunc for performance
        const visibleExitDrawData = result.exitDrawData;
        const exitBatchShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context;
                for (const data of visibleExitDrawData) {
                    drawExitDataToCanvas(ctx, data);
                }
            },
        });
        this.linkLayer.add(exitBatchShape);

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
        this.culling.visibleExitDrawData = result.exitDrawData;
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
            this.positionLayer.batchDraw();
            this.clearCurrentRoomOverlay();
            this.overlayLayer.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        if (center) {
            this.viewport.panToMapPointAnimated(room.x, room.y,
                instant || this.state.settings.instantMapMove);
        }

        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        if (this.positionMarker) {
            this.positionMarker.destroy();
        }
        this.positionMarker = buildPositionMarker(room, this.state.settings);
        this.positionLayer.add(this.positionMarker);
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.positionLayer.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            this.positionLayer.batchDraw();
            return;
        }

        const settings = this.state.settings;

        if (!settings.highlightCurrentRoom) {
            if (this.positionMarker) this.positionMarker.moveToTop();
            this.positionLayer.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        const preRoomNodes: Array<Konva.Group | Konva.Shape> = [];
        const exitRenderer = this.pipeline.exitRenderer;

        const explorationArea =
            this.state.currentAreaInstance instanceof ExplorationArea ? this.state.currentAreaInstance : undefined;

        if (this.state.currentAreaInstance && this.state.currentZIndex !== undefined) {
            const exits = this.state.currentAreaInstance
                .getLinkExits(this.state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const render = exitRenderer.renderWithColor(exit, currentRoomColor, this.state.currentZIndex!);
                if (render) {
                    preRoomNodes.push(render);
                }
            });
        }

        exitRenderer.renderSpecialExits(room, currentRoomColor).forEach(render => {
            preRoomNodes.push(render);
        });

        exitRenderer.renderStubs(room, currentRoomColor).forEach(render => {
            preRoomNodes.push(render);
        });

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
            this.positionLayer.add(node);
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
            const overlayRoom = (overlayNode as KonvaGroupNode).konvaGroup;
            this.positionLayer.add(overlayRoom);
            this.currentRoomOverlay.push(overlayRoom);
        });

        roomsToRedraw.forEach((roomToRedraw) => {
            exitRenderer.renderInnerExits(roomToRedraw).forEach(render => {
                this.positionLayer.add(render);
                this.currentRoomOverlay.push(render);
            });
        });

        if (this.positionMarker) {
            this.positionMarker.moveToTop();
        }

        this.positionLayer.batchDraw();
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
                const shape = buildHighlight(room, color, this.state.settings);
                this.overlayLayer.add(shape);
                this.highlightShapes.set(roomId, shape);
            }
        }
        this.overlayLayer.batchDraw();
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
            const shape = buildHighlight(room, entry.color, this.state.settings);
            this.overlayLayer.add(shape);
            this.highlightShapes.set(roomId, shape);
        }
        this.overlayLayer.batchDraw();
    }

    syncPaths() {
        this.clearPathShapes();
        const {currentArea, currentZIndex} = this.state;
        if (currentArea === undefined || currentZIndex === undefined) return;

        for (const path of this.state.paths) {
            const group = buildPathOverlay(
                this.state.mapReader, this.state.settings,
                path.locations, path.color,
                currentArea, currentZIndex,
            );
            this.overlayLayer.add(group);
            this.pathShapes.push(group);
        }
        this.overlayLayer.batchDraw();
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
