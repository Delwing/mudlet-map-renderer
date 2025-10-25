import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";
import Area from "./reader/Area";
import ExplorationArea from "./reader/ExplorationArea";
import PathRenderer from "./PathRenderer";

const defaultRoomSize = 0.6;
const defaultZoom = 75
const lineColor = 'rgb(225, 255, 225)';
const currentRoomColor = 'rgb(120, 72, 0)';

export type LabelRenderMode = "image" | "data";

export type CullingMode = "none" | "basic" | "indexed";

export type RoomContextMenuEventDetail = {
    roomId: number;
    position: { x: number; y: number };
};

export type ZoomChangeEventDetail = {
    zoom: number;
};

export class Settings {
    static roomSize = defaultRoomSize;
    static lineColor = lineColor;
    static instantMapMove = false
    static highlightCurrentRoom = true;
    static cullingEnabled = true;
    static cullingMode: CullingMode = "indexed";
    static cullingBounds: { x: number; y: number; width: number; height: number } | null = null;
    static labelRenderMode: LabelRenderMode = "image";
    static transparentLabels: boolean;
    static cullingDebug = false;
}

type HighlightData = {
    color: string;
    area: number;
    z: number;
    shape?: Konva.Circle;
};

type RoomNodeEntry = { room: MapData.Room; group: Konva.Group; linkNodes: Konva.Node[] };
type Bounds = { x: number; y: number; width: number; height: number };
type StandaloneExitEntry = { node: Konva.Node; bounds: Bounds };

export class Renderer {

    private readonly stage: Konva.Stage;
    private readonly roomLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly overlayLayer: Konva.Layer;
    private readonly positionLayer: Konva.Layer;
    private readonly debugLayer: Konva.Layer;
    private mapReader: MapReader;
    private exitRenderer: ExitRenderer;
    private pathRenderer: PathRenderer;
    private highlights: Map<number, HighlightData> = new Map();
    private currentArea?: number;
    private currentAreaInstance?: Area;
    private currentZIndex?: number;
    private currentAreaVersion?: number;
    private currentRoomId?: number;
    private positionRender?: Konva.Circle;
    private currentTransition?: Konva.Tween;
    private currentZoom: number = 1;
    private currentRoomOverlay: Konva.Node[] = [];
    private roomNodes: Map<number, RoomNodeEntry> = new Map();
    private standaloneExitNodes: StandaloneExitEntry[] = [];
    private spatialBucketSize = 5;
    private roomSpatialIndex: Map<string, Set<RoomNodeEntry>> = new Map();
    private exitSpatialIndex: Map<string, Set<StandaloneExitEntry>> = new Map();
    private visibleRooms: Set<RoomNodeEntry> = new Set();
    private visibleStandaloneExitNodes: Set<StandaloneExitEntry> = new Set();
    private standaloneExitBoundsRoomSize?: number;
    private cullingScheduled = false;
    private cullingViewportDebug?: Konva.Rect;
    private cullingSearchDebug?: Konva.Rect;
    private cullingBucketDebug: Konva.Rect[] = [];

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        window.addEventListener('resize', () => {
            this.onResize(container);
        })
        container.addEventListener('resize', () => {
            this.onResize(container);
        })
        this.linkLayer = new Konva.Layer({
            listening: false,
        });
        this.stage.add(this.linkLayer);
        this.roomLayer = new Konva.Layer();
        this.stage.add(this.roomLayer);
        this.overlayLayer = new Konva.Layer({
            listening: false,
        })
        this.stage.add(this.overlayLayer);
        this.debugLayer = new Konva.Layer({
            listening: false,
        });
        this.stage.add(this.debugLayer);
        this.positionLayer = new Konva.Layer({
            listening: false,
        });
        this.stage.add(this.positionLayer);
        this.mapReader = mapReader;
        this.exitRenderer = new ExitRenderer(mapReader, this);
        this.pathRenderer = new PathRenderer(mapReader, this.overlayLayer);

        const scaleBy = 1.1;
        this.initScaling(scaleBy);

