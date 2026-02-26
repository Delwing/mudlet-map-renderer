import Graph from "node-dijkstra";
import MapReader from "./reader/MapReader";

export type PathFindingAlgorithm = 'dijkstra' | 'astar';

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

const directionToExitWeightKey: Record<MapData.direction, string> = {
    north: "n",
    northeast: "ne",
    northwest: "nw",
    east: "e",
    west: "w",
    south: "s",
    southeast: "se",
    southwest: "sw",
    up: "up",
    down: "down",
    in: "in",
    out: "out",
};

// --- Min-heap for A* ---

interface HeapEntry {
    id: number;
    priority: number;
}

function heapPush(heap: HeapEntry[], entry: HeapEntry) {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].priority <= heap[i].priority) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
    }
}

function heapPop(heap: HeapEntry[]): HeapEntry | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        const n = heap.length;
        while (true) {
            let smallest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left < n && heap[left].priority < heap[smallest].priority) smallest = left;
            if (right < n && heap[right].priority < heap[smallest].priority) smallest = right;
            if (smallest === i) break;
            [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
            i = smallest;
        }
    }
    return top;
}

// --- Algorithm implementations ---

interface Edge {
    id: number;
    weight: number;
}

function reconstructPath(cameFrom: Map<number, number>, from: number, to: number): number[] {
    const path: number[] = [to];
    let current = to;
    while (current !== from) {
        current = cameFrom.get(current)!;
        path.push(current);
    }
    path.reverse();
    return path;
}

function findPathDijkstra(graph: Graph, from: number, to: number): number[] | null {
    const path = graph.path(from.toString(), to.toString());
    const nodes = Array.isArray(path) ? path : path?.path;
    return nodes ? nodes.map((id: string) => Number(id)) : null;
}

function findPathAStar(
    adj: Map<number, Edge[]>,
    from: number,
    to: number,
    mapReader: MapReader,
    maxEdgeDistance: number,
    minEdgeWeight: number,
): number[] | null {
    const goalRoom = mapReader.getRoom(to);
    if (!goalRoom) return null;
    const goalX = goalRoom.x;
    const goalY = goalRoom.y;
    const goalZ = goalRoom.z;

    const heuristic = (roomId: number): number => {
        const room = mapReader.getRoom(roomId);
        if (!room) return 0;
        const dx = room.x - goalX;
        const dy = room.y - goalY;
        const dz = room.z - goalZ;
        return (Math.sqrt(dx * dx + dy * dy + dz * dz) / maxEdgeDistance) * minEdgeWeight;
    };

    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const heap: HeapEntry[] = [];

    gScore.set(from, 0);
    heapPush(heap, { id: from, priority: heuristic(from) });

    while (heap.length > 0) {
        const { id: current } = heapPop(heap)!;
        if (current === to) return reconstructPath(cameFrom, from, to);

        const currentG = gScore.get(current) ?? Infinity;

        const edges = adj.get(current);
        if (!edges) continue;
        for (const edge of edges) {
            const nextG = currentG + edge.weight;
            if (nextG < (gScore.get(edge.id) ?? Infinity)) {
                gScore.set(edge.id, nextG);
                cameFrom.set(edge.id, current);
                heapPush(heap, { id: edge.id, priority: nextG + heuristic(edge.id) });
            }
        }
    }
    return null;
}

// --- PathFinder ---

export default class PathFinder {

    private readonly mapReader: MapReader;
    private readonly adj: Map<number, Edge[]>;
    private readonly graph: Graph;
    private readonly maxEdgeDistance: number;
    private readonly minEdgeWeight: number;
    private _algorithm: PathFindingAlgorithm;
    private readonly cache = new Map<string, number[] | null>();

    constructor(mapReader: MapReader, algorithm: PathFindingAlgorithm = 'dijkstra') {
        this.mapReader = mapReader;
        this._algorithm = algorithm;
        const { adj, maxEdgeDistance, minEdgeWeight, graphDefinition } = this.buildGraph();
        this.adj = adj;
        this.graph = new Graph(graphDefinition);
        this.maxEdgeDistance = maxEdgeDistance;
        this.minEdgeWeight = minEdgeWeight;
    }

    get algorithm(): PathFindingAlgorithm {
        return this._algorithm;
    }

    setAlgorithm(algorithm: PathFindingAlgorithm): void {
        if (algorithm === this._algorithm) return;
        this._algorithm = algorithm;
        this.cache.clear();
    }

    findPath(from: number, to: number): number[] | null {
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

        let result: number[] | null;
        switch (this._algorithm) {
            case 'dijkstra':
                result = findPathDijkstra(this.graph, from, to);
                break;
            case 'astar':
                result = findPathAStar(this.adj, from, to, this.mapReader, this.maxEdgeDistance, this.minEdgeWeight);
                break;
        }

        this.cache.set(cacheKey, result);
        return result;
    }

    private resolveEdgeWeight(room: MapData.Room, exitWeightKey: string, target: MapData.Room): number {
        const exitWeight = room.exitWeights?.[exitWeightKey];
        if (exitWeight !== undefined && exitWeight > 0) return exitWeight;
        return Math.max(target.weight, 1);
    }

    private buildGraph() {
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
                    edges.push({ id: targetRoomId, weight });
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
                    edges.push({ id: targetRoomId, weight });
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

        return { adj, maxEdgeDistance: maxEdgeDist, minEdgeWeight, graphDefinition };
    }
}
