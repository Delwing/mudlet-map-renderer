import Graph from "node-dijkstra";
import MapReader from "./reader/MapReader";
import {MapGraph} from "./MapGraph";
import type {Edge} from "./MapGraph";

export type PathFindingAlgorithm = 'dijkstra' | 'astar';

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
    mapGraph: MapGraph,
): number[] | null {
    const goalRoom = mapGraph.getRoom(to);
    if (!goalRoom) return null;
    const goalX = goalRoom.x;
    const goalY = goalRoom.y;
    const goalZ = goalRoom.z;
    const maxEdgeDistance = mapGraph.getMaxEdgeDistance();
    const minEdgeWeight = mapGraph.getMinEdgeWeight();

    const heuristic = (roomId: number): number => {
        const room = mapGraph.getRoom(roomId);
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
    heapPush(heap, {id: from, priority: heuristic(from)});

    while (heap.length > 0) {
        const {id: current} = heapPop(heap)!;
        if (current === to) return reconstructPath(cameFrom, from, to);

        const currentG = gScore.get(current) ?? Infinity;

        const edges = adj.get(current);
        if (!edges) continue;
        for (const edge of edges) {
            const nextG = currentG + edge.weight;
            if (nextG < (gScore.get(edge.id) ?? Infinity)) {
                gScore.set(edge.id, nextG);
                cameFrom.set(edge.id, current);
                heapPush(heap, {id: edge.id, priority: nextG + heuristic(edge.id)});
            }
        }
    }
    return null;
}

// --- PathFinder ---

export default class PathFinder {

    private readonly mapGraph: MapGraph;
    private readonly dijkstraGraph: Graph;
    private _algorithm: PathFindingAlgorithm;
    private readonly cache = new Map<string, number[] | null>();

    constructor(mapReader: MapReader, algorithm?: PathFindingAlgorithm);
    constructor(graph: MapGraph, algorithm?: PathFindingAlgorithm);
    constructor(source: MapReader | MapGraph, algorithm: PathFindingAlgorithm = 'dijkstra') {
        this._algorithm = algorithm;
        this.mapGraph = source instanceof MapGraph ? source : new MapGraph(source);
        this.dijkstraGraph = new Graph(this.mapGraph.getGraphDefinition());
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
            const result = this.mapGraph.getRoom(from) ? [from] : null;
            this.cache.set(cacheKey, result);
            return result;
        }

        if (!this.mapGraph.getRoom(from) || !this.mapGraph.getRoom(to)) {
            this.cache.set(cacheKey, null);
            return null;
        }

        let result: number[] | null;
        switch (this._algorithm) {
            case 'dijkstra':
                result = findPathDijkstra(this.dijkstraGraph, from, to);
                break;
            case 'astar':
                result = findPathAStar(this.mapGraph.getAdj(), from, to, this.mapGraph);
                break;
        }

        this.cache.set(cacheKey, result);
        return result;
    }
}
