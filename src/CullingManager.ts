/**
 * CullingManager — spatial index + viewport culling over engine-agnostic
 * {@link CullEntry} objects.
 *
 * The manager knows nothing about Konva, SVG, or any rendering engine.
 * Callers receive visibility changes through {@link CullingCallbacks} and are
 * responsible for applying them to their own node graph.
 *
 * Coordinate contract:
 *   - Entries carry world-space bounding boxes.
 *   - An optional {@link CoordinateTransform} projects world → rendered space
 *     (identity for flat styles; iso-projection for IsometricStyle).
 *   - The camera viewport (from {@link Camera.getViewportBounds}) is in rendered
 *     space, so the transform must be set before the first culling pass when an
 *     iso-style is active.
 */

import type {Settings, CullingMode, PerfSnapshot} from "./types/Settings";
import type {Camera} from "./camera/Camera";
import type {Bbox} from "./scene/Shape";

export type CoordinateTransform = (x: number, y: number) => {x: number; y: number};

/** An entry tracked by the CullingManager. */
export interface CullEntry {
    /** Axis-aligned bounding box in world (flat-map) space. */
    worldBbox: Bbox;
}

/**
 * Callbacks invoked by the CullingManager as visibility changes during
 * {@link CullingManager.updateCulling}.
 */
export interface CullingCallbacks {
    /** Called whenever a room entry changes visibility. */
    setRoomVisible(entry: CullEntry, visible: boolean): void;
    /** Called whenever an exit entry changes visibility. */
    setExitVisible(entry: CullEntry, visible: boolean): void;
    /**
     * Called once at the end of each culling pass.
     * `roomsChanged` / `exitsChanged` indicate whether any visibility changed
     * for the respective layer — use them to decide whether to redraw.
     */
    afterCulling(roomsChanged: boolean, exitsChanged: boolean): void;
}

// ── PerfMonitor ───────────────────────────────────────────────────────────────

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
        if (this.samples.length >= this.windowSize) this.flush();
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
        const avg: PerfSnapshot = {cullingMs: 0, gridMs: 0, visibleRooms: 0, totalRooms: 0, visibleExits: 0, fps: 0};
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

// ── CullingManager ────────────────────────────────────────────────────────────

/**
 * Manages spatial indexing and viewport culling for rooms and exits.
 *
 * Replaces the former Konva-aware version: there is no `StageInfo`, no
 * `GroupNode.setVisible` call, and no `LayerNode.batchDraw` call.  Instead the
 * caller provides {@link CullingCallbacks} to handle those effects.
 */
export class CullingManager {

    private readonly camera: Camera;
    private readonly settings: Settings;
    private readonly callbacks: CullingCallbacks;

    // Room entries
    private roomEntries: CullEntry[] = [];
    private roomSpatialIndex = new Map<number, Set<CullEntry>>();
    private visibleRooms: Set<CullEntry> = new Set();
    private bufferRoomSet: Set<CullEntry> = new Set();
    private bufferRoomCandidates: Set<CullEntry> = new Set();

    // Exit entries
    private exitEntries: CullEntry[] = [];
    private exitSpatialIndex = new Map<number, Set<CullEntry>>();
    private visibleExits: Set<CullEntry> = new Set();
    private bufferExitSet: Set<CullEntry> = new Set();
    private bufferExitCandidates: Set<CullEntry> = new Set();

    spatialBucketSize = 5;
    private coordinateTransform: CoordinateTransform = (x, y) => ({x, y});
    private cullingScheduled = false;
    private perfMonitor = new PerfMonitor();
    private lastGridMs = 0;

    constructor(camera: Camera, settings: Settings, callbacks: CullingCallbacks) {
        this.camera = camera;
        this.settings = settings;
        this.callbacks = callbacks;
    }

    setCoordinateTransform(fn: CoordinateTransform) {
        this.coordinateTransform = fn;
    }

    recordGridMs(ms: number) {
        this.lastGridMs = ms;
    }

    computeBucketSize() {
        this.spatialBucketSize = Math.max(this.settings.roomSize * 10, 5);
    }

    clear() {
        this.roomEntries = [];
        this.exitEntries = [];
        this.roomSpatialIndex.clear();
        this.exitSpatialIndex.clear();
        this.visibleRooms.clear();
        this.visibleExits.clear();
    }

    // ── Entry registration ────────────────────────────────────────────────────

    addRoomEntry(entry: CullEntry) {
        this.roomEntries.push(entry);
        this.indexEntry(entry, this.roomSpatialIndex);
    }

    addExitEntry(entry: CullEntry) {
        this.exitEntries.push(entry);
        this.indexEntry(entry, this.exitSpatialIndex);
    }

    // ── Culling ───────────────────────────────────────────────────────────────

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
        if (this.roomEntries.length === 0 && this.exitEntries.length === 0) return;

        this.perfMonitor.setCallback(this.settings.perfCallback);
        const perfStart = this.settings.perfCallback ? performance.now() : 0;

        // Viewport bounds in rendered space (camera map space).
        // cullingBounds overrides to a sub-rectangle in screen-pixel space.
        let minX: number, maxX: number, minY: number, maxY: number;
        if (this.settings.cullingBounds) {
            const scale = this.camera.getScale();
            if (!scale) return;
            const pos = this.camera.position;
            const b = this.settings.cullingBounds;
            minX = (b.x - pos.x) / scale;
            maxX = (b.x + b.width - pos.x) / scale;
            minY = (b.y - pos.y) / scale;
            maxY = (b.y + b.height - pos.y) / scale;
        } else {
            if (!this.camera.getScale()) return;
            const vp = this.camera.getViewportBounds();
            minX = vp.minX;
            maxX = vp.maxX;
            minY = vp.minY;
            maxY = vp.maxY;
        }

        const mode: CullingMode = this.settings.cullingEnabled
            ? (this.settings.cullingMode ?? "indexed")
            : "none";
        const halfSize = this.settings.roomSize / 2;

        let roomsChanged = false;
        let exitsChanged = false;

        if (mode === "none") {
            this.roomEntries.forEach(entry => {
                if (!this.visibleRooms.has(entry)) {
                    this.visibleRooms.add(entry);
                    this.callbacks.setRoomVisible(entry, true);
                    roomsChanged = true;
                }
            });
            this.exitEntries.forEach(entry => {
                if (!this.visibleExits.has(entry)) {
                    this.visibleExits.add(entry);
                    this.callbacks.setExitVisible(entry, true);
                    exitsChanged = true;
                }
            });

        } else if (mode === "basic") {
            const nextVisibleRooms = this.bufferRoomSet;
            nextVisibleRooms.clear();
            this.roomEntries.forEach(entry => {
                const tb = this.transformedBbox(entry.worldBbox);
                const isVisible = tb.maxX >= minX && tb.minX <= maxX && tb.maxY >= minY && tb.minY <= maxY;
                const wasVisible = this.visibleRooms.has(entry);
                if (isVisible !== wasVisible) {
                    this.callbacks.setRoomVisible(entry, isVisible);
                    roomsChanged = true;
                }
                if (isVisible) nextVisibleRooms.add(entry);
            });
            this.bufferRoomSet = this.visibleRooms;
            this.visibleRooms = nextVisibleRooms;

            exitsChanged = this.cullExits(minX, maxX, minY, maxY, false);

        } else {
            // "indexed" mode
            const searchMinX = minX - halfSize;
            const searchMaxX = maxX + halfSize;
            const searchMinY = minY - halfSize;
            const searchMaxY = maxY + halfSize;

            const roomCandidates = this.collectCandidates(
                searchMinX, searchMinY, searchMaxX, searchMaxY, this.roomSpatialIndex, this.bufferRoomCandidates,
            );
            const nextVisibleRooms = this.bufferRoomSet;
            nextVisibleRooms.clear();

            roomCandidates.forEach(entry => {
                const tb = this.transformedBbox(entry.worldBbox);
                const isVisible = tb.maxX >= minX && tb.minX <= maxX && tb.maxY >= minY && tb.minY <= maxY;
                const wasVisible = this.visibleRooms.has(entry);
                if (isVisible !== wasVisible) {
                    this.callbacks.setRoomVisible(entry, isVisible);
                    roomsChanged = true;
                }
                if (isVisible) nextVisibleRooms.add(entry);
            });

            // Hide rooms that were visible but are no longer candidates
            this.visibleRooms.forEach(entry => {
                if (!roomCandidates.has(entry)) {
                    this.callbacks.setRoomVisible(entry, false);
                    roomsChanged = true;
                }
            });

            this.bufferRoomSet = this.visibleRooms;
            this.visibleRooms = nextVisibleRooms;

            exitsChanged = this.cullExits(minX, maxX, minY, maxY, true);
        }

