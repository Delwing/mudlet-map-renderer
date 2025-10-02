import Exit from "./reader/Exit";
import MapReader from "./reader/MapReader";
import Konva from "konva";
import {Settings} from "./Renderer";

interface Point {
    x: number;
    y: number;
}

function move(
    x: number,
    y: number,
    direction?: MapData.direction,
    distance: number = 1
): Point {
    if (!direction) {
        return {x, y};
    }
    switch (direction) {
        case "north":
            y -= distance;
            break;
        case "south":
            y += distance;
            break;
        case "east":
            x += distance;
            break;
        case "west":
            x -= distance;
            break;
        case "northeast":
            x += distance;
            y -= distance;
            break;
        case "northwest":
            x -= distance;
            y -= distance;
            break;
        case "southeast":
            x += distance;
            y += distance;
            break;
        case "southwest":
            x -= distance;
            y += distance;
            break;
    }

    return {x, y};
}

export default class ExitRenderer {

    private mapReader: MapReader;

    constructor(mapReader: MapReader) {
        this.mapReader = mapReader;
    }

    render(exit: Exit) {
        if (exit.aDir && exit.bDir) {
            return this.renderTwoWayExit(exit);
        } else {
            return this.renderOneWayExit(exit);
        }
    }

    private renderTwoWayExit(exit: Exit) {
        const sourceRoom = this.mapReader.getRoom(exit.a)
        const targetRoom = this.mapReader.getRoom(exit.b);

        if (!sourceRoom || !targetRoom) {
            return;
        }
        const points = []
        points.push(...Object.values(move(sourceRoom.x, sourceRoom.y, exit.aDir, Settings.roomSize / 2)));
        points.push(...Object.values(move(targetRoom.x, targetRoom.y, exit.bDir, Settings.roomSize / 2)));
        return new Konva.Line({
            points,
            stroke: '#FFFFFF',
            strokeWidth: 0.025,
        });
    }

    private renderOneWayExit(exit: Exit) {
        const sourceRoom = exit.aDir ? this.mapReader.getRoom(exit.a) : this.mapReader.getRoom(exit.b)
        const targetRoom = exit.aDir ? this.mapReader.getRoom(exit.b) : this.mapReader.getRoom(exit.a)
        const dir = exit.aDir ? exit.aDir : exit.bDir;

        if (!sourceRoom || !targetRoom) {
            return;
        }

        let targetPoint = {x: targetRoom.x, y: targetRoom.y};
        if (targetRoom.area !== sourceRoom.area || targetRoom.z !== sourceRoom.z) {
            targetPoint = move(sourceRoom.x, sourceRoom.y, dir, Settings.roomSize / 2);
        }

        const startPoint = move(sourceRoom.x, sourceRoom.y, dir, 0.3);

        const middlePointX = startPoint.x - (sourceRoom.x - targetPoint.x) / 2;
        const middlePointY = startPoint.y - (sourceRoom.y - targetPoint.y) / 2;

        const group = new Konva.Group();
        const points = []
        points.push(...Object.values(move(sourceRoom.x, sourceRoom.y, dir, Settings.roomSize / 2)));
        points.push(targetPoint.x, targetPoint.y);
        const link = new Konva.Line({
            points,
            stroke: '#FFFFFF',
            strokeWidth: 0.025,
            dashEnabled: true,
            dash: [0.1, 0.05],
        });
        group.add(link)

        const arrow = new Konva.Arrow({
            points: [points[0], points[1], middlePointX, middlePointY],
            pointerLength: 0.3,
            pointerWidth: 0.2,
            strokeWidth: 0.035,
            stroke: '#FFFFFF',
            fill: '#FF0000',
            dashEnabled: true,
            dash: [0.1, 0.05],
        })

        group.add(arrow)

        return group;
    }

    renderSpecialExits(room: MapData.Room) {
        return Object.entries(room.customLines).map(([direction, line]) => {
            const points = [room.x, room.y]
            line.points.reduce((acc, point) => {
                acc.push(point.x, -point.y);
                return acc;
            }, points)

            const construct = line.attributes.arrow ? Konva.Arrow : Konva.Line;
            const lineRender =  new construct({
                points: points,
                strokeWidth: .025,
                stroke: `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`,
                fill: `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`,
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
            } else {
                console.log("Brak opisu stylu: " + style);
            }

            return lineRender;
        })
    }
}