import Area from "./Area";
import Plane from "./Plane";
import Exit from "./Exit";

class ExplorationPlane extends Plane {

    private readonly basePlane: Plane;
    private readonly visitedRooms: Set<number>;

    constructor(plane: Plane, visitedRooms: Set<number>) {
        super(plane.getRooms(), plane.getLabels());
        this.basePlane = plane;
        this.visitedRooms = visitedRooms;
    }

    override getRooms() {
        return this.basePlane.getRooms().filter(room => this.visitedRooms.has(room.id));
    }

    override getLabels() {
        return this.basePlane.getLabels();
    }

    override getBounds() {
        const rooms = this.getRooms();
        if (!rooms.length) {
            return this.basePlane.getBounds();
        }
        return rooms.reduce(
            (acc, room) => ({
                minX: Math.min(acc.minX, room.x),
                maxX: Math.max(acc.maxX, room.x),
                minY: Math.min(acc.minY, room.y),
                maxY: Math.max(acc.maxY, room.y),
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

export default class ExplorationArea extends Area {

    private readonly visitedRooms: Set<number>;
    private readonly areaRoomIds: Set<number>;
    private readonly planeCache: WeakMap<Plane, ExplorationPlane> = new WeakMap();

    constructor(area: MapData.Area, visitedRooms?: Iterable<number> | Set<number>) {
        super(area);
        this.visitedRooms = visitedRooms instanceof Set ? visitedRooms : new Set(visitedRooms ?? []);
        this.areaRoomIds = new Set(area.rooms.map(room => room.id));
    }

    override getPlane(zIndex: number) {
        const basePlane = super.getPlane(zIndex);
        if (!basePlane) {
            return basePlane;
        }
        let decorated = this.planeCache.get(basePlane);
        if (!decorated) {
            decorated = new ExplorationPlane(basePlane, this.visitedRooms);
            this.planeCache.set(basePlane, decorated);
        }
        return decorated;
    }

    override getPlanes() {
        return super.getPlanes().map(plane => {
            let decorated = this.planeCache.get(plane);
            if (!decorated) {
                decorated = new ExplorationPlane(plane, this.visitedRooms);
                this.planeCache.set(plane, decorated);
            }
            return decorated;
        });
    }

    override getLinkExits(zIndex: number) {
        return super
            .getLinkExits(zIndex)
            .filter((exit: Exit) => this.visitedRooms.has(exit.a) && this.visitedRooms.has(exit.b));
    }

    getVisitedRoomCount() {
        return super.getRooms().reduce((count, room) => count + (this.visitedRooms.has(room.id) ? 1 : 0), 0);
    }

    getTotalRoomCount() {
        return this.areaRoomIds.size;
    }

    hasVisitedRoom(roomId: number) {
        return this.areaRoomIds.has(roomId) && this.visitedRooms.has(roomId);
    }

    getVisitedRoomIds() {
        return super.getRooms()
            .filter(room => this.visitedRooms.has(room.id))
            .map(room => room.id);
    }

    addVisitedRoom(roomId: number) {
        const wasVisited = this.visitedRooms.has(roomId);
        this.visitedRooms.add(roomId);
        return !wasVisited && this.areaRoomIds.has(roomId);
    }

    addVisitedRooms(roomIds: Iterable<number>) {
        let newlyVisited = 0;
        for (const roomId of roomIds) {
            const wasVisited = this.visitedRooms.has(roomId);
            this.visitedRooms.add(roomId);
            if (!wasVisited && this.areaRoomIds.has(roomId)) {
                newlyVisited++;
            }
        }
        return newlyVisited;
    }

}
