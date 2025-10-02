import Exit from "./Exit";

export default class Plane {

    private readonly bounds: { minX: number, maxX: number, minY: number, maxY: number }
    private readonly exits: Map<string, Exit> = new Map();
    private readonly rooms: MapData.Room[] = [];

    constructor(rooms: MapData.Room[]) {
        this.rooms = rooms
        this.bounds = this.createBounds();
        this.createExits();
    }

    getRooms() {
        return this.rooms;
    }

    getExits() {
        return Array.from(this.exits.values());
    }

    getBounds() {
        return this.bounds;
    }

    private createExits() {
        this.rooms.forEach(room => {
            Object.entries(room.exits).forEach(([direction, targetRoomId]) => this.createHalfExit(room.id, targetRoomId, direction as MapData.direction))
        })
    }

    private createHalfExit(originRoom: number, targetRoom: number, direction: MapData.direction,) {
        const a = Math.min(originRoom, targetRoom);
        const b = Math.max(originRoom, targetRoom);
        const key = `${a}-${b}`;
        let edge = this.exits.get(key);
        if (!edge) {
            edge = {a: originRoom, b: targetRoom};
        }
        if (a == originRoom) {
            edge.aDir = direction;
        } else {
            edge.bDir = direction;
        }
        this.exits.set(key, edge);
    }

    private createBounds() {
        return this.rooms.reduce(
            (acc, r) => ({
                minX: Math.min(acc.minX, r.x),
                maxX: Math.max(acc.maxX, r.x),
                minY: Math.min(acc.minY, r.y),
                maxY: Math.max(acc.maxY, r.y),
            }),
            {
                minX: Number.POSITIVE_INFINITY,
                maxX: Number.NEGATIVE_INFINITY,
                minY: Number.POSITIVE_INFINITY,
                maxY: Number.NEGATIVE_INFINITY,
            }
        );
    }

}