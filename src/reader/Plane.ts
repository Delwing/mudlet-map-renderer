export default class Plane {

    private readonly bounds: { minX: number, maxX: number, minY: number, maxY: number }
    private readonly rooms: MapData.Room[] = [];
    private readonly labels: MapData.Label[] = [];

    constructor(rooms: MapData.Room[], labels: MapData.Label[]) {
        this.rooms = rooms;
        this.labels = labels;
        this.bounds = this.createBounds();
    }

    getRooms() {
        return this.rooms;
    }

    getLabels() {
        return this.labels;
    }

    getBounds() {
        return this.bounds;
    }

    private createBounds() {
        const b = this.rooms.reduce(
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
        for (const label of this.labels) {
            const lx = label.X;
            const ly = -label.Y;
            b.minX = Math.min(b.minX, lx);
            b.maxX = Math.max(b.maxX, lx + label.Width);
            b.minY = Math.min(b.minY, ly);
            b.maxY = Math.max(b.maxY, ly + label.Height);
        }
        return b;
    }

}