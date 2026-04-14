import Konva from "konva";
import type Area from "../reader/Area";
import type Plane from "../reader/Plane";
import type {RendererEventMap} from "../Renderer";
import {SceneBuilder, buildPositionMarker, buildHighlight, buildPathOverlay} from "../SceneBuilder";
import type {SceneBuildResult, AreaExitHitZone} from "../SceneBuilder";
import type {MapState} from "../MapState";
import {Viewport} from "../Viewport";
import {CullingManager} from "../CullingManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {KonvaGroupNode, KonvaLayerNode} from "../backend/KonvaBackend";
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
    private sceneBuilder: SceneBuilder;
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

        this.sceneBuilder = new SceneBuilder(state.mapReader, state.settings, {
            gridLayer: this.gridLayer,
            linkLayer: this.linkLayer,
            roomLayer: this.roomLayer,
        });

        this.events = new TypedEventEmitter<RendererEventMap>(container);

        this.culling = new CullingManager(
            this.stage,
            new KonvaLayerNode(this.roomLayer),
            new KonvaLayerNode(this.linkLayer),
            state.settings,
            this.sceneBuilder.gridRenderer,
            this.viewport,
        );

        // Viewport drives the stage
        this.viewport.onChange = () => this.applyViewportToStage();

        if (container) {
            this.initInputEvents(container);
            new InteractionHandler(this.stage, container, state.settings, {
                clientToMapPoint: (cx, cy) => this.viewport.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                findRoomAtPoint: (mx, my) => this.culling.findRoomAtMapPoint(mx, my),
                getAreaExitHitZones: () => this.areaExitHitZones,
            }, this.events);
        }

        this.subscribeToState(state);
    }

    get exitRenderer() {
        return this.sceneBuilder.exitRenderer;
    }

    get roomShapeRenderer() {
        return this.sceneBuilder.roomShapeRenderer;
    }

    get gridRenderer() {
        return this.sceneBuilder.gridRenderer;
    }

    getEffectiveBounds(area: Area, plane: Plane) {
        return this.sceneBuilder.getEffectiveBounds(area, plane);
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

    // --- Input event wiring (interactive mode only) ---

    private initInputEvents(container: HTMLDivElement) {
        const scaleBy = 1.1;

        // --- Resize ---
        const handleResize = () => {
            this.viewport.setSize(container.clientWidth, container.clientHeight);
            this.stage.width(container.clientWidth);
            this.stage.height(container.clientHeight);
            if (this.viewport.centerOnResize && this.state.positionRoomId) {
                const room = this.state.mapReader.getRoom(this.state.positionRoomId);
                if (room) this.viewport.panToMapPoint(room.x, room.y);
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', handleResize);
        }
        container.addEventListener('resize', handleResize);

        // --- Drag (pointer events on container → Viewport) ---
        let pointerDown = false;
        let pointerId: number | undefined;

        container.addEventListener('pointerdown', (e) => {
            // Only drag with left button, ignore if multi-touch is active
            if (e.button !== 0 || e.pointerType === 'touch') return;
            pointerDown = true;
            pointerId = e.pointerId;
            container.setPointerCapture(e.pointerId);
            const rect = container.getBoundingClientRect();
            this.viewport.startDrag(e.clientX - rect.left, e.clientY - rect.top);
        });

        container.addEventListener('pointermove', (e) => {
            if (!pointerDown || e.pointerId !== pointerId) return;
            const rect = container.getBoundingClientRect();
            this.viewport.updateDrag(e.clientX - rect.left, e.clientY - rect.top);
        });

        container.addEventListener('pointerup', (e) => {
            if (e.pointerId !== pointerId) return;
            pointerDown = false;
            pointerId = undefined;
            this.viewport.endDrag();
            this.events.emit('pan', this.viewport.getViewportBounds());
        });

        container.addEventListener('pointercancel', (e) => {
            if (e.pointerId !== pointerId) return;
            pointerDown = false;
            pointerId = undefined;
            this.viewport.endDrag();
        });

        // --- Touch drag (single finger) ---
        let touchDragId: number | undefined;

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchDragId = touch.identifier;
                const rect = container.getBoundingClientRect();
                this.viewport.startDrag(touch.clientX - rect.left, touch.clientY - rect.top);
            } else {
                // Multi-touch: end drag, start pinch
                if (this.viewport.isDragging()) this.viewport.endDrag();
                touchDragId = undefined;
            }
        }, {passive: true});

        container.addEventListener('touchmove', (e) => {
            const touches = e.touches;

            // --- Pinch zoom (two fingers) ---
            if (touches.length >= 2) {
                e.preventDefault();
                if (this.viewport.isDragging()) this.viewport.endDrag();
                touchDragId = undefined;

                const rect = container.getBoundingClientRect();
                const p1 = {x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top};
                const p2 = {x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top};
                this.handlePinch(p1, p2);
                return;
            }

            // --- Single finger drag ---
            if (touches.length === 1 && touchDragId === touches[0].identifier) {
                const touch = touches[0];
                const rect = container.getBoundingClientRect();
                this.viewport.updateDrag(touch.clientX - rect.left, touch.clientY - rect.top);
            }
        });

        container.addEventListener('touchend', (e) => {
            this.lastPinchDistance = undefined;
            if (e.touches.length === 0) {
                if (this.viewport.isDragging()) {
                    this.viewport.endDrag();
                    this.events.emit('pan', this.viewport.getViewportBounds());
                }
                touchDragId = undefined;
            } else if (e.touches.length === 1) {
                // Went from multi to single: start fresh drag
                const touch = e.touches[0];
                touchDragId = touch.identifier;
                const rect = container.getBoundingClientRect();
                this.viewport.startDrag(touch.clientX - rect.left, touch.clientY - rect.top);
            }
        }, {passive: true});

        container.addEventListener('touchcancel', () => {
            this.lastPinchDistance = undefined;
            if (this.viewport.isDragging()) this.viewport.endDrag();
            touchDragId = undefined;
        }, {passive: true});

        // --- Wheel zoom ---
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            let direction = e.deltaY > 0 ? -1 : 1;
            if (e.ctrlKey) direction = -direction;

            const newZoom = direction > 0 ? this.viewport.zoom * scaleBy : this.viewport.zoom / scaleBy;
            if (this.viewport.zoomToPoint(newZoom, screenX, screenY)) {
                this.events.emit('zoom', {zoom: this.viewport.zoom});
                this.events.emit('pan', this.viewport.getViewportBounds());
            }
        }, {passive: false});
    }

    // --- Pinch zoom state ---

    private lastPinchDistance?: number;

    private handlePinch(p1: {x: number; y: number}, p2: {x: number; y: number}) {
        const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);

        if (this.lastPinchDistance === undefined || this.lastPinchDistance === 0 || distance === 0) {
            this.lastPinchDistance = distance;
            return;
        }

        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;
        const newZoom = this.viewport.zoom * (distance / this.lastPinchDistance);

        if (this.viewport.zoomToPoint(newZoom, centerX, centerY)) {
            this.events.emit('zoom', {zoom: this.viewport.zoom});
            this.events.emit('pan', this.viewport.getViewportBounds());
        }

        this.lastPinchDistance = distance;
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
        const bounds = this.computeExportBounds(area, plane, options.roomId, padding);
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

        const result = this.sceneBuilder.buildScene(area, plane, zIndex, viewportBounds);
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
        const exitRenderer = this.sceneBuilder.exitRenderer;

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
            const overlayNode = this.sceneBuilder.roomShapeRenderer.createRoomGroup(
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

    private computeExportBounds(area: Area, plane: Plane, roomId: number | undefined, padding: number) {
        if (roomId !== undefined) {
            const room = this.state.mapReader.getRoom(roomId);
            if (!room) throw new Error(`Room ${roomId} not found`);
            return {x: room.x - padding, y: room.y - padding, w: padding * 2, h: padding * 2};
        }
        const b = this.state.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
        const areaName = this.state.settings.areaName ? area.getAreaName() : undefined;
        const nameOverhead = areaName ? 7 : 0;
        const nameLeftOffset = areaName ? 3.5 : 0;
        const minX = b.minX - nameLeftOffset;
        const minY = b.minY - nameOverhead;
        const nameRight = areaName ? (b.minX - 3.5 + areaName.length * 2.5 * 0.6) : -Infinity;
        const maxX = Math.max(b.maxX, nameRight);
        return {x: minX - padding, y: minY - padding, w: (maxX - minX) + padding * 2, h: (b.maxY - minY) + padding * 2};
    }

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
