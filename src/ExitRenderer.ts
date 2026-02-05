import Exit, {longToShort, regularExits} from "./reader/Exit";
import MapReader from "./reader/MapReader";
import Konva from "konva";
import {Renderer, Settings} from "./Renderer";
import {movePoint, movePointCircle, movePointRoundedRect} from "./directions";

const Colors = {
    OPEN_DOOR: 'rgb(10, 155, 10)',
    CLOSED_DOOR: 'rgb(226, 205, 59)',
    LOCKED_DOOR: 'rgb(155, 10, 10)',
    ONE_WAY_FILL: 'rgb(155, 10, 10)'
}

const dirNumbers: Record<number, MapData.direction> = {
    1: "north",
    2: "northeast",
    3: "northwest",
    4: "east",
    5: "west",
    6: "south",
    7: "southeast",
    8: "southwest",
    9: "up",
    10: "down",
    11: "in",
    12: "out",
};

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

function getDoorColor(doorType: 1 | 2 | 3) {
    switch (doorType) {
        case 1:
            return Colors.OPEN_DOOR
        case 2:
            return Colors.CLOSED_DOOR
        default:
            return Colors.LOCKED_DOOR
    }
}

export default class ExitRenderer {

    private mapReader: MapReader;
    private mapRenderer: Renderer;

    constructor(mapReader: MapReader, mapRenderer: Renderer) {
        this.mapReader = mapReader;
        this.mapRenderer = mapRenderer;
    }

