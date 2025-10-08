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
    static cullingBounds: { x: number; y: number; width: number; height: number } | null = null;
}

type HighlightData = {
    color: string;
    area: number;
    z: number;
    shape?: Konva.Circle;
};

export class Renderer {

    private readonly stage: Konva.Stage;
    private readonly roomLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly overlayLayer: Konva.Layer;
    private readonly positionLayer: Konva.Layer;
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
    private roomNodes: Map<number, {room: MapData.Room; group: Konva.Group; linkNodes: Konva.Node[]}> = new Map();
    private standaloneExitNodes: Konva.Node[] = [];
    private cullingScheduled = false;

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
        this.positionLayer = new Konva.Layer({
            listening: false,
        });
        this.stage.add(this.positionLayer);
        this.mapReader = mapReader;
        this.exitRenderer = new ExitRenderer(mapReader);
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
        this.roomNodes.clear();
        this.standaloneExitNodes = [];

        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});

        this.renderLabels(plane.getLabels());
        this.renderExits(area.getLinkExits(zIndex));
        this.renderRooms(plane.getRooms() ?? []);
        this.refreshHighlights();
        this.stage.batchDraw();
        this.scheduleRoomCulling();
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

            this.roomNodes.set(room.id, {room, group: roomRender, linkNodes});
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

        if (!Settings.cullingEnabled) {
            this.roomNodes.forEach(({group, linkNodes}) => {
                if (!group.visible()) {
                    group.visible(true);
                    roomLayerNeedsDraw = true;
                }
                linkNodes.forEach(node => {
                    if (!node.visible()) {
                        node.visible(true);
                        linkLayerNeedsDraw = true;
                    }
                });
            });

            this.standaloneExitNodes.forEach(node => {
                if (!node.visible()) {
                    node.visible(true);
                    linkLayerNeedsDraw = true;
                }
            });

            if (roomLayerNeedsDraw) {
                this.roomLayer.batchDraw();
            }
            if (linkLayerNeedsDraw) {
                this.linkLayer.batchDraw();
            }
            return;
        }

        this.roomNodes.forEach(({room, group, linkNodes}) => {
            const roomMinX = room.x - halfSize;
            const roomMaxX = room.x + halfSize;
            const roomMinY = room.y - halfSize;
            const roomMaxY = room.y + halfSize;

            const isVisible =
                roomMaxX >= minX &&
                roomMinX <= maxX &&
                roomMaxY >= minY &&
                roomMinY <= maxY;

            if (group.visible() !== isVisible) {
                group.visible(isVisible);
                roomLayerNeedsDraw = true;
            }

            linkNodes.forEach(node => {
                if (node.visible() !== isVisible) {
                    node.visible(isVisible);
                    linkLayerNeedsDraw = true;
                }
            });
        });

        this.standaloneExitNodes.forEach(node => {
            const rect = node.getClientRect({relativeTo: this.linkLayer});
            const nodeMinX = rect.x;
            const nodeMaxX = rect.x + rect.width;
            const nodeMinY = rect.y;
            const nodeMaxY = rect.y + rect.height;

            const isVisible =
                nodeMaxX >= minX &&
                nodeMinX <= maxX &&
                nodeMaxY >= minY &&
                nodeMinY <= maxY;

            if (node.visible() !== isVisible) {
                node.visible(isVisible);
                linkLayerNeedsDraw = true;
            }
        });

        if (roomLayerNeedsDraw) {
            this.roomLayer.batchDraw();
        }
        if (linkLayerNeedsDraw) {
            this.linkLayer.batchDraw();
        }
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
                    ? this.exitRenderer.renderWithColor(exit, currentRoomColor)
                    : this.exitRenderer.render(exit);
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
                    fillEnabled: true,
                    strokeEnabled: isCurrent ? Settings.highlightCurrentRoom : false,
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
        fillEnabled: boolean;
        strokeEnabled: boolean
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
            strokeEnabled: options.strokeEnabled,
        });

        if (!options.fillEnabled) {
            rect.fillEnabled(false);
        }

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
            const render = this.exitRenderer.render(exit);
            if (!render) {
                return;
            }
            this.linkLayer.add(render);
            this.standaloneExitNodes.push(render);
        })

    }

    private renderLabels(Labels: MapData.Label[]) {
        Labels.forEach(label => {
            if (!label.pixMap) {
                return
            }
            const image = new Image()
            image.src = `data:image/png;base64,${label.pixMap}`
            const labelRender = new Konva.Image({
                x: label.X,
                y: -label.Y,
                width: label.Width,
                height: label.Height,
                image: image
            })
            this.linkLayer.add(labelRender)
        })
    }


}