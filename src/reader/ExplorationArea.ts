import Area, {IArea} from "./Area";
import Plane from "./Plane";
import IExit from "./Exit";

/**
 * Public, renderer-facing surface for an area decorated with fog-of-war
 * (i.e. exploration) state. `IExplorationArea` is what the renderer sees when
 * exploration is enabled — it is structurally an {@link IArea} plus the
 * visited-room read/write operations needed for the renderer to filter
 * unvisited rooms and exits.
 */
export interface IExplorationArea extends IArea {
    getVisitedRoomCount(): number;
    getTotalRoomCount(): number;
    hasVisitedRoom(roomId: number): boolean;
    getVisitedRoomIds(): number[];
    addVisitedRoom(roomId: number): boolean;
    addVisitedRooms(roomIds: Iterable<number>): number;
}

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
        return this.basePlane.getBounds();
    }

}

export default class ExplorationArea extends Area implements IExplorationArea {

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
            .filter((exit: IExit) => this.visitedRooms.has(exit.a) || this.visitedRooms.has(exit.b));
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
        const newlyVisited = !wasVisited && this.areaRoomIds.has(roomId);
        if (newlyVisited) {
            this.markDirty();
        }
        return newlyVisited;
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
        if (newlyVisited > 0) {
            this.markDirty();
        }
        return newlyVisited;
    }

}