    /**
     * Get the edge point of a room based on its shape
     */
    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        if (Settings.roomShape === "circle") {
            return movePointCircle(x, y, direction, distance);
        } else if (Settings.roomShape === "roundedRectangle") {
            return movePointRoundedRect(x, y, direction, distance, Settings.roomSize * 0.2);
        } else {
            return movePoint(x, y, direction, distance);
        }
    }

    render(exit: Exit, zIndex: number) {
        return this.renderWithColor(exit, Settings.lineColor, zIndex);
    }

    renderWithColor(exit: Exit, color: string, zIndex: number) {
        const aIsRegular = exit.aDir && regularExits.includes(exit.aDir);
        const bIsRegular = exit.bDir && regularExits.includes(exit.bDir);

        if (aIsRegular && bIsRegular) {
            return this.renderTwoWayExit(exit, color, zIndex);
        } else if (aIsRegular || bIsRegular) {
            const regularDir = aIsRegular ? 'a' : 'b';
            return this.renderOneWayExit(exit, color, regularDir);
        }
        return;
    }

    private renderTwoWayExit(exit: Exit, color: string, zIndex: number) {
        const sourceRoom = this.mapReader.getRoom(exit.a)
        const targetRoom = this.mapReader.getRoom(exit.b);

        if (!sourceRoom || !targetRoom || !exit.aDir || !exit.bDir) {
            return;
        }

        if (sourceRoom.customLines[longToShort[exit.aDir]] && targetRoom.customLines[longToShort[exit.bDir]]) {
            return
        }

        if (sourceRoom.z !== targetRoom.z) {
            if (zIndex !== targetRoom.z && sourceRoom.customLines[longToShort[exit.aDir]]) {
                return
            }
            if (zIndex !== sourceRoom.z && targetRoom.customLines[longToShort[exit.bDir]]) {
                return
            }
        }

        const exitRender = new Konva.Group();

        const points = []
        points.push(...Object.values(this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, exit.aDir, Settings.roomSize / 2)));
        points.push(...Object.values(this.getRoomEdgePoint(targetRoom.x, targetRoom.y, exit.bDir, Settings.roomSize / 2)));

        if (sourceRoom.doors[longToShort[exit.aDir]] || targetRoom.doors[longToShort[exit.bDir]]) {
            const door = this.renderDoor(points, sourceRoom.doors[longToShort[exit.aDir]] ?? targetRoom.doors[longToShort[exit.bDir]])
            exitRender.add(door);
        }

        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: Settings.lineWidth,
            perfectDrawEnabled: false,
        });
        exitRender.add(link);

        return exitRender;
    }

    private renderOneWayExit(exit: Exit, color: string, fromSide?: 'a' | 'b') {
        // Determine which side is the source based on fromSide parameter or which dir exists
        const useA = fromSide === 'a' || (!fromSide && exit.aDir);
        const sourceRoom = useA ? this.mapReader.getRoom(exit.a) : this.mapReader.getRoom(exit.b);
        const targetRoom = useA ? this.mapReader.getRoom(exit.b) : this.mapReader.getRoom(exit.a);
        const dir = useA ? exit.aDir : exit.bDir;

        if (!dir || !sourceRoom || !targetRoom || !regularExits.includes(dir) || sourceRoom.customLines[longToShort[dir] || dir]) {
            return;
        }

        if (sourceRoom.area != targetRoom.area && dir) {
            const targetEnvColor = this.mapReader.getColorValue(targetRoom.env);
            return this.renderAreaExit(sourceRoom, dir, targetEnvColor);
        }

        let targetPoint = {x: targetRoom.x, y: targetRoom.y};
        if (targetRoom.area !== sourceRoom.area || targetRoom.z !== sourceRoom.z) {
            targetPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, Settings.roomSize / 2);
        }

        const startPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, 0.3);

        const middlePointX = startPoint.x - (startPoint.x - targetPoint.x) / 2;
        const middlePointY = startPoint.y - (startPoint.y - targetPoint.y) / 2;

        const group = new Konva.Group();
        const points = []
        points.push(...Object.values(this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, dir, Settings.roomSize / 2)));
        points.push(targetPoint.x, targetPoint.y);
        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: Settings.lineWidth,
            dashEnabled: true,
            dash: [0.1, 0.05],
            perfectDrawEnabled: false,
        });
        group.add(link)

        const arrow = new Konva.Arrow({
            points: [points[0], points[1], middlePointX, middlePointY],
            pointerLength: 0.5,
            pointerWidth: 0.35,
            strokeWidth: Settings.lineWidth * 1.4,
            stroke: color,
            fill: Colors.ONE_WAY_FILL,
            dashEnabled: true,
            dash: [0.1, 0.05],
        })

        group.add(arrow)

        return group;
    }

    renderAreaExit(room: MapData.Room, dir: MapData.direction, color?: string) {
        const start = this.getRoomEdgePoint(room.x, room.y, dir, Settings.roomSize / 2)
        const end = movePoint(room.x, room.y, dir, Settings.roomSize * 1.5)
        const stroke = color ?? this.mapReader.getColorValue(room.env);
        return new Konva.Arrow({
            points: [start.x, start.y, end.x, end.y],
            pointerLength: 0.3,
            pointerWidth: 0.3,
            strokeWidth: Settings.lineWidth * 1.4,
            stroke,
            fill: stroke,
        })
    }

    renderSpecialExits(room: MapData.Room, overrideColor?: string) {
        return Object.entries(room.customLines).map(([_, line]) => {
            const points = [room.x, room.y]
            line.points.reduce((acc, point) => {
                acc.push(point.x, -point.y);
                return acc;
            }, points)

            const construct = line.attributes.arrow ? Konva.Arrow : Konva.Line;
            const strokeColor = overrideColor ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`;
            const lineRender = new construct({
                points: points,
                strokeWidth: Settings.lineWidth,
                stroke: strokeColor,
                fill: overrideColor ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g} , ${line.attributes.color.b})`,
                pointerLength: 0.3,
                pointerWidth: 0.2,
                perfectDrawEnabled: false,

            })

            let style = line.attributes.style;
            if (style === "dot line") {
                lineRender.dash([0.05, 0.05])
                lineRender.dashOffset(0.1)
            } else if (style === "dash line") {
                lineRender.dash([0.4, 0.2])
            } else if (style === "solid line") {
            } else if (style !== undefined) {
                console.log("Brak opisu stylu: " + style);
            }

            return lineRender;
        })
    }

    renderStubs(room: MapData.Room, color: string = Settings.lineColor) {
        return room.stubs.map(stub => {
            const direction = dirNumbers[stub];
            const start = this.getRoomEdgePoint(room.x, room.y, direction, Settings.roomSize / 2)
            const end = movePoint(room.x, room.y, direction, Settings.roomSize / 2 + 0.5)
            const points = [start.x, start.y, end.x, end.y]
            return new Konva.Line({
                points,
                stroke: color,
                strokeWidth: Settings.lineWidth,
            });
        })
    }

    renderInnerExits(room: MapData.Room) {
        return innerExits.map(exit => {
            if (room.exits[exit]) {
                const render = new Konva.Group();
                const triangle = new Konva.RegularPolygon({
                    x: room.x,
                    y: room.y,
                    sides: 3,
                    fill: this.mapReader.getSymbolColor(room.env, 0.6),
                    stroke: this.mapReader.getSymbolColor(room.env),
                    strokeWidth: Settings.lineWidth,
                    radius: Settings.roomSize / 5,
                    scaleX: 1.4,
                    scaleY: 0.8,
                    perfectDrawEnabled: false,
                })
                render.add(triangle);

                let doorType = room.doors[exit];
                if (doorType !== undefined) {
                    switch (doorType) {
                        case 1:
                            triangle.stroke(Colors.OPEN_DOOR)
                            break;
                        case 2:
                            triangle.stroke(Colors.CLOSED_DOOR);
                            break;
                        default:
                            triangle.stroke(Colors.LOCKED_DOOR);
                    }
                }

                switch (exit) {
                    case "up":
                        triangle.position(movePoint(room.x, room.y, "south", Settings.roomSize / 4));
                        break;
                    case "down":
                        triangle.rotation(180);
                        triangle.position(movePoint(room.x, room.y, "north", Settings.roomSize / 4));
                        break;
                    case "in":
                        const inRender = triangle.clone()
                        inRender.rotation(-90);
                        inRender.position(movePoint(room.x, room.y, "east", Settings.roomSize / 4));
                        render.add(inRender);
                        triangle.rotation(90);
                        triangle.position(movePoint(room.x, room.y, "west", Settings.roomSize / 4));
                        break;
                    case "out":
                        const outRender = triangle.clone()
                        outRender.rotation(90);
                        outRender.position(movePoint(room.x, room.y, "east", Settings.roomSize / 4));
                        render.add(outRender);
                        triangle.rotation(-90);
                        triangle.position(movePoint(room.x, room.y, "west", Settings.roomSize / 4));
                        break;
                }
                return render
            }
        }).filter(e => e !== undefined)
    }

    renderDoor(points: number[], type: 1 | 2 | 3) {
        const point = {
            x: points[0] + (points[2] - points[0]) / 2,
            y: points[1] + (points[3] - points[1]) / 2,
        }
        return new Konva.Rect({
            x: point.x - Settings.roomSize / 4,
            y: point.y - Settings.roomSize / 4,
            width: Settings.roomSize / 2,
            height: Settings.roomSize / 2,
            stroke: getDoorColor(type),
            strokeWidth: Settings.lineWidth
        })
    }

}