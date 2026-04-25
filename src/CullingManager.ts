/**
 * CullingManager — RAF-debounced scheduler for the shared clip step.
 *
 * The actual shape-filtering logic lives in {@link clipSceneToViewport} so
 * every rendering path (interactive Konva, SVG export, PNG export) uses the
 * same predicate. CullingManager's only remaining jobs are:
 *
 *  - Scheduling: batches rapid camera changes into one clip pass per frame via
 *    `requestAnimationFrame` (`scheduleCulling`).
 *  - Coordinate transform: stores the world→scene projection so callers can
 *    retrieve it without threading it through every call site.
 *  - Perf monitoring: aggregates per-pass stats and fires `settings.perfCallback`.
 */

import type {Settings, PerfSnapshot} from "./types/Settings";
import type {CoordFn} from "./coord/CoordFn";
import {IDENTITY_TRANSFORM} from "./coord/CoordFn";

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

export class CullingManager {
    private cullingScheduled = false;
    private coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private readonly perfMonitor = new PerfMonitor();
    private lastGridMs = 0;

    /**
     * @param settings        Renderer settings (read on each pass for cullingEnabled, perfCallback).
     * @param onCullingNeeded Called on each scheduled or immediate cull pass.
     *   Implementors run {@link clipSceneToViewport} and apply the result to their backend.
     */
    constructor(
        private readonly settings: Settings,
        private readonly onCullingNeeded: () => void,
    ) {}

    setCoordinateTransform(fn: CoordFn) {
        this.coordinateTransform = fn;
    }

    getCoordinateTransform(): CoordFn {
        return this.coordinateTransform;
    }

    recordGridMs(ms: number) {
        this.lastGridMs = ms;
    }

    recordStats(stats: {cullingMs: number; visibleRooms: number; totalRooms: number; visibleExits: number}) {
        this.perfMonitor.setCallback(this.settings.perfCallback);
        this.perfMonitor.record({
            ...stats,
            gridMs: this.lastGridMs,
            fps: this.perfMonitor.computeFps(),
        });
        this.lastGridMs = 0;
    }

    /** Schedule a cull pass on the next animation frame (no-op if already scheduled). */
    scheduleCulling() {
        if (this.cullingScheduled) return;
        this.cullingScheduled = true;
        const cb = () => {
            this.cullingScheduled = false;
            this.onCullingNeeded();
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(cb);
        } else {
            cb();
        }
    }

    /** Run a cull pass immediately (used when mode changes). */
    updateCulling() {
        this.onCullingNeeded();
    }
}
