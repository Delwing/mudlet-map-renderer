import Plane from "./Plane";

import Exit from "./Exit";

const regularExits: string[] = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];
const shortToLong: Record<string, string> = {
    n: "north",
    s: "south",
    e: "east",
    w: "west",
    ne: "northeast",
    nw: "northwest",
    se: "southeast",
    sw: "southwest",
}
const longToShort: Record<string, string> = {
    north: "n",
    south: "s",
    east: "e",
    west: "w",
    northeast: "ne",
    northwest: "nw",
    southeast: "se",
    southwest: "sw",
}

export default class Area {

    private readonly planes: Record<number, Plane> = {};
    private readonly area: MapData.Area;
    private readonly exits: Map<string, Exit> = new Map();

    constructor(area: MapData.Area) {
        this.area = area;
        this.planes = this.createPlanes();
        this.createExits();
    }

    getPlane(zIndex: number) {
        return this.planes[zIndex];
    }

    getPlanes() {
        return Object.values(this.planes);
    }

    getLinkExits(zIndex: number) {
        return Array.from(this.exits.values()).filter(e => e.zIndex.includes(zIndex));
    }

    private createPlanes() {
        const grouped = this.area.rooms.reduce<Record<number, MapData.Room[]>>((acc, room) => {
            if (!acc[room.z]) {
                acc[room.z] = [];
            }
            // @ts-ignore
            acc[room.z].push(room);
            return acc;
        }, {});
        return Object.entries(grouped).reduce(
            (acc, [z, rooms]) => {
                acc[+z] = new Plane(rooms);
                return acc;
            },
            {} as Record<number, Plane>
        );
    }

    private createExits() {
        this.area.rooms.forEach(room => {
            Object.entries(room.exits)
                .filter(([direction, _]) => regularExits.indexOf(direction) > -1 && !room.customLines.hasOwnProperty(longToShort[direction]))
                .forEach(([direction, targetRoomId]) => this.createHalfExit(room.id, targetRoomId, room.z, direction as MapData.direction))
        })
    }

    private createHalfExit(originRoom: number, targetRoom: number, zIndex: number, direction: MapData.direction,) {
        const a = Math.min(originRoom, targetRoom);
        const b = Math.max(originRoom, targetRoom);
        const key = `${a}-${b}`;
        let edge = this.exits.get(key);
        if (!edge) {
            edge = {a: a, b: b, zIndex: [zIndex]};
        }
        if (a == originRoom) {
            edge.aDir = direction;
        } else {
            edge.bDir = direction;
        }
        edge.zIndex.push(zIndex);
        this.exits.set(key, edge);
    }

}