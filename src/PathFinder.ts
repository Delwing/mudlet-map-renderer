import Graph from "node-dijkstra";
import MapReader from "./reader/MapReader";

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

            Object.values(room.exits ?? {}).forEach(targetRoomId => {
                if (this.mapReader.getRoom(targetRoomId)) {
                    connections[targetRoomId.toString()] = 1;
                }
            });

            Object.values(room.specialExits ?? {}).forEach(targetRoomId => {
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

