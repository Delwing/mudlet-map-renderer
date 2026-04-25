import MapReader from "./reader/MapReader";

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
 * Minimum room shape consumed by {@link MapGraph}. The full `MapData.Room`
 * is a strict superset; the A* heuristic in `PathFinder` only needs spatial
 * coordinates plus an id.
 */
export interface RoomLike {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * Hand-crafted graph input for `MapGraph.fromSynthetic`. Lets tests and
 * advanced callers build a graph without going through a {@link MapReader}.
 */
export interface SyntheticGraphInput {
    /** Nodes — each must have a unique `id` and spatial coordinates. */
    rooms: ReadonlyArray<RoomLike>;
    /**
     * Outgoing edges per `roomId`. Edge weights are used as-is.
     * Rooms with no outgoing edges may omit the entry.
     */
    edges: ReadonlyMap<number, ReadonlyArray<Edge>>;
}

/**
 * Builds a weighted adjacency graph from MapReader room/exit data.
 * Separated from PathFinder so the graph can be reused and tested independently.
 *
 * For algorithm-only tests, see {@link MapGraph.fromSynthetic} which builds
 * a graph from a hand-crafted `{ rooms, edges }` input — no `MapReader` or
 * `MapData.Room` instances required.
 */
export class MapGraph {

    private readonly getRoomImpl: (id: number) => RoomLike | undefined;
    private readonly data: GraphData;

    constructor(mapReader: MapReader);
    constructor(synthetic: SyntheticGraphInput);
    constructor(arg: MapReader | SyntheticGraphInput) {
        if (arg instanceof MapReader) {
            this.getRoomImpl = (id) => arg.getRoom(id);
            this.data = MapGraph.buildFromReader(arg);
        } else {
            const rooms = new Map<number, RoomLike>();
            for (const r of arg.rooms) rooms.set(r.id, r);
            this.getRoomImpl = (id) => rooms.get(id);
            this.data = MapGraph.buildFromSynthetic(arg, rooms);
        }
    }

    /**
     * Build a `MapGraph` from raw `{ rooms, edges }` input. Equivalent to
     * `new MapGraph(syntheticInput)`; this static form reads more naturally
     * in tests and at call sites that already destructure their fixture.
     */
    static fromSynthetic(input: SyntheticGraphInput): MapGraph {
        return new MapGraph(input);
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

    getRoom(roomId: number): RoomLike | undefined {
        return this.getRoomImpl(roomId);
    }

    private static resolveEdgeWeight(
        room: MapData.Room, exitWeightKey: string, target: MapData.Room,
    ): number {
        const exitWeight = room.exitWeights?.[exitWeightKey];
        if (exitWeight !== undefined && exitWeight > 0) return exitWeight;
        return Math.max(target.weight, 1);
    }

    private static buildFromReader(mapReader: MapReader): GraphData {
        const adj = new Map<number, Edge[]>();
        const graphDefinition: Record<string, Record<string, number>> = {};
        let maxEdgeDist = 1;
        let minEdgeWeight = Infinity;

        mapReader.getRooms().forEach(room => {
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
                const target = mapReader.getRoom(targetRoomId);
                if (target) {
                    const weightKey = directionToExitWeightKey[direction as MapData.direction] ?? direction;
                    const weight = MapGraph.resolveEdgeWeight(room, weightKey, target);
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
                const target = mapReader.getRoom(targetRoomId);
                if (target) {
                    const weight = MapGraph.resolveEdgeWeight(room, exitCommand, target);
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

    private static buildFromSynthetic(
        input: SyntheticGraphInput,
        roomsById: ReadonlyMap<number, RoomLike>,
    ): GraphData {
        const adj = new Map<number, Edge[]>();
        const graphDefinition: Record<string, Record<string, number>> = {};
        let maxEdgeDist = 1;
        let minEdgeWeight = Infinity;

        for (const room of input.rooms) {
            const incoming = input.edges.get(room.id) ?? [];
            const edges: Edge[] = [];
            const connections: Record<string, number> = {};
            for (const e of incoming) {
                const target = roomsById.get(e.id);
                if (!target) continue;
                edges.push({id: e.id, weight: e.weight});
                connections[e.id.toString()] = e.weight;
                if (e.weight < minEdgeWeight) minEdgeWeight = e.weight;
                const dx = target.x - room.x;
                const dy = target.y - room.y;
                const dz = target.z - room.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > maxEdgeDist) maxEdgeDist = dist;
            }
            adj.set(room.id, edges);
            graphDefinition[room.id.toString()] = connections;
        }

        if (!isFinite(minEdgeWeight)) minEdgeWeight = 1;

        return {adj, graphDefinition, maxEdgeDistance: maxEdgeDist, minEdgeWeight};
    }
}
