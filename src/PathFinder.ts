import Graph from "node-dijkstra";
import MapReader from "./reader/MapReader";

const exitNumberToDirection: Record<number, MapData.direction> = {
    1: "north",
    2: "northeast",
    3: "northwest",
    4: "east",
    5: "west",
    6: "south",
    7: "southeast",
    8: "southwest",
    9: "up",
    10: "down",
    11: "in",
    12: "out",
};

type GraphDefinition = Record<string, Record<string, number>>;

export default class PathFinder {

    private readonly mapReader: MapReader;
    private readonly graph: Graph;
    private readonly cache = new Map<string, Array<number> | null>();

    constructor(mapReader: MapReader) {
        this.mapReader = mapReader;
        this.graph = this.buildGraph();
    }

    private buildGraph(): Graph {
        const graphDefinition: GraphDefinition = {};
        this.mapReader.getRooms().forEach(room => {
            const connections: Record<string, number> = {};

            const lockedDirections = new Set(
                (room.exitLocks ?? [])
                    .map(lockId => exitNumberToDirection[lockId])
                    .filter((direction): direction is MapData.direction => Boolean(direction))
            );

            const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

            Object.entries(room.exits ?? {}).forEach(([direction, targetRoomId]) => {
                if (lockedDirections.has(direction as MapData.direction)) {
                    return;
                }
                if (this.mapReader.getRoom(targetRoomId)) {
                    connections[targetRoomId.toString()] = 1;
                }
            });

            Object.values(room.specialExits ?? {}).forEach(targetRoomId => {
                if (lockedSpecialTargets.has(targetRoomId)) {
                    return;
                }
                if (this.mapReader.getRoom(targetRoomId)) {
                    connections[targetRoomId.toString()] = 1;
                }
            });

            graphDefinition[room.id.toString()] = connections;
        });

        return new Graph(graphDefinition);
    }

    findPath(from: number, to: number): Array<number> | null {
        const cacheKey = `${from}->${to}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        if (from === to) {
            const result = this.mapReader.getRoom(from) ? [from] : null;
            this.cache.set(cacheKey, result);
            return result;
        }

        if (!this.mapReader.getRoom(from) || !this.mapReader.getRoom(to)) {
            this.cache.set(cacheKey, null);
            return null;
        }

        const path = this.graph.path(from.toString(), to.toString());
        const nodes = Array.isArray(path) ? path : path?.path;
        const result = nodes ? nodes.map((id: string) => Number(id)) : null;
        this.cache.set(cacheKey, result);
        return result;
    }
}

