

export default class Plane {

    private readonly bounds: { minX: number, maxX: number, minY: number, maxY: number }
    private readonly rooms: MapData.Room[] = [];

    constructor(rooms: MapData.Room[]) {
        this.rooms = rooms
        this.bounds = this.createBounds();
    }

    getRooms() {
        return this.rooms;
    }

    getBounds() {
        return this.bounds;
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