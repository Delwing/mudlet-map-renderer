import Plane, {IPlane} from "./Plane";

import IExit from "./Exit";

const oppositeDir: Partial<Record<MapData.direction, MapData.direction>> = {
    "north": "south", "south": "north",
    "east": "west", "west": "east",
    "northeast": "southwest", "southwest": "northeast",
    "northwest": "southeast", "southeast": "northwest",
    "up": "down", "down": "up",
    "in": "out", "out": "in",
};

/**
 * Pair each room's half-exits into bidirectional {@link IExit}s (or one-way
 * fallbacks when a room's neighbour doesn't exit back). Exposed standalone so
 * callers with an already-filtered room list (e.g. a viewport-narrowed set)
 * can pair exits directly, without constructing a full {@link Area}.
 */
export function pairLinkExits(rooms: MapData.Room[]): Map<string, IExit> {
    type HalfExit = { origin: number, target: number, z: number, dir: MapData.direction };
    const halfExitsByPair = new Map<string, HalfExit[]>();

    rooms.forEach(room => {
        Object.entries(room.exits).forEach(([direction, targetRoomId]) => {
            if (room.id === targetRoomId) return;
            const a = Math.min(room.id, targetRoomId);
            const b = Math.max(room.id, targetRoomId);
            const key = `${a}-${b}`;
            if (!halfExitsByPair.has(key)) halfExitsByPair.set(key, []);
            halfExitsByPair.get(key)!.push({
                origin: room.id, target: targetRoomId, z: room.z, dir: direction as MapData.direction
            });
        });
    });

    const exits = new Map<string, IExit>();
    for (const [pairKey, halves] of halfExitsByPair) {
        const [aStr, bStr] = pairKey.split('-');
        const a = parseInt(aStr), b = parseInt(bStr);

        const aSide = halves.filter(h => h.origin === a);
        const bSide = halves.filter(h => h.origin === b);

        const usedB = new Set<number>();

        for (const aHalf of aSide) {
            let bestIdx = -1;
            for (let i = 0; i < bSide.length; i++) {
                if (usedB.has(i)) continue;
                if (bSide[i].dir === oppositeDir[aHalf.dir]) {
                    bestIdx = i;
                    break;
                }
            }

            if (bestIdx !== -1) {
                usedB.add(bestIdx);
                const bHalf = bSide[bestIdx];
                exits.set(`${pairKey}-${aHalf.dir}`, {
                    a, b, aDir: aHalf.dir, bDir: bHalf.dir, zIndex: [aHalf.z, bHalf.z]
                });
            } else {
                exits.set(`${pairKey}-a:${aHalf.dir}`, {
                    a, b, aDir: aHalf.dir, zIndex: [aHalf.z]
                });
            }
        }

        for (let i = 0; i < bSide.length; i++) {
            if (!usedB.has(i)) {
                const bHalf = bSide[i];
                exits.set(`${pairKey}-b:${bHalf.dir}`, {
                    a, b, bDir: bHalf.dir, zIndex: [bHalf.z]
                });
            }
        }
    }
    return exits;
}

/**
 * Public, renderer-facing surface of an area. The renderer never inspects
 * private state of {@link Area}; it talks to this interface only. Custom data
 * models (e.g. an app that owns its own room store) can satisfy `IArea` and
 * hand the result to {@link MapRenderer} without subclassing.
 *
 * Mutability lives on the concrete implementation: {@link Area.markDirty} is
 * `protected`, kept off the public interface. Consumers signal "redraw me" by
 * bumping {@link getVersion}; the renderer reads the version to decide
 * whether to rebuild.
 */
export interface IArea {
    getAreaName(): string;
    getAreaId(): number;
    /**
     * Monotonically increasing version. The renderer compares the value it
     * cached on the last build against the current value to decide whether
     * the area needs a rebuild.
     */
    getVersion(): number;
    getPlane(zIndex: number): IPlane;
    getPlanes(): IPlane[];
    getZLevels(): number[];
    getRooms(): MapData.Room[];
    getFullBounds(): { minX: number; maxX: number; minY: number; maxY: number };
    /**
     * Inter-room exits drawn on the given z-level. Each exit is bidirectional
     * with optional one-way fallback; see {@link IExit}.
     */
    getLinkExits(zIndex: number): IExit[];
}

export default class Area implements IArea {

    private readonly planes: Record<number, Plane> = {};
    private readonly area: MapData.Area;
    private exits: Map<string, IExit> = new Map();
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

    getZLevels(): number[] {
        return Object.keys(this.planes).map(Number).sort((a, b) => a - b);
    }

    getRooms() {
        return this.area.rooms
    }

    getFullBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        return this.getPlanes().reduce(
            (acc, plane) => {
                const b = plane.getBounds();
                return {
                    minX: Math.min(acc.minX, b.minX),
                    maxX: Math.max(acc.maxX, b.maxX),
                    minY: Math.min(acc.minY, b.minY),
                    maxY: Math.max(acc.maxY, b.maxY),
                };
            },
            { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
        );
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
        this.exits = pairLinkExits(this.area.rooms);
    }

}