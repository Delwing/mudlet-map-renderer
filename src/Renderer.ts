import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";
import {
    movePoint,
    PlanarDirection,
    planarDirections,
    oppositeDirections,
} from "./directions";

const defaultRoomSize = 0.6;
const padding = 1;
const defaultZoom = 45
const lineColor = 'rgb(225, 255, 225)';

export class Settings {
    static roomSize = defaultRoomSize;
    static lineColor = lineColor;
}

export class Renderer {

    private readonly stage: Konva.Stage;
    private readonly roomLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly overlayLayer: Konva.Layer;
    private readonly positionLayer: Konva.Layer;
    private mapReader: MapReader;
    private exitRenderer: ExitRenderer;
    private currentArea?: number;
    private currentZIndex?: number;
    private positionRender?: Konva.Circle;
    private currentTransition?: Konva.Tween;
    private paths: Konva.Line[] = [];

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        window.addEventListener('resize', () => {
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

            const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

            this.stage.scale({x: newScale, y: newScale});

            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };
            this.stage.position(newPos);
        });
    }

    drawArea(id: number, zIndex: number) {
        const area = this.mapReader.getArea(id);
        const plane = area?.getPlane(zIndex);
        if (!plane) {
            return;
        }
        this.currentArea = id;
        this.currentZIndex = zIndex;
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();

        const {minX, maxX, minY, maxY} = plane.getBounds();

        this.stage.offset({x: minX - padding, y: minY - padding});
        this.stage.scale({x: defaultZoom, y: defaultZoom});

        this.renderLabels(plane.getLabels());
        this.renderRooms(plane.getRooms() ?? []);
        this.renderExits(area.getLinkExits(zIndex));
    }

    setPosition(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        let instant = false
        if (this.currentArea !== room.area || this.currentZIndex !== room.z) {
            this.drawArea(room.area, room.z);
            instant = true
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
        if (this.currentArea === undefined || this.currentZIndex === undefined) {
            return;
        }

        const rooms = locations
            .map(location => this.mapReader.getRoom(location))
            .filter((room): room is MapData.Room => room !== undefined);

        const segments: number[][] = [];
        let currentSegment: number[] | null = null;

        const finalizeSegment = () => {
            if (!currentSegment) {
                return;
            }
            if (currentSegment.length < 4) {
                segments.pop();
            }
            currentSegment = null;
        };

        const ensureSegment = () => {
            if (!currentSegment) {
                currentSegment = [];
                segments.push(currentSegment);
            }
            return currentSegment;
        };

        rooms.forEach((room, index) => {
            if (!this.isRoomVisible(room)) {
                return;
            }

            const previousRoom = index > 0 ? rooms[index - 1] : undefined;
            const nextRoom = index < rooms.length - 1 ? rooms[index + 1] : undefined;
            const previousVisible = this.isRoomVisible(previousRoom);

            if (!previousVisible) {
                finalizeSegment();
                const segment = ensureSegment();
                if (previousRoom) {
                    const directionToPrevious = this.getDirectionTowards(room, previousRoom);
                    if (directionToPrevious) {
                        const startPoint = movePoint(room.x, room.y, directionToPrevious, Settings.roomSize);
                        segment.push(startPoint.x, startPoint.y);
                    }
                }
            } else {
                ensureSegment();
            }

            currentSegment?.push(room.x, room.y);

            const nextVisible = this.isRoomVisible(nextRoom);
            if (!nextVisible && nextRoom) {
                const directionToNext = this.getDirectionTowards(room, nextRoom);
                if (directionToNext) {
                    const endPoint = movePoint(room.x, room.y, directionToNext, Settings.roomSize);
                    currentSegment?.push(endPoint.x, endPoint.y);
                }
                finalizeSegment();
            }
        });

        finalizeSegment();

        const paths = segments
            .filter(points => points.length >= 4)
            .map(points => new Konva.Line({
                points,
                stroke: 'green',
                strokeWidth: 0.1
            }));

        paths.forEach(path => {
            this.overlayLayer.add(path);
            this.paths.push(path);
        });

        return paths[0];
    }

    clearPaths() {
        this.paths.forEach(path => {
            path.destroy()
        })
        this.paths = []
    }

    private isRoomVisible(room?: MapData.Room) {
        if (!room) {
            return false;
        }
        return room.area === this.currentArea && room.z === this.currentZIndex;
    }

    private getDirectionTowards(from: MapData.Room, to: MapData.Room): PlanarDirection | undefined {
        for (const direction of planarDirections) {
            if (from.exits[direction] === to.id) {
                return direction;
            }
        }

        for (const direction of planarDirections) {
            if (to.exits[direction] === from.id) {
                return oppositeDirections[direction];
            }
        }

        return undefined;
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
            roomRender.on('mouseenter', () => {
                this.stage.container().style.cursor = 'pointer';
            })
            roomRender.on('mouseleave', () => {
                this.stage.container().style.cursor = 'auto';
            })
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