        this.stage.on('dragmove', () => this.scheduleRoomCulling());
        this.stage.on('dragend', () => this.scheduleRoomCulling());
    }

    private onResize(container: HTMLDivElement) {
        this.stage.width(container.clientWidth);
        this.stage.height(container.clientHeight);
        if (this.currentRoomId) {
            this.centerOnRoom(this.mapReader.getRoom(this.currentRoomId)!, false);
        }
        this.stage.batchDraw();
        this.scheduleRoomCulling();
    }

    private initScaling(scaleBy: number) {
        Konva.hitOnDragEnabled = true;

        let lastPinchDistance: number | undefined;
        let dragStopped = false;
        let multiTouchActive = false;

        this.stage.on('touchstart', (e) => {
            const touches = e.evt.touches;
            if (touches && touches.length > 1) {
                multiTouchActive = true;
                if (this.stage.isDragging()) {
                    this.stage.stopDrag();
                    dragStopped = true;
                }
                this.stage.draggable(false);
            } else {
                multiTouchActive = false;
                this.stage.draggable(true);
            }
        });

        this.stage.on('touchend touchcancel', (e) => {
            lastPinchDistance = undefined;
            const touches = e.evt.touches;
            if (!touches || touches.length <= 1) {
                multiTouchActive = false;
                this.stage.draggable(true);
            }
        });

        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();

            const oldScale = this.stage.scaleX();
            const pointer = this.stage.getPointerPosition();
            if (!pointer) {
                return;
            }

            const mousePointTo = {
                x: (pointer.x - this.stage.x()) / oldScale,
                y: (pointer.y - this.stage.y()) / oldScale,
            };

            let direction = e.evt.deltaY > 0 ? -1 : 1;

            if (e.evt.ctrlKey) {
                direction = -direction;
            }

            const newZoom = direction > 0 ? this.currentZoom * scaleBy : this.currentZoom / scaleBy;
            const newScale = newZoom * defaultZoom;
            const zoomChanged = this.setZoom(newZoom);

            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };

            this.stage.position(newPos);

            this.scheduleRoomCulling();

            if (zoomChanged) {
                this.emitZoomChangeEvent();
            }
        });

        this.stage.on('touchmove', (e) => {
            const touches = e.evt.touches;
            const touch1 = touches?.[0];
            const touch2 = touches?.[1];

            if (!touch2) {
                if (multiTouchActive) {
                    multiTouchActive = false;
                    this.stage.draggable(true);
                }
            }

            if (touch1 && !touch2 && dragStopped && !this.stage.isDragging()) {
                this.stage.startDrag();
                dragStopped = false;
            }

            if (!touch1 || !touch2) {
                lastPinchDistance = undefined;
                return;
            }

            e.evt.preventDefault();

            if (this.stage.isDragging()) {
                this.stage.stopDrag();
                dragStopped = true;
            }

            if (!multiTouchActive) {
                multiTouchActive = true;
                this.stage.draggable(false);
            }

            const rect = this.stage.container().getBoundingClientRect();
            const p1 = {
                x: touch1.clientX - rect.left,
                y: touch1.clientY - rect.top,
            };
            const p2 = {
                x: touch2.clientX - rect.left,
                y: touch2.clientY - rect.top,
            };

            const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);

            if (lastPinchDistance === undefined) {
                lastPinchDistance = distance;
                return;
            }

            if (lastPinchDistance === 0) {
                return;
            }

            const oldScale = this.stage.scaleX();
            const stageX = this.stage.x();
            const stageY = this.stage.y();

            const centerPointer = {
                x: this.stage.width() / 2,
                y: this.stage.height() / 2,
            };

            const centerMapPoint = {
                x: (centerPointer.x - stageX) / oldScale,
                y: (centerPointer.y - stageY) / oldScale,
            };

            const newZoom = this.currentZoom * (distance / lastPinchDistance);

            const zoomChanged = this.setZoom(newZoom);

            const newScale = this.stage.scaleX();
            const newPos = {
                x: centerPointer.x - centerMapPoint.x * newScale,
                y: centerPointer.y - centerMapPoint.y * newScale,
            };

            this.stage.position(newPos);
            this.stage.batchDraw();

            this.scheduleRoomCulling();

            lastPinchDistance = distance;

            if (zoomChanged) {
                this.emitZoomChangeEvent();
            }
        });
    }

    drawArea(id: number, zIndex: number) {
        const area = this.mapReader.getArea(id);
        if (!area) {
            return;
        }
        const plane = area.getPlane(zIndex);
        if (!plane) {
            return;
        }
        this.currentArea = id;
        this.currentAreaInstance = area;
        this.currentZIndex = zIndex;
        this.currentAreaVersion = area.getVersion();
        this.clearCurrentRoomOverlay();
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();
        this.debugLayer.destroyChildren();
        this.roomNodes.clear();
        this.standaloneExitNodes = [];
        this.standaloneExitBoundsRoomSize = undefined;
        this.roomSpatialIndex.clear();
        this.exitSpatialIndex.clear();
        this.visibleRooms.clear();
        this.visibleStandaloneExitNodes.clear();
        this.cullingViewportDebug = undefined;
        this.cullingSearchDebug = undefined;
        this.cullingBucketDebug = [];
        this.spatialBucketSize = this.computeSpatialBucketSize();

        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});

        this.renderLabels(plane.getLabels());
        this.renderExits(area.getLinkExits(zIndex));
        this.renderRooms(plane.getRooms() ?? []);
        this.refreshHighlights();
        this.stage.batchDraw();
        this.scheduleRoomCulling();
    }

    private computeSpatialBucketSize() {
        return Math.max(Settings.roomSize * 10, 5);
    }

    private getBucketKey(bucketX: number, bucketY: number) {
        return `${bucketX},${bucketY}`;
    }

    private forEachBucket(minX: number, minY: number, maxX: number, maxY: number, callback: (key: string) => void) {
        const bucketSize = this.spatialBucketSize;
        const safeMinX = Math.min(minX, maxX);
        const safeMaxX = Math.max(minX, maxX);
        const safeMinY = Math.min(minY, maxY);
        const safeMaxY = Math.max(minY, maxY);
        const minBucketX = Math.floor(safeMinX / bucketSize);
        const maxBucketX = Math.floor(safeMaxX / bucketSize);
        const minBucketY = Math.floor(safeMinY / bucketSize);
        const maxBucketY = Math.floor(safeMaxY / bucketSize);

        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
            for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
                callback(this.getBucketKey(bucketX, bucketY));
            }
        }
    }

    private addRoomToSpatialIndex(entry: RoomNodeEntry) {
        const halfSize = Settings.roomSize / 2;
        const minX = entry.room.x - halfSize;
        const maxX = entry.room.x + halfSize;
        const minY = entry.room.y - halfSize;
        const maxY = entry.room.y + halfSize;

        this.forEachBucket(minX, minY, maxX, maxY, key => {
            let bucket = this.roomSpatialIndex.get(key);
            if (!bucket) {
                bucket = new Set();
                this.roomSpatialIndex.set(key, bucket);
            }
            bucket.add(entry);
        });
    }

    private addStandaloneExitToSpatialIndex(entry: StandaloneExitEntry) {
        const {bounds} = entry;
        const minX = bounds.x;
        const maxX = bounds.x + bounds.width;
        const minY = bounds.y;
        const maxY = bounds.y + bounds.height;

        this.forEachBucket(minX, minY, maxX, maxY, key => {
            let bucket = this.exitSpatialIndex.get(key);
            if (!bucket) {
                bucket = new Set();
                this.exitSpatialIndex.set(key, bucket);
            }
            bucket.add(entry);
        });
    }

    private collectRoomCandidates(minX: number, minY: number, maxX: number, maxY: number, debugBuckets?: Set<string>) {
        const result = new Set<RoomNodeEntry>();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            if (debugBuckets) {
                debugBuckets.add(key);
            }
            const bucket = this.roomSpatialIndex.get(key);
            bucket?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private collectStandaloneExitCandidates(minX: number, minY: number, maxX: number, maxY: number, debugBuckets?: Set<string>) {
        const result = new Set<StandaloneExitEntry>();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            if (debugBuckets) {
                debugBuckets.add(key);
            }
            const bucket = this.exitSpatialIndex.get(key);
            bucket?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private refreshStandaloneExitBoundsIfNeeded() {
        if (this.standaloneExitBoundsRoomSize === Settings.roomSize) {
            return;
        }

        this.exitSpatialIndex.clear();
        this.standaloneExitNodes.forEach(entry => {
            entry.bounds = entry.node.getClientRect({relativeTo: this.linkLayer});
            this.addStandaloneExitToSpatialIndex(entry);
        });
        this.standaloneExitBoundsRoomSize = Settings.roomSize;
    }

    private getBucketBounds(key: string) {
        const [xString, yString] = key.split(",");
        const bucketX = Number.parseInt(xString, 10);
        const bucketY = Number.parseInt(yString, 10);
        const bucketSize = this.spatialBucketSize;
        return {
            x: bucketX * bucketSize,
            y: bucketY * bucketSize,
            width: bucketSize,
            height: bucketSize,
        };
    }

    private emitRoomContextEvent(roomId: number, clientX: number, clientY: number) {
        const container = this.stage.container();
        const bounds = container.getBoundingClientRect();
        const detail: RoomContextMenuEventDetail = {
            roomId,
            position: {
                x: clientX - bounds.left,
                y: clientY - bounds.top,
            },
        };
        const event = new CustomEvent<RoomContextMenuEventDetail>('roomcontextmenu', {detail});
        container.dispatchEvent(event);
    }

    private emitZoomChangeEvent() {
        const event = new CustomEvent<ZoomChangeEventDetail>('zoom', {
            detail: {zoom: this.currentZoom},
        });
        this.stage.container().dispatchEvent(event);
    }

    setZoom(zoom: number): boolean {
        if (this.currentZoom === zoom) {
            return false;
        }

        this.currentZoom = zoom;
        this.stage.scale({x: defaultZoom * zoom, y: defaultZoom * zoom});
        this.scheduleRoomCulling();

        return true;
    }

    getZoom() {
        return this.currentZoom;
    }

    setCullingMode(mode: CullingMode) {
        Settings.cullingMode = mode;
        Settings.cullingEnabled = mode !== "none";
        this.scheduleRoomCulling();
    }

    getCullingMode() {
        return Settings.cullingMode;
    }

    setCullingDebug(enabled: boolean) {
        Settings.cullingDebug = enabled;
        this.scheduleRoomCulling();
    }

    getCurrentArea() {
        return this.currentArea ? this.mapReader.getArea(this.currentArea) : undefined
    }

    setPosition(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        let instant = this.currentArea !== room.area || this.currentZIndex !== room.z
        if (
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        ) {
            this.drawArea(room.area, room.z);
        }
        if (!this.positionRender) {
            this.positionRender = new Konva.Circle({
                x: room.x,
                y: room.y,
                radius: defaultRoomSize * 0.85,
                stroke: "rgb(0, 229, 178)",
                strokeWidth: 0.1,
                dash: [0.05, 0.05],
                dashEnabled: true,
            })
            this.positionLayer.add(this.positionRender);
        }
        this.centerOnRoom(room, instant);
        this.updateCurrentRoomOverlay(room);
    }

    renderPath(locations: number[], color?: string) {
        return this.pathRenderer.renderPath(locations, this.currentArea, this.currentZIndex, color);
    }

    clearPaths() {
        this.pathRenderer.clearPaths();
    }

    renderHighlight(roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) {
            return;
        }

        const existing = this.highlights.get(roomId);
        if (existing?.shape) {
            existing.shape.destroy();
            delete existing.shape;
        }

        const highlightData: HighlightData = {color, area: room.area, z: room.z};

        this.highlights.set(roomId, highlightData);

        if (room.area === this.currentArea && room.z === this.currentZIndex) {
            const shape = this.createHighlightShape(room, color);
            this.overlayLayer.add(shape);
            highlightData.shape = shape;
            this.overlayLayer.batchDraw();
            return shape;
        }

        return highlightData.shape;
    }

    clearHighlights() {
        this.highlights.forEach(({shape}) => shape?.destroy());
        this.highlights.clear();
        this.overlayLayer.batchDraw();
    }

    private refreshHighlights() {
        this.highlights.forEach((highlight, roomId) => {
            highlight.shape?.destroy();
            delete highlight.shape;

            if (highlight.area !== this.currentArea || highlight.z !== this.currentZIndex) {
                return;
            }

            const room = this.mapReader.getRoom(roomId);
            if (!room) {
                return;
            }

            const shape = this.createHighlightShape(room, highlight.color);
            this.overlayLayer.add(shape);
            highlight.shape = shape;
        });

        this.overlayLayer.batchDraw();
    }

    private createHighlightShape(room: MapData.Room, color: string) {
        return new Konva.Circle({
            x: room.x,
            y: room.y,
            radius: Settings.roomSize * 0.9,
            stroke: color,
            strokeWidth: 0.15,
            dash: [0.1, 0.05],
            dashEnabled: true,
            listening: false,
        });
    }

    private centerOnRoom(room: MapData.Room, instant: boolean = false) {
        this.currentRoomId = room.id;
        const roomCenter = {x: room.x, y: room.y};

        this.positionRender?.position(room)

        const abs = this.stage.getAbsoluteTransform()
        const screenPoint = abs.point(roomCenter);

        const target = {
            x: this.stage.width() / 2,
            y: this.stage.height() / 2,
        };

        const dx = target.x - screenPoint.x;
        const dy = target.y - screenPoint.y;

        if (this.currentTransition) {
            this.currentTransition.pause()
            this.currentTransition.destroy()
            delete this.currentTransition;
        }

        if (instant || Settings.instantMapMove) {
            this.stage.position({
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
            })
            this.scheduleRoomCulling();
        } else {
            this.currentTransition = new Konva.Tween({
                node: this.stage,
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
                duration: 0.2,
                easing: Konva.Easings.EaseInOut,
                onUpdate: () => this.scheduleRoomCulling(),
                onFinish: () => this.scheduleRoomCulling(),
            })
            this.currentTransition.play()
        }
    }

    private renderRooms(rooms: MapData.Room[]) {
        rooms.forEach(room => {
            const roomRender = new Konva.Group({
                x: room.x - Settings.roomSize / 2,
                y: room.y - Settings.roomSize / 2,
            });
            const roomRect = new Konva.Rect({
                x: 0,
                y: 0,
                width: Settings.roomSize,
                height: Settings.roomSize,
                fill: this.mapReader.getColorValue(room.env),
                strokeWidth: 0.025,
                stroke: Settings.lineColor,
            });
            const emitContextEvent = (clientX: number, clientY: number) => this.emitRoomContextEvent(room.id, clientX, clientY);

            roomRender.on('mouseenter', () => {
                this.stage.container().style.cursor = 'pointer';
            })
            roomRender.on('mouseleave', () => {
                this.stage.container().style.cursor = 'auto';
            })
            roomRender.on('contextmenu', (event) => {
                event.evt.preventDefault();
                const pointerEvent = event.evt as MouseEvent;
                emitContextEvent(pointerEvent.clientX, pointerEvent.clientY);
            })

            let longPressTimeout: number | undefined;
            let longPressStart: { clientX: number; clientY: number } | undefined;
            let stageDraggableBeforeLongPress: boolean | undefined;
            const restoreStageDraggable = () => {
                if (stageDraggableBeforeLongPress !== undefined) {
                    this.stage.draggable(stageDraggableBeforeLongPress);
                    stageDraggableBeforeLongPress = undefined;
                }
            };
            const clearLongPressTimeout = () => {
                if (longPressTimeout !== undefined) {
                    window.clearTimeout(longPressTimeout);
                    longPressTimeout = undefined;
                }
                longPressStart = undefined;
                restoreStageDraggable();
            };

            roomRender.on('touchstart', (event) => {
                clearLongPressTimeout();
                if (event.evt.touches && event.evt.touches.length > 1) {
                    return;
                }
                const touch = event.evt.touches?.[0];
                if (!touch) {
                    return;
                }
                longPressStart = {clientX: touch.clientX, clientY: touch.clientY};
                stageDraggableBeforeLongPress = this.stage.draggable();
                this.stage.draggable(false);
                longPressTimeout = window.setTimeout(() => {
                    if (longPressStart) {
                        emitContextEvent(longPressStart.clientX, longPressStart.clientY);
                    }
                    clearLongPressTimeout();
                }, 500);
            });

            roomRender.on('touchend', clearLongPressTimeout);
            roomRender.on('touchmove', (event) => {
                if (!longPressStart) {
                    return;
                }
                const touch = event.evt.touches?.[0];
                if (!touch) {
                    clearLongPressTimeout();
                    return;
                }
                const dx = touch.clientX - longPressStart.clientX;
                const dy = touch.clientY - longPressStart.clientY;
                const distanceSquared = dx * dx + dy * dy;
                const movementThreshold = 10;
                if (distanceSquared > movementThreshold * movementThreshold) {
                    const wasDraggable = stageDraggableBeforeLongPress;
                    clearLongPressTimeout();
                    if (wasDraggable) {
                        this.stage.startDrag();
                    }
                }
            });
            roomRender.on('touchcancel', clearLongPressTimeout);

            roomRender.add(roomRect);
            this.renderSymbol(room, roomRender);
            this.roomLayer.add(roomRender);

            const linkNodes: Konva.Node[] = [];
            this.exitRenderer.renderSpecialExits(room).forEach(render => {
                this.linkLayer.add(render)
                linkNodes.push(render);
            })
            this.exitRenderer.renderStubs(room).forEach(render => {
                this.linkLayer.add(render)
                linkNodes.push(render);
            })
            this.exitRenderer.renderInnerExits(room).forEach(render => {
                this.roomLayer.add(render)
            })

            const entry: RoomNodeEntry = {room, group: roomRender, linkNodes};
            this.roomNodes.set(room.id, entry);
            this.addRoomToSpatialIndex(entry);
        })
    }

    private scheduleRoomCulling() {
        if (this.cullingScheduled) {
            return;
        }
        this.cullingScheduled = true;
        window.requestAnimationFrame(() => {
            this.cullingScheduled = false;
            this.updateRoomCulling();
        });
    }

    private updateRoomCulling() {
        if (this.roomNodes.size === 0 && this.standaloneExitNodes.length === 0) {
            return;
        }

        const scale = this.stage.scaleX();
        if (!scale) {
            return;
        }

        const stagePosition = this.stage.position();
        const halfSize = Settings.roomSize / 2;
        const bounds = Settings.cullingBounds;
        const viewportMinX = bounds ? bounds.x : 0;
        const viewportMaxX = bounds ? bounds.x + bounds.width : this.stage.width();
        const viewportMinY = bounds ? bounds.y : 0;
        const viewportMaxY = bounds ? bounds.y + bounds.height : this.stage.height();
        const minViewportX = Math.min(viewportMinX, viewportMaxX);
        const maxViewportX = Math.max(viewportMinX, viewportMaxX);
        const minViewportY = Math.min(viewportMinY, viewportMaxY);
        const maxViewportY = Math.max(viewportMinY, viewportMaxY);
        const minX = (minViewportX - stagePosition.x) / scale;
        const maxX = (maxViewportX - stagePosition.x) / scale;
        const minY = (minViewportY - stagePosition.y) / scale;
        const maxY = (maxViewportY - stagePosition.y) / scale;

        let roomLayerNeedsDraw = false;
        let linkLayerNeedsDraw = false;

        const mode: CullingMode = Settings.cullingEnabled ? Settings.cullingMode ?? "indexed" : "none";
        const searchMinX = minX - halfSize;
        const searchMaxX = maxX + halfSize;
        const searchMinY = minY - halfSize;
        const searchMaxY = maxY + halfSize;

        this.refreshStandaloneExitBoundsIfNeeded();

        if (mode === "none") {
            this.roomNodes.forEach(entry => {
                if (!entry.group.visible()) {
                    entry.group.visible(true);
                    roomLayerNeedsDraw = true;
                }
                entry.linkNodes.forEach(node => {
                    if (!node.visible()) {
                        node.visible(true);
                        linkLayerNeedsDraw = true;
                    }
                });
            });

            this.standaloneExitNodes.forEach(entry => {
                const {node} = entry;
                if (!node.visible()) {
                    linkLayerNeedsDraw = true;
                    node.visible(true);
                }
            });

            if (roomLayerNeedsDraw) {
                this.roomLayer.batchDraw();
            }
            if (linkLayerNeedsDraw) {
                this.linkLayer.batchDraw();
            }

            this.visibleRooms = new Set(this.roomNodes.values());
            this.visibleStandaloneExitNodes = new Set(this.standaloneExitNodes);
            this.updateCullingDebugVisuals({
                mode,
                minX,
                minY,
                maxX,
                maxY,
                searchMinX,
                searchMinY,
                searchMaxX,
                searchMaxY,
            });
            return;
        }

        if (mode === "basic") {
            const nextVisibleRooms = new Set<RoomNodeEntry>();

            this.roomNodes.forEach(entry => {
                const roomMinX = entry.room.x - halfSize;
                const roomMaxX = entry.room.x + halfSize;
                const roomMinY = entry.room.y - halfSize;
                const roomMaxY = entry.room.y + halfSize;

                const isVisible =
                    roomMaxX >= minX &&
                    roomMinX <= maxX &&
                    roomMaxY >= minY &&
                    roomMinY <= maxY;

                if (entry.group.visible() !== isVisible) {
                    entry.group.visible(isVisible);
                    roomLayerNeedsDraw = true;
                }

                entry.linkNodes.forEach(node => {
                    if (node.visible() !== isVisible) {
                        node.visible(isVisible);
                        linkLayerNeedsDraw = true;
                    }
                });

                if (isVisible) {
                    nextVisibleRooms.add(entry);
                }
            });

            const nextVisibleStandaloneExitNodes = new Set<StandaloneExitEntry>();

            this.standaloneExitNodes.forEach(entry => {
                const {node, bounds} = entry;
                const nodeMinX = bounds.x;
                const nodeMaxX = bounds.x + bounds.width;
                const nodeMinY = bounds.y;
                const nodeMaxY = bounds.y + bounds.height;

                const isVisible =
                    nodeMaxX >= minX &&
                    nodeMinX <= maxX &&
                    nodeMaxY >= minY &&
                    nodeMinY <= maxY;

                if (node.visible() !== isVisible) {
                    node.visible(isVisible);
                    linkLayerNeedsDraw = true;
                }

                if (isVisible) {
                    nextVisibleStandaloneExitNodes.add(entry);
                }
            });

            this.visibleRooms = nextVisibleRooms;
            this.visibleStandaloneExitNodes = nextVisibleStandaloneExitNodes;

            if (roomLayerNeedsDraw) {
                this.roomLayer.batchDraw();
            }
            if (linkLayerNeedsDraw) {
                this.linkLayer.batchDraw();
            }

            this.updateCullingDebugVisuals({
                mode,
                minX,
                minY,
                maxX,
                maxY,
                searchMinX,
                searchMinY,
                searchMaxX,
                searchMaxY,
            });
            return;
        }

        const roomDebugBuckets = Settings.cullingDebug ? new Set<string>() : undefined;
        const exitDebugBuckets = Settings.cullingDebug ? new Set<string>() : undefined;
        const roomCandidates = this.collectRoomCandidates(searchMinX, searchMinY, searchMaxX, searchMaxY, roomDebugBuckets);
        const processedRooms = new Set<RoomNodeEntry>();
        const nextVisibleRooms = new Set<RoomNodeEntry>();

        roomCandidates.forEach(entry => {
            processedRooms.add(entry);

            const roomMinX = entry.room.x - halfSize;
            const roomMaxX = entry.room.x + halfSize;
            const roomMinY = entry.room.y - halfSize;
            const roomMaxY = entry.room.y + halfSize;

            const isVisible =
                roomMaxX >= minX &&
                roomMinX <= maxX &&
                roomMaxY >= minY &&
                roomMinY <= maxY;

            if (entry.group.visible() !== isVisible) {
                entry.group.visible(isVisible);
                roomLayerNeedsDraw = true;
            }

            entry.linkNodes.forEach(node => {
                if (node.visible() !== isVisible) {
                    node.visible(isVisible);
                    linkLayerNeedsDraw = true;
                }
            });

            if (isVisible) {
                nextVisibleRooms.add(entry);
            }
        });

        this.visibleRooms.forEach(entry => {
            if (!processedRooms.has(entry)) {
                if (entry.group.visible()) {
                    entry.group.visible(false);
                    roomLayerNeedsDraw = true;
                }
                entry.linkNodes.forEach(node => {
                    if (node.visible()) {
                        node.visible(false);
                        linkLayerNeedsDraw = true;
                    }
                });
            }
        });

        this.visibleRooms = nextVisibleRooms;

        const exitCandidates = this.collectStandaloneExitCandidates(searchMinX, searchMinY, searchMaxX, searchMaxY, exitDebugBuckets);
        const processedExits = new Set<StandaloneExitEntry>();
        const nextVisibleStandaloneExitNodes = new Set<StandaloneExitEntry>();

        exitCandidates.forEach(entry => {
            processedExits.add(entry);

            const {node, bounds} = entry;
            const nodeMinX = bounds.x;
            const nodeMaxX = bounds.x + bounds.width;
            const nodeMinY = bounds.y;
            const nodeMaxY = bounds.y + bounds.height;

            const isVisible =
                nodeMaxX >= minX &&
                nodeMinX <= maxX &&
                nodeMaxY >= minY &&
                nodeMinY <= maxY;

            if (node.visible() !== isVisible) {
                node.visible(isVisible);
                linkLayerNeedsDraw = true;
            }

            if (isVisible) {
                nextVisibleStandaloneExitNodes.add(entry);
            }
        });

        this.visibleStandaloneExitNodes.forEach(entry => {
            const {node} = entry;
            if (!processedExits.has(entry) && node.visible()) {
                node.visible(false);
                linkLayerNeedsDraw = true;
            }
        });

        this.visibleStandaloneExitNodes = nextVisibleStandaloneExitNodes;

        if (roomLayerNeedsDraw) {
            this.roomLayer.batchDraw();
        }
        if (linkLayerNeedsDraw) {
            this.linkLayer.batchDraw();
        }

        this.updateCullingDebugVisuals({
            mode,
            minX,
            minY,
            maxX,
            maxY,
            searchMinX,
            searchMinY,
            searchMaxX,
            searchMaxY,
            roomBuckets: roomDebugBuckets,
            exitBuckets: exitDebugBuckets,
        });
    }

    private updateCullingDebugVisuals({
        mode,
        minX,
        minY,
        maxX,
        maxY,
        searchMinX,
        searchMinY,
        searchMaxX,
        searchMaxY,
        roomBuckets,
        exitBuckets,
    }: {
        mode: CullingMode;
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        searchMinX: number;
        searchMinY: number;
        searchMaxX: number;
        searchMaxY: number;
        roomBuckets?: Set<string>;
        exitBuckets?: Set<string>;
    }) {
        if (!Settings.cullingDebug) {
            if (this.debugLayer.children.length > 0) {
                this.debugLayer.destroyChildren();
                this.debugLayer.batchDraw();
            }
            this.cullingViewportDebug = undefined;
            this.cullingSearchDebug = undefined;
            this.cullingBucketDebug = [];
            return;
        }

        this.debugLayer.destroyChildren();

        const viewportWidth = Math.max(0, maxX - minX);
        const viewportHeight = Math.max(0, maxY - minY);
        const viewportRect = new Konva.Rect({
            x: minX,
            y: minY,
            width: viewportWidth,
            height: viewportHeight,
            stroke: "rgba(102, 255, 204, 0.9)",
            strokeWidth: 0.1,
            dash: [0.4, 0.2],
            listening: false,
        });
        this.debugLayer.add(viewportRect);
        this.cullingViewportDebug = viewportRect;

        const paddingDiffers =
            searchMinX < minX ||
            searchMinY < minY ||
            searchMaxX > maxX ||
            searchMaxY > maxY;

        if (paddingDiffers) {
            const searchRect = new Konva.Rect({
                x: searchMinX,
                y: searchMinY,
                width: Math.max(0, searchMaxX - searchMinX),
                height: Math.max(0, searchMaxY - searchMinY),
                stroke: "rgba(80, 160, 255, 0.75)",
                strokeWidth: 0.08,
                dash: [0.3, 0.15],
                fill: "rgba(80, 160, 255, 0.15)",
                listening: false,
            });
            this.debugLayer.add(searchRect);
            this.cullingSearchDebug = searchRect;
        } else {
            this.cullingSearchDebug = undefined;
        }

        this.cullingBucketDebug = [];
        if (mode === "indexed" && (roomBuckets?.size || exitBuckets?.size)) {
            const bucketStyles = new Map<string, { rooms: boolean; exits: boolean }>();
            roomBuckets?.forEach(key => {
                const existing = bucketStyles.get(key);
                bucketStyles.set(key, { rooms: true, exits: existing?.exits ?? false });
            });
            exitBuckets?.forEach(key => {
                const existing = bucketStyles.get(key);
                bucketStyles.set(key, { rooms: existing?.rooms ?? false, exits: true });
            });

            bucketStyles.forEach(({rooms, exits}, key) => {
                const bounds = this.getBucketBounds(key);
                const fillColor = rooms && exits
                    ? "rgba(255, 196, 102, 0.18)"
                    : rooms
                        ? "rgba(102, 255, 204, 0.18)"
                        : "rgba(255, 196, 102, 0.12)";
                const strokeColor = rooms && exits
                    ? "rgba(255, 196, 102, 0.75)"
                    : rooms
                        ? "rgba(102, 255, 204, 0.8)"
                        : "rgba(255, 196, 102, 0.6)";
                const rect = new Konva.Rect({
                    ...bounds,
                    stroke: strokeColor,
                    strokeWidth: 0.05,
                    fill: fillColor,
                    listening: false,
                });
                this.debugLayer.add(rect);
                this.cullingBucketDebug.push(rect);
            });
        }

        this.debugLayer.batchDraw();
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.overlayLayer.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.currentArea || room.z !== this.currentZIndex) {
            this.overlayLayer.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        const preRoomNodes: Array<Konva.Group | Konva.Shape> = [];

        const explorationArea =
            this.currentAreaInstance instanceof ExplorationArea ? this.currentAreaInstance : undefined;

        if (this.currentAreaInstance && this.currentZIndex !== undefined) {
            const exits = this.currentAreaInstance
                .getLinkExits(this.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const render = Settings.highlightCurrentRoom
                    ? this.exitRenderer.renderWithColor(exit, currentRoomColor, this.currentZIndex!)
                    : this.exitRenderer.render(exit, this.currentZIndex!);
                if (render) {
                    preRoomNodes.push(render);
                }
            });
        }

        const highlightColor = Settings.highlightCurrentRoom ? currentRoomColor : undefined;


        this.exitRenderer.renderSpecialExits(room, highlightColor).forEach(render => {
            preRoomNodes.push(render);
        });

        const stubs = Settings.highlightCurrentRoom
            ? this.exitRenderer.renderStubs(room, currentRoomColor)
            : this.exitRenderer.renderStubs(room);
        stubs.forEach(render => {
            preRoomNodes.push(render);
        });

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.mapReader.getRoom(id);
            const canRenderOtherRoom =
                !explorationArea || explorationArea.hasVisitedRoom(id);

            if (
                otherRoom &&
                otherRoom.area === this.currentArea &&
                otherRoom.z === this.currentZIndex &&
                canRenderOtherRoom) {
                roomsToRedraw.set(id, otherRoom)
            }
        })

        preRoomNodes.forEach(node => {
            this.overlayLayer.add(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayRoom = this.createOverlayRoomGroup(
                roomToRedraw,
                {
                    stroke: isCurrent && Settings.highlightCurrentRoom ? currentRoomColor : Settings.lineColor,
                }
            );
            this.overlayLayer.add(overlayRoom);
            this.currentRoomOverlay.push(overlayRoom);

            this.exitRenderer.renderInnerExits(roomToRedraw).forEach(render => {
                this.overlayLayer.add(render);
                this.currentRoomOverlay.push(render);
            });
        });

        this.overlayLayer.batchDraw();
    }

    private createOverlayRoomGroup(room: MapData.Room, options: {
        stroke: string;
    }) {
        const roomGroup = new Konva.Group({
            x: room.x - Settings.roomSize / 2,
            y: room.y - Settings.roomSize / 2,
            listening: false,
        });

        const rect = new Konva.Rect({
            x: 0,
            y: 0,
            width: Settings.roomSize,
            height: Settings.roomSize,
            fill: this.mapReader.getColorValue(room.env),
            stroke: options.stroke,
            strokeWidth: 0.025,
            strokeEnabled: true
        });

        roomGroup.add(rect);
        this.renderSymbol(room, roomGroup);

        return roomGroup;
    }

    private renderSymbol(room: MapData.Room, roomRender: Konva.Group) {
        if (room.roomChar !== undefined) {
            const roomChar = new Konva.Text({
                x: 0,
                y: 0,
                text: room.roomChar,
                fontSize: 0.45,
                fontStyle: "bold",
                fill: this.mapReader.getSymbolColor(room.env),
                align: "center",
                verticalAlign: "middle",
                width: Settings.roomSize,
                height: Settings.roomSize,
            })
            roomRender.add(roomChar);
        }
    }

    private renderExits(exits: Exit[]) {
        exits.forEach(exit => {
            const render = this.exitRenderer.render(exit, this.currentZIndex!);
            if (!render) {
                return;
            }
            this.linkLayer.add(render);
            const bounds = render.getClientRect({relativeTo: this.linkLayer});
            const entry: StandaloneExitEntry = {node: render, bounds};
            this.standaloneExitNodes.push(entry);
            this.addStandaloneExitToSpatialIndex(entry);
        });

        this.standaloneExitBoundsRoomSize = Settings.roomSize;
    }

    private renderLabels(Labels: MapData.Label[]) {
        Labels.forEach(label => {
            if (Settings.labelRenderMode === "image") {
                if (!label.pixMap) {
                    return;
                }

                const image = new Image();
                image.src = `data:image/png;base64,${label.pixMap}`;
                const labelRender = new Konva.Image({
                    x: label.X,
                    y: -label.Y,
                    width: label.Width,
                    height: label.Height,
                    image: image,
                    listening: false,
                });
                this.linkLayer.add(labelRender);
                return;
            }

            this.renderLabelAsData(label);
        });
    }

    private renderLabelAsData(label: MapData.Label) {
        const labelRender = new Konva.Group({
            listening: false,
        });

        const background = new Konva.Rect({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            listening: false,
        });

        if ((label.BgColor?.alpha ?? 0) > 0 && !Settings.transparentLabels) {
            background.fill(this.getLabelColor(label.BgColor));
        } else {
            background.fillEnabled(false);
        }

        labelRender.add(background);

        const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
        const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

        const text = new Konva.Text({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            text: label.Text,
            fontSize,
            fillEnabled: true,
            fill: this.getLabelColor(label.FgColor),
            align: "center",
            verticalAlign: "middle",
            listening: false,
        });

        labelRender.add(text);

        this.linkLayer.add(labelRender);
    }

    private getLabelColor(color: MapData.Color): string {
        const alpha = (color?.alpha ?? 255) / 255;
        const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
        return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
    }


}