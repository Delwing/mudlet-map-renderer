import Exit, {longToShort} from "./reader/Exit";
import MapReader from "./reader/MapReader";
import Konva from "konva";
import {Settings} from "./Renderer";
import {movePoint} from "./directions";

const Colors = {
    OPEN_DOOR: 'rgb(10, 155, 10)',
    CLOSED_DOOR: 'rgb(226, 205, 59)',
    LOCKED_DOOR: 'rgb(155, 10, 10)'
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

    constructor(mapReader: MapReader) {
        this.mapReader = mapReader;
    }

    render(exit: Exit) {
        return this.renderWithColor(exit, Settings.lineColor);
    }

    renderWithColor(exit: Exit, color: string) {
        if (exit.aDir && exit.bDir) {
            return this.renderTwoWayExit(exit, color);
        } else {
            return this.renderOneWayExit(exit, color);
        }
    }

    private renderTwoWayExit(exit: Exit, color: string) {
        const sourceRoom = this.mapReader.getRoom(exit.a)
        const targetRoom = this.mapReader.getRoom(exit.b);

        if (!sourceRoom || !targetRoom || !exit.aDir || !exit.bDir) {
            return;
        }

        const exitRender = new Konva.Group();

        const points = []
        points.push(...Object.values(movePoint(sourceRoom.x, sourceRoom.y, exit.aDir, Settings.roomSize / 2)));
        points.push(...Object.values(movePoint(targetRoom.x, targetRoom.y, exit.bDir, Settings.roomSize / 2)));

        if (sourceRoom.doors[longToShort[exit.aDir]] || targetRoom.doors[longToShort[exit.bDir]]) {
            const door = this.renderDoor(points, sourceRoom.doors[longToShort[exit.aDir]] ?? targetRoom.doors[longToShort[exit.bDir]], color)
            exitRender.add(door);
        }

        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: 0.025,
        });
        exitRender.add(link);

        return exitRender;
    }

    private renderOneWayExit(exit: Exit, color: string) {
        const sourceRoom = exit.aDir ? this.mapReader.getRoom(exit.a) : this.mapReader.getRoom(exit.b)
        const targetRoom = exit.aDir ? this.mapReader.getRoom(exit.b) : this.mapReader.getRoom(exit.a)
        const dir = exit.aDir ? exit.aDir : exit.bDir;

        if (!sourceRoom || !targetRoom) {
            return;
        }

        if (sourceRoom.area != targetRoom.area && dir) {
            return this.renderAreaExit(sourceRoom, dir, color);
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
        points.push(...Object.values(movePoint(sourceRoom.x, sourceRoom.y, dir, Settings.roomSize / 2)));
        points.push(targetPoint.x, targetPoint.y);
        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: 0.025,
            dashEnabled: true,
            dash: [0.1, 0.05],
        });
        group.add(link)

        const arrow = new Konva.Arrow({
            points: [points[0], points[1], middlePointX, middlePointY],
            pointerLength: 0.5,
            pointerWidth: 0.35,
            strokeWidth: 0.035,
            stroke: color,
            fill: color,
            dashEnabled: true,
            dash: [0.1, 0.05],
        })

        group.add(arrow)

        return group;
    }

    renderAreaExit(room: MapData.Room, dir: MapData.direction, color?: string) {
        const start = movePoint(room.x, room.y, dir, Settings.roomSize / 2)
        const end = movePoint(room.x, room.y, dir, Settings.roomSize * 1.5)
        const stroke = color ?? this.mapReader.getColorValue(room.env);
        return new Konva.Arrow({
            points: [start.x, start.y, end.x, end.y],
            pointerLength: 0.3,
            pointerWidth: 0.3,
            strokeWidth: 0.035,
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
                strokeWidth: .025,
                stroke: strokeColor,
                fill: overrideColor ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g} , ${line.attributes.color.b})`,
                pointerLength: 0.3,
                pointerWidth: 0.2,

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
            const start = movePoint(room.x, room.y, direction, Settings.roomSize / 2)
            const end = movePoint(room.x, room.y, direction, Settings.roomSize / 2 + 0.5)
            const points = [start.x, start.y, end.x, end.y]
            return new Konva.Line({
                points,
                stroke: color,
                strokeWidth: 0.025,
            });
        })
    }

    renderInnerExits(room: MapData.Room, color?: string) {
        return innerExits.map(exit => {
            if (room.exits[exit]) {
                const render = new Konva.Group();
                const triangle = new Konva.RegularPolygon({
                    x: room.x,
                    y: room.y,
                    sides: 3,
                    fill: color ? this.mapReader.getSymbolColor(room.env, 0.2) : this.mapReader.getSymbolColor(room.env, 0.6),
                    stroke: color ?? this.mapReader.getSymbolColor(room.env),
                    strokeWidth: 0.025,
                    radius: Settings.roomSize / 5,
                    scaleX: 1.4,
                    scaleY: 0.8
                })
                render.add(triangle);

                let doorType = room.doors[exit];
                if (doorType !== undefined) {
                    if (color) {
                        triangle.stroke(color);
                    } else {
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

    renderDoor(points: number[], type: 1 | 2 | 3, color?: string) {
        const point = {
            x: points[0] + (points[2] - points[0]) / 2,
            y: points[1] + (points[3] - points[1]) / 2,
        }
        return new Konva.Rect({
            x: point.x - Settings.roomSize / 4,
            y: point.y - Settings.roomSize / 4,
            width: Settings.roomSize / 2,
            height: Settings.roomSize / 2,
            stroke: color ?? getDoorColor(type),
            strokeWidth: 0.025
        })
    }

}