import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";

const defaultRoomSize = 0.6;
const padding = 1;
const defaultZoom = 35

export class Renderer {

    private stage: Konva.Stage;
    private roomLayer: Konva.Layer;
    private linkLayer: Konva.Layer;
    private positionLayer: Konva.Layer;
    private mapReader: MapReader;
    private exitRenderer: ExitRenderer;
    private currentArea?: number;
    private currentZIndex?: number;

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        this.linkLayer = new Konva.Layer({
            listening: false,
        });
        this.stage.add(this.linkLayer);
        this.roomLayer = new Konva.Layer();
        this.stage.add(this.roomLayer);
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

            this.stage.scale({x: newScale, y: -newScale});

            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };
            this.stage.position(newPos);
        });
    }

    drawArea(id: number, zIndex: number) {
        const plane = this.mapReader.getArea(id)?.getPlane(zIndex);
        if (!plane) {
            return;
        }
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();

        const { minX, maxX, minY, maxY } = plane.getBounds();

        this.stage.offset({ x: minX - padding, y: maxY + padding });
        this.stage.scale({ x: defaultZoom, y: -defaultZoom });

        this.renderRooms(plane.getRooms() ?? []);
        this.renderExits(plane.getExits());
    }

    setPosition(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        if (this.currentArea !== room.area || this.currentZIndex !== room.z) {
            this.drawArea(room.area, room.z);
        }
        this.positionLayer.destroyChildren();
        const positionRender = new Konva.Circle({
            x: room.x,
            y: room.y,
            radius: 0.2,
            fill: 'black',
        })
        this.positionLayer.add(positionRender);
        this.centerOnRoom(room);
    }

    private centerOnRoom(room: MapData.Room) {
        const roomCenter = {x: room.x, y: room.y};

        const abs = this.stage.getAbsoluteTransform()
        const screenPoint = abs.point(roomCenter);

        const target = {
            x: this.stage.width() / 2,
            y: this.stage.height() / 2,
        };

        const dx = target.x - screenPoint.x;
        const dy = target.y - screenPoint.y;

        // Animate the pan
        this.stage.to({
            x: this.stage.x() + dx,
            y: this.stage.y() + dy,
            duration: 0.3,
            easing: Konva.Easings.EaseInOut,
        });
    }

    private renderRooms(rooms: MapData.Room[]) {
        rooms.forEach(room => {
            const roomRender = new Konva.Group({
                x: room.x - defaultRoomSize / 2,
                y: room.y - defaultRoomSize / 2,
            });
            const roomRect = new Konva.Rect({
                x: 0,
                y: 0,
                width: defaultRoomSize,
                height: defaultRoomSize,
                fill: this.mapReader.getColorValue(room.env),
                strokeWidth: 0.025,
                stroke: "#FFFFFF"
            });
            roomRender.on('click', () => {
                roomRect.fill('red');
            })
            roomRender.add(roomRect);
            this.roomLayer.add(roomRender);
        })
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


}