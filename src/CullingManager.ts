import type {Settings, CullingMode, PerfSnapshot, ViewportBounds} from "./types/Settings";
import type {GroupNode} from "./backend/DrawingBackend";
import type {Camera} from "./Camera";

export type CoordinateTransform = (x: number, y: number) => { x: number; y: number };
export type RoomNodeEntry = { room: MapData.Room; group: GroupNode };
type Bounds = { x: number; y: number; width: number; height: number };
export type StandaloneExitEntry = { group: GroupNode; bounds: Bounds; targetRoomId?: number };

class PerfMonitor {
    private samples: PerfSnapshot[] = [];
    private lastCullingTime = 0;
    private readonly windowSize: number;
    private callback: ((avg: PerfSnapshot) => void) | null = null;

    constructor(windowSize = 60) {
        this.windowSize = windowSize;
    }

    setCallback(cb: ((avg: PerfSnapshot) => void) | null) {
        if (cb === this.callback) return;
        this.callback = cb;
        this.samples = [];
    }

    record(snapshot: PerfSnapshot) {
        if (!this.callback) return;
        this.samples.push(snapshot);
        if (this.samples.length >= this.windowSize) {
            this.flush();
        }
    }

    computeFps(): number {
        const now = performance.now();
        const dt = now - this.lastCullingTime;
        this.lastCullingTime = now;
        return dt > 0 ? 1000 / dt : 0;
    }

    private flush() {
        const n = this.samples.length;
        if (n === 0) return;
        const avg: PerfSnapshot = { cullingMs: 0, gridMs: 0, visibleRooms: 0, totalRooms: 0, visibleExits: 0, fps: 0 };
        for (const s of this.samples) {
            avg.cullingMs += s.cullingMs;
            avg.gridMs += s.gridMs;
            avg.visibleRooms += s.visibleRooms;
            avg.totalRooms += s.totalRooms;
            avg.visibleExits += s.visibleExits;
            avg.fps += s.fps;
        }
        avg.cullingMs /= n;
        avg.gridMs /= n;
        avg.visibleRooms = Math.round(avg.visibleRooms / n);
        avg.totalRooms = Math.round(avg.totalRooms / n);
        avg.visibleExits = Math.round(avg.visibleExits / n);
        avg.fps = Math.round(avg.fps);
        this.callback!(avg);
        this.samples = [];
    }
}

/**
 * Manages spatial indexing and viewport culling for rooms and exits.
 * Toggles node visibility based on what's in the viewport.
 * No Konva dependency.
 */
export class CullingManager {

    private readonly camera: Camera;
    private readonly settings: Settings;
    private redrawCallback?: (roomDirty: boolean, linkDirty: boolean) => void;

    // Node collections (owned by Renderer, shared by reference)
    roomNodes: Map<number, RoomNodeEntry> = new Map();
    standaloneExitNodes: StandaloneExitEntry[] = [];

    // Spatial index
    spatialBucketSize = 5;
    private roomSpatialIndex: Map<number, Set<RoomNodeEntry>> = new Map();
    private exitSpatialIndex: Map<number, Set<StandaloneExitEntry>> = new Map();
    private visibleRooms: Set<RoomNodeEntry> = new Set();
    private visibleStandaloneExitNodes: Set<StandaloneExitEntry> = new Set();
    private bufferRoomSet: Set<RoomNodeEntry> = new Set();
    private bufferExitSet: Set<StandaloneExitEntry> = new Set();
    private bufferRoomCandidates: Set<RoomNodeEntry> = new Set();
    private bufferExitCandidates: Set<StandaloneExitEntry> = new Set();
    private standaloneExitBoundsRoomSize?: number;
    private cullingScheduled = false;
    private perfMonitor = new PerfMonitor();
    private coordinateTransform: CoordinateTransform = (x, y) => ({x, y});
    private lastGridMs = 0;

    constructor(camera: Camera, settings: Settings) {
        this.camera = camera;
        this.settings = settings;
    }

    /** Called by KonvaLayerManager to receive batchDraw notifications. */
    setRedrawCallback(cb: (roomDirty: boolean, linkDirty: boolean) => void): void {
        this.redrawCallback = cb;
    }

    setCoordinateTransform(fn: CoordinateTransform) {
        this.coordinateTransform = fn;
    }

