import Plane from "./Plane";

import Exit from "./Exit";

export default class Area {

    private readonly planes: Record<number, Plane> = {};
    private readonly area: MapData.Area;
    private readonly exits: Map<string, Exit> = new Map();
    private version = 0;

    constructor(area: MapData.Area) {
        this.area = area;
        this.planes = this.createPlanes();
        this.createExits();
    }

    getAreaName() {
        return this.area.areaName
    }

    getAreaId() {
        return parseInt(this.area.areaId)
    }

    getVersion() {
        return this.version;
    }

    protected markDirty() {
        this.version++;
    }

    getPlane(zIndex: number) {
        return this.planes[zIndex];
    }

    getPlanes() {
        return Object.values(this.planes);
    }

    getRooms() {
        return this.area.rooms
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
                acc[+z] = new Plane(rooms, this.area.labels.filter(label => label.Z === +z));
                return acc;
            },
            {} as Record<number, Plane>
        );
    }

    private createExits() {
        this.area.rooms.forEach(room => {
            Object.entries(room.specialExits)
                .forEach(([direction, targetRoomId]) => this.createHalfExit(room.id, targetRoomId, room.z, direction as MapData.direction))
            Object.entries(room.exits)
                .forEach(([direction, targetRoomId]) => this.createHalfExit(room.id, targetRoomId, room.z, direction as MapData.direction))
        })
    }

    private createHalfExit(originRoom: number, targetRoom: number, zIndex: number, direction: MapData.direction) {
        if (originRoom === targetRoom) {
            return
        }
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