import type {IMapReader} from "./reader/MapReader";

const exitNumberToDirection: Record<number, MapData.direction> = {
    1: "north", 2: "northeast", 3: "northwest", 4: "east", 5: "west",
    6: "south", 7: "southeast", 8: "southwest", 9: "up", 10: "down",
    11: "in", 12: "out",
};

const directionToExitWeightKey: Record<MapData.direction, string> = {
    north: "n", northeast: "ne", northwest: "nw",
    east: "e", west: "w",
    south: "s", southeast: "se", southwest: "sw",
    up: "up", down: "down", in: "in", out: "out",
};

export interface Edge {
    id: number;
    weight: number;
}

export interface GraphData {
    adj: Map<number, Edge[]>;
    /** For node-dijkstra library */
    graphDefinition: Record<string, Record<string, number>>;
    maxEdgeDistance: number;
    minEdgeWeight: number;
}

/**
 * Builds a weighted adjacency graph from MapReader room/exit data.
 * Separated from PathFinder so the graph can be reused and tested independently.
 */
export class MapGraph {

    private readonly mapReader: IMapReader;
    private readonly data: GraphData;

    constructor(mapReader: IMapReader) {
        this.mapReader = mapReader;
        this.data = this.buildGraph();
    }

    getAdj(): Map<number, Edge[]> {
        return this.data.adj;
    }

    getGraphDefinition(): Record<string, Record<string, number>> {
        return this.data.graphDefinition;
    }

    getMaxEdgeDistance(): number {
        return this.data.maxEdgeDistance;
    }

    getMinEdgeWeight(): number {
        return this.data.minEdgeWeight;
    }

    getRoom(roomId: number) {
        return this.mapReader.getRoom(roomId);
    }

    private resolveEdgeWeight(room: MapData.Room, exitWeightKey: string, target: MapData.Room): number {
        const exitWeight = room.exitWeights?.[exitWeightKey];
        if (exitWeight !== undefined && exitWeight > 0) return exitWeight;
        return Math.max(target.weight, 1);
    }

    private buildGraph(): GraphData {
        const adj = new Map<number, Edge[]>();
        const graphDefinition: Record<string, Record<string, number>> = {};
        let maxEdgeDist = 1;
        let minEdgeWeight = Infinity;

        this.mapReader.getRooms().forEach(room => {
            const edges: Edge[] = [];
            const connections: Record<string, number> = {};

            const lockedDirections = new Set(
                (room.exitLocks ?? [])
                    .map(lockId => exitNumberToDirection[lockId])
                    .filter((direction): direction is MapData.direction => Boolean(direction))
            );

            const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

            Object.entries(room.exits ?? {}).forEach(([direction, targetRoomId]) => {
                if (lockedDirections.has(direction as MapData.direction)) return;
                const target = this.mapReader.getRoom(targetRoomId);
                if (target) {
                    const weightKey = directionToExitWeightKey[direction as MapData.direction] ?? direction;
                    const weight = this.resolveEdgeWeight(room, weightKey, target);
                    edges.push({id: targetRoomId, weight});
                    connections[targetRoomId.toString()] = weight;
                    if (weight < minEdgeWeight) minEdgeWeight = weight;
                    const dx = target.x - room.x;
                    const dy = target.y - room.y;
                    const dz = target.z - room.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > maxEdgeDist) maxEdgeDist = dist;
                }
            });

            Object.entries(room.specialExits ?? {}).forEach(([exitCommand, targetRoomId]) => {
                if (lockedSpecialTargets.has(targetRoomId)) return;
                const target = this.mapReader.getRoom(targetRoomId);
                if (target) {
                    const weight = this.resolveEdgeWeight(room, exitCommand, target);
                    edges.push({id: targetRoomId, weight});
                    connections[targetRoomId.toString()] = weight;
                    if (weight < minEdgeWeight) minEdgeWeight = weight;
                    const dx = target.x - room.x;
                    const dy = target.y - room.y;
                    const dz = target.z - room.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist > maxEdgeDist) maxEdgeDist = dist;
                }
            });

            adj.set(room.id, edges);
            graphDefinition[room.id.toString()] = connections;
        });

        if (!isFinite(minEdgeWeight)) minEdgeWeight = 1;

        return {adj, graphDefinition, maxEdgeDistance: maxEdgeDist, minEdgeWeight};
    }
}
