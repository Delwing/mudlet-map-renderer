import Plane from "./Plane";

export default class Area {

    private readonly planes: Record<number, Plane> = {};
    private readonly area: MapData.Area;

    constructor(area: MapData.Area) {
        this.area = area;
        this.planes = this.createPlanes();
    }

    getPlane(zIndex: number) {
        return this.planes[zIndex];
    }

    getPlanes() {
        return Object.values(this.planes);
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

}