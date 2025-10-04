import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";
import PathRenderer from "./PathRenderer";

const defaultRoomSize = 0.6;
const padding = 1;
const defaultZoom = 75
const lineColor = 'rgb(225, 255, 225)';

export type RoomContextMenuEventDetail = {
    roomId: number;
    position: { x: number; y: number };
};

export class Settings {
    static roomSize = defaultRoomSize;
    static lineColor = lineColor;
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
    private currentZIndex?: number;
    private currentAreaVersion?: number;
    private positionRender?: Konva.Circle;
    private currentTransition?: Konva.Tween;
    private currentZoom: number = 1;

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        container.addEventListener('resize', () => {
            this.stage.width(container.clientWidth);
            this.stage.height(container.clientHeight);
            this.stage.batchDraw();
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
    }

    private initScaling(scaleBy: number) {
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
            this.setZoom(newZoom);

            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };

            this.stage.position(newPos);
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
        this.currentZIndex = zIndex;
        this.currentAreaVersion = area.getVersion();
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();

        const {minX, maxX, minY, maxY} = plane.getBounds();

        this.stage.offset({x: minX - padding, y: minY - padding});
        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});

        this.renderLabels(plane.getLabels());
        this.renderRooms(plane.getRooms() ?? []);
        this.renderExits(area.getLinkExits(zIndex));
        this.refreshHighlights();
        this.stage.batchDraw();
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

    setZoom(zoom: number) {
        this.currentZoom = zoom;
        this.stage.scale({x: defaultZoom * zoom, y: defaultZoom * zoom});
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
        if (this.currentArea !== room.area || this.currentZIndex !== room.z || (areaVersion !== undefined && this.currentAreaVersion !== areaVersion)) {
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
    }

    renderPath(locations: number[]) {
        return this.pathRenderer.renderPath(locations, this.currentArea, this.currentZIndex);
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

        if (instant) {
            this.stage.position({
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
            })
        } else {
            this.currentTransition = new Konva.Tween({
                node: this.stage,
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
                duration: 0.2,
                easing: Konva.Easings.EaseInOut,
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
                longPressStart = { clientX: touch.clientX, clientY: touch.clientY };
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

            this.exitRenderer.renderSpecialExits(room).forEach(render => {
                this.linkLayer.add(render)
            })
            this.exitRenderer.renderStubs(room).forEach(render => {
                this.linkLayer.add(render)
            })
            this.exitRenderer.renderInnerExits(room).forEach(render => {
                this.roomLayer.add(render)
            })
        })
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