import Exit from "./reader/Exit";
import MapReader from "./reader/MapReader";
import Konva from "konva";

const defaultRoomSize = 0.6;

function move(
    x: number,
    y: number,
    direction?: MapData.direction,
    distance: number = 1
): { x: number; y: number } {
    if (!direction) {
        return {x, y};
    }
    switch (direction) {
        case "north":
            y += distance;
            break;
        case "south":
            y -= distance;
            break;
        case "east":
            x += distance;
            break;
        case "west":
            x -= distance;
            break;
        case "northeast":
            x += distance;
            y += distance;
            break;
        case "northwest":
            x -= distance;
            y += distance;
            break;
        case "southeast":
            x += distance;
            y -= distance;
            break;
        case "southwest":
            x -= distance;
            y -= distance;
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
            //return this.renderOneWayExit(exit);
        }
    }

    private renderTwoWayExit(exit: Exit) {
        const sourceRoom = this.mapReader.getRoom(exit.a)
        const targetRoom = this.mapReader.getRoom(exit.b);

        if (!sourceRoom || !targetRoom) {
            return;
        }
        const points = []
        points.push(...Object.values(move(sourceRoom.x, sourceRoom.y, exit.aDir, defaultRoomSize / 2)));
        points.push(...Object.values(move(targetRoom.x, targetRoom.y, exit.bDir, defaultRoomSize / 2)));
        return new Konva.Line({
            points,
            stroke: '#FFFFFF',
            strokeWidth: 0.025,
        });
    }

    private renderOneWayExit(exit: Exit) {
        const room = this.mapReader.getRoom(exit.a || exit.b)

        if (!room) {
            return;
        }
        const points = []
        points.push(room.x + defaultRoomSize / 2, room.y + defaultRoomSize / 2);
        const target = move(room.x, room.y, exit.aDir || exit.bDir)
        points.push(target.x, target.y);
        console.log(points)
        return new Konva.Line({
            points,
            stroke: '#FFFFFF',
            strokeWidth: 0.025,
            listening: false,
        });
    }
}