    recordGridMs(ms: number) {
        this.lastGridMs = ms;
    }

    private transformPoint(x: number, y: number): { x: number; y: number } {
        return this.coordinateTransform(x, y);
    }

    private transformBounds(b: Bounds): Bounds {
        const fn = this.coordinateTransform;
        const c1 = fn(b.x, b.y);
        const c2 = fn(b.x + b.width, b.y);
        const c3 = fn(b.x + b.width, b.y + b.height);
        const c4 = fn(b.x, b.y + b.height);
        const minX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const maxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const minY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const maxY = Math.max(c1.y, c2.y, c3.y, c4.y);
        return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
    }

    computeBucketSize() {
        this.spatialBucketSize = Math.max(this.settings.roomSize * 10, 5);
    }

    clear() {
        this.roomNodes.clear();
        this.standaloneExitNodes = [];
        this.standaloneExitBoundsRoomSize = undefined;
        this.roomSpatialIndex.clear();
        this.exitSpatialIndex.clear();
        this.visibleRooms.clear();
        this.visibleStandaloneExitNodes.clear();
    }

    private getBucketKey(bucketX: number, bucketY: number) {
        return bucketX * 1000003 + bucketY;
    }

    private forEachBucket(minX: number, minY: number, maxX: number, maxY: number, callback: (key: number) => void) {
        const bucketSize = this.spatialBucketSize;
        const safeMinX = Math.min(minX, maxX);
        const safeMaxX = Math.max(minX, maxX);
        const safeMinY = Math.min(minY, maxY);
        const safeMaxY = Math.max(minY, maxY);
        const minBucketX = Math.floor(safeMinX / bucketSize);
        const maxBucketX = Math.floor(safeMaxX / bucketSize);
        const minBucketY = Math.floor(safeMinY / bucketSize);
        const maxBucketY = Math.floor(safeMaxY / bucketSize);

        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
            for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
                callback(this.getBucketKey(bucketX, bucketY));
            }
        }
    }

    addRoomToSpatialIndex(entry: RoomNodeEntry) {
        const halfSize = this.settings.roomSize / 2;
        const tb = this.transformBounds({
            x: entry.room.x - halfSize, y: entry.room.y - halfSize,
            width: this.settings.roomSize, height: this.settings.roomSize,
        });
        this.forEachBucket(tb.x, tb.y, tb.x + tb.width, tb.y + tb.height, key => {
            let bucket = this.roomSpatialIndex.get(key);
            if (!bucket) { bucket = new Set(); this.roomSpatialIndex.set(key, bucket); }
            bucket.add(entry);
        });
    }

    addStandaloneExitToSpatialIndex(entry: StandaloneExitEntry) {
        const tb = this.transformBounds(entry.bounds);
        this.forEachBucket(tb.x, tb.y, tb.x + tb.width, tb.y + tb.height, key => {
            let bucket = this.exitSpatialIndex.get(key);
            if (!bucket) { bucket = new Set(); this.exitSpatialIndex.set(key, bucket); }
            bucket.add(entry);
        });
    }


    findRoomAtMapPoint(mapX: number, mapY: number): MapData.Room | null {
        // Use a generous margin to cover iso diamonds (2x wider than Cartesian squares)
        const margin = this.settings.roomSize;
        const key = this.getBucketKey(
            Math.floor(mapX / this.spatialBucketSize),
            Math.floor(mapY / this.spatialBucketSize),
        );
        const bucket = this.roomSpatialIndex.get(key);
        if (!bucket) return null;
        let best: MapData.Room | null = null;
        let bestDist = Infinity;
        for (const entry of bucket) {
            const t = this.transformPoint(entry.room.x, entry.room.y);
            const dx = mapX - t.x;
            const dy = mapY - t.y;
            if (dx >= -margin && dx <= margin && dy >= -margin && dy <= margin) {
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) { bestDist = dist; best = entry.room; }
            }
        }
        return best;
    }

    queryRoomsInBounds(bounds: ViewportBounds): MapData.Room[] {
        const {minX, minY, maxX, maxY} = bounds;
        const halfSize = this.settings.roomSize / 2;
        const candidates = this.collectRoomCandidates(minX - halfSize, minY - halfSize, maxX + halfSize, maxY + halfSize);
        const result: MapData.Room[] = [];
        candidates.forEach(entry => {
            const t = this.transformBounds({
                x: entry.room.x - halfSize, y: entry.room.y - halfSize,
                width: this.settings.roomSize, height: this.settings.roomSize,
            });
            if (t.x + t.width >= minX && t.x <= maxX && t.y + t.height >= minY && t.y <= maxY) {
                result.push(entry.room);
            }
        });
        return result;
    }

    markExitBoundsStale() {
        this.standaloneExitBoundsRoomSize = undefined;
    }

    setExitBoundsRoomSize() {
        this.standaloneExitBoundsRoomSize = this.settings.roomSize;
    }

    private collectRoomCandidates(minX: number, minY: number, maxX: number, maxY: number) {
        const result = this.bufferRoomCandidates;
        result.clear();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            this.roomSpatialIndex.get(key)?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private collectStandaloneExitCandidates(minX: number, minY: number, maxX: number, maxY: number) {
        const result = this.bufferExitCandidates;
        result.clear();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            this.exitSpatialIndex.get(key)?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private refreshStandaloneExitBoundsIfNeeded() {
        if (this.standaloneExitBoundsRoomSize === this.settings.roomSize) return;
        this.exitSpatialIndex.clear();
        this.standaloneExitNodes.forEach(entry => this.addStandaloneExitToSpatialIndex(entry));
        this.standaloneExitBoundsRoomSize = this.settings.roomSize;
    }

    scheduleCulling() {
        if (this.cullingScheduled) return;
        this.cullingScheduled = true;
        const cb = () => {
            this.cullingScheduled = false;
            this.updateCulling();
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(cb);
        } else {
            cb();
        }
    }

    updateCulling() {
        if (this.roomNodes.size === 0 && this.standaloneExitNodes.length === 0) return;

        const scale = this.camera.getScale();
        if (!scale) return;

        this.perfMonitor.setCallback(this.settings.perfCallback);
        const perfStart = this.settings.perfCallback ? performance.now() : 0;

        const position = this.camera.position;
        const halfSize = this.settings.roomSize / 2;
        const bounds = this.settings.cullingBounds;
        const viewportMinX = bounds ? bounds.x : 0;
        const viewportMaxX = bounds ? bounds.x + bounds.width : this.camera.width;
        const viewportMinY = bounds ? bounds.y : 0;
        const viewportMaxY = bounds ? bounds.y + bounds.height : this.camera.height;
        const minX = (Math.min(viewportMinX, viewportMaxX) - position.x) / scale;
        const maxX = (Math.max(viewportMinX, viewportMaxX) - position.x) / scale;
        const minY = (Math.min(viewportMinY, viewportMaxY) - position.y) / scale;
        const maxY = (Math.max(viewportMinY, viewportMaxY) - position.y) / scale;

        let roomLayerNeedsDraw = false;
        let linkLayerNeedsDraw = false;

        const mode: CullingMode = this.settings.cullingEnabled ? this.settings.cullingMode ?? "indexed" : "none";
        const searchMinX = minX - halfSize;
        const searchMaxX = maxX + halfSize;
        const searchMinY = minY - halfSize;
        const searchMaxY = maxY + halfSize;

        this.refreshStandaloneExitBoundsIfNeeded();

        if (mode === "none") {
            this.roomNodes.forEach(entry => {
                if (!entry.group.isVisible()) { entry.group.setVisible(true); roomLayerNeedsDraw = true; }
            });
            this.standaloneExitNodes.forEach(entry => {
                if (!entry.group.isVisible()) { entry.group.setVisible(true); linkLayerNeedsDraw = true; }
            });
            if (roomLayerNeedsDraw || linkLayerNeedsDraw) this.redrawCallback?.(roomLayerNeedsDraw, linkLayerNeedsDraw);
            this.visibleRooms.clear();
            this.roomNodes.forEach(entry => this.visibleRooms.add(entry));
            this.visibleStandaloneExitNodes.clear();
            this.standaloneExitNodes.forEach(entry => this.visibleStandaloneExitNodes.add(entry));
            return;
        }

        if (mode === "basic") {
            const nextVisibleRooms = this.bufferRoomSet;
            nextVisibleRooms.clear();
            const roomSize = this.settings.roomSize;
            this.roomNodes.forEach(entry => {
                const tb = this.transformBounds({
                    x: entry.room.x - halfSize, y: entry.room.y - halfSize,
                    width: roomSize, height: roomSize,
                });
                const isVisible = tb.x + tb.width >= minX && tb.x <= maxX &&
                    tb.y + tb.height >= minY && tb.y <= maxY;
                if (entry.group.isVisible() !== isVisible) { entry.group.setVisible(isVisible); roomLayerNeedsDraw = true; }
                if (isVisible) nextVisibleRooms.add(entry);
            });

            const result = this.cullExits(minX, maxX, minY, maxY);
            linkLayerNeedsDraw = result.changed;

            this.bufferRoomSet = this.visibleRooms;
            this.visibleRooms = nextVisibleRooms;
            if (roomLayerNeedsDraw || linkLayerNeedsDraw) this.redrawCallback?.(roomLayerNeedsDraw, linkLayerNeedsDraw);
            return;
        }

        // "indexed" mode
        const roomCandidates = this.collectRoomCandidates(searchMinX, searchMinY, searchMaxX, searchMaxY);
        const nextVisibleRooms = this.bufferRoomSet;
        nextVisibleRooms.clear();

        const roomSize = this.settings.roomSize;
        roomCandidates.forEach(entry => {
            const tb = this.transformBounds({
                x: entry.room.x - halfSize, y: entry.room.y - halfSize,
                width: roomSize, height: roomSize,
            });
            const isVisible = tb.x + tb.width >= minX && tb.x <= maxX &&
                tb.y + tb.height >= minY && tb.y <= maxY;
            if (entry.group.isVisible() !== isVisible) { entry.group.setVisible(isVisible); roomLayerNeedsDraw = true; }
            if (isVisible) nextVisibleRooms.add(entry);
        });

        this.visibleRooms.forEach(entry => {
            if (!roomCandidates.has(entry) && entry.group.isVisible()) {
                entry.group.setVisible(false);
                roomLayerNeedsDraw = true;
            }
        });

        this.bufferRoomSet = this.visibleRooms;
        this.visibleRooms = nextVisibleRooms;

        const exitResult = this.cullExits(minX, maxX, minY, maxY, true);
        linkLayerNeedsDraw = exitResult.changed;

        if (roomLayerNeedsDraw || linkLayerNeedsDraw) this.redrawCallback?.(roomLayerNeedsDraw, linkLayerNeedsDraw);

        if (this.settings.perfCallback) {
            const cullingMs = performance.now() - perfStart;
            const gridMs = this.lastGridMs;
            this.lastGridMs = 0;
            this.perfMonitor.record({
                cullingMs, gridMs,
                visibleRooms: this.visibleRooms.size,
                totalRooms: this.roomNodes.size,
                visibleExits: this.visibleStandaloneExitNodes.size,
                fps: this.perfMonitor.computeFps(),
            });
        }
    }

    private cullExits(minX: number, maxX: number, minY: number, maxY: number, useIndex = false): { changed: boolean } {
        const candidates = useIndex
            ? this.collectStandaloneExitCandidates(minX - this.settings.roomSize, minY - this.settings.roomSize, maxX + this.settings.roomSize, maxY + this.settings.roomSize)
            : this.standaloneExitNodes;

        const nextVisible = this.bufferExitSet;
        nextVisible.clear();
        let changed = false;

        const check = (entry: StandaloneExitEntry) => {
            const b = this.transformBounds(entry.bounds);
            const isVisible = b.x + b.width >= minX && b.x <= maxX && b.y + b.height >= minY && b.y <= maxY;
            if (entry.group.isVisible() !== isVisible) { entry.group.setVisible(isVisible); changed = true; }
            if (isVisible) nextVisible.add(entry);
        };

        (candidates as Iterable<StandaloneExitEntry>)[Symbol.iterator]
            ? (candidates as Set<StandaloneExitEntry>).forEach(check)
            : (candidates as StandaloneExitEntry[]).forEach(check);

        // Hide exits that were visible but aren't candidates anymore (indexed mode)
        this.visibleStandaloneExitNodes.forEach(entry => {
            if (!nextVisible.has(entry) && entry.group.isVisible()) {
                entry.group.setVisible(false);
                changed = true;
            }
        });

        this.bufferExitSet = this.visibleStandaloneExitNodes;
        this.visibleStandaloneExitNodes = nextVisible;

        return {changed};
    }
}