        this.callbacks.afterCulling(roomsChanged, exitsChanged);

        if (this.settings.perfCallback) {
            const cullingMs = performance.now() - perfStart;
            const gridMs = this.lastGridMs;
            this.lastGridMs = 0;
            this.perfMonitor.record({
                cullingMs, gridMs,
                visibleRooms: this.visibleRooms.size,
                totalRooms: this.roomEntries.length,
                visibleExits: this.visibleExits.size,
                fps: this.perfMonitor.computeFps(),
            });
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private cullExits(minX: number, maxX: number, minY: number, maxY: number, useIndex: boolean): boolean {
        const candidates = useIndex
            ? this.collectCandidates(
                minX - this.settings.roomSize, minY - this.settings.roomSize,
                maxX + this.settings.roomSize, maxY + this.settings.roomSize,
                this.exitSpatialIndex, this.bufferExitCandidates,
            )
            : this.exitEntries;

        const nextVisible = this.bufferExitSet;
        nextVisible.clear();
        let changed = false;

        const check = (entry: CullEntry) => {
            const b = this.transformedBbox(entry.worldBbox);
            const isVisible = b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
            const wasVisible = this.visibleExits.has(entry);
            if (isVisible !== wasVisible) {
                this.callbacks.setExitVisible(entry, isVisible);
                changed = true;
            }
            if (isVisible) nextVisible.add(entry);
        };

        if (Array.isArray(candidates)) {
            candidates.forEach(check);
        } else {
            (candidates as Set<CullEntry>).forEach(check);
        }

        // Hide exits that were visible but are no longer candidates (indexed mode)
        this.visibleExits.forEach(entry => {
            if (!nextVisible.has(entry)) {
                this.callbacks.setExitVisible(entry, false);
                changed = true;
            }
        });

        this.bufferExitSet = this.visibleExits;
        this.visibleExits = nextVisible;

        return changed;
    }

    private transformedBbox(bbox: Bbox): Bbox {
        const fn = this.coordinateTransform;
        const c1 = fn(bbox.minX, bbox.minY);
        const c2 = fn(bbox.maxX, bbox.minY);
        const c3 = fn(bbox.maxX, bbox.maxY);
        const c4 = fn(bbox.minX, bbox.maxY);
        return {
            minX: Math.min(c1.x, c2.x, c3.x, c4.x),
            minY: Math.min(c1.y, c2.y, c3.y, c4.y),
            maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
            maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
        };
    }

    private indexEntry(entry: CullEntry, index: Map<number, Set<CullEntry>>) {
        const tb = this.transformedBbox(entry.worldBbox);
        const size = this.spatialBucketSize;
        const bMinX = Math.floor(tb.minX / size);
        const bMaxX = Math.floor(tb.maxX / size);
        const bMinY = Math.floor(tb.minY / size);
        const bMaxY = Math.floor(tb.maxY / size);
        for (let bx = bMinX; bx <= bMaxX; bx++) {
            for (let by = bMinY; by <= bMaxY; by++) {
                const key = this.getBucketKey(bx, by);
                let bucket = index.get(key);
                if (!bucket) { bucket = new Set(); index.set(key, bucket); }
                bucket.add(entry);
            }
        }
    }

    private collectCandidates(
        minX: number, minY: number, maxX: number, maxY: number,
        index: Map<number, Set<CullEntry>>,
        result: Set<CullEntry>,
    ): Set<CullEntry> {
        result.clear();
        const size = this.spatialBucketSize;
        const bMinX = Math.floor(minX / size);
        const bMaxX = Math.floor(maxX / size);
        const bMinY = Math.floor(minY / size);
        const bMaxY = Math.floor(maxY / size);
        for (let bx = bMinX; bx <= bMaxX; bx++) {
            for (let by = bMinY; by <= bMaxY; by++) {
                index.get(this.getBucketKey(bx, by))?.forEach(e => result.add(e));
            }
        }
        return result;
    }

    private getBucketKey(bx: number, by: number): number {
        return bx * 1000003 + by;
    }
}
