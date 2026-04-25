/**
 * Bit flags describing portions of the rendered output that need to be
 * recomputed. Multiple flags can be OR'd together; the scheduler unions
 * pending flags across the current tick and dispatches them in one pass.
 *
 * `Scene` is a strict superset of every other flag: when set, the flush
 * runs the full scene rebuild (which already updates background, position,
 * highlights, paths, culling and scene overlays) and the other flags are
 * cleared without further work.
 */
export const DirtyFlag = {
    None: 0,
    Scene: 1 << 0,
    Background: 1 << 1,
    Position: 1 << 2,
    Highlights: 1 << 3,
    Paths: 1 << 4,
    Culling: 1 << 5,
    SceneOverlays: 1 << 6,
} as const;

export type DirtyFlag = number;

/**
 * Coalesces dirty-flag updates across a tick and dispatches them in a single
 * `requestAnimationFrame` callback (or microtask in environments without rAF).
 *
 * Callers mark portions of the scene dirty via {@link markDirty}; the actual
 * rendering work lives in the `flushFn` constructor argument and runs at most
 * once per tick. {@link flush} processes pending work synchronously — useful
 * for exports, tests, and any caller that needs to read rendered state on
 * the same tick.
 */
export class RenderScheduler {
    private dirty: DirtyFlag = DirtyFlag.None;
    private scheduled = false;
    private rafId?: number;
    private destroyed = false;

    private readonly schedule: (cb: () => void) => number;
    private readonly cancel: (id: number) => void;
    private readonly flushFn: (flags: DirtyFlag) => void;

    constructor(flushFn: (flags: DirtyFlag) => void) {
        this.flushFn = flushFn;
        if (typeof requestAnimationFrame === 'function') {
            this.schedule = (cb) => requestAnimationFrame(cb);
            this.cancel = (id) => cancelAnimationFrame(id);
        } else {
            this.schedule = (cb) => setTimeout(cb, 0) as unknown as number;
            this.cancel = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
        }
    }

    /**
     * OR `flags` into the pending set. Schedules a flush on the next frame
     * if one isn't already pending. `DirtyFlag.None` is a no-op.
     */
    markDirty(flags: DirtyFlag) {
        if (this.destroyed || flags === DirtyFlag.None) return;
        this.dirty |= flags;
        if (!this.scheduled) {
            this.scheduled = true;
            this.rafId = this.schedule(() => this.runFlush());
        }
    }

    /** True if a flush is currently scheduled (but has not yet run). */
    isScheduled(): boolean {
        return this.scheduled;
    }

    /** Currently pending flags, or `DirtyFlag.None`. */
    pending(): DirtyFlag {
        return this.dirty;
    }

    /**
     * Process pending flags now. Cancels any scheduled rAF callback and
     * runs the flush function synchronously. Safe to call when nothing is
     * pending — it's a no-op in that case.
     */
    flush() {
        if (this.rafId !== undefined) {
            this.cancel(this.rafId);
            this.rafId = undefined;
        }
        this.runFlush();
    }

    /**
     * Cancel any scheduled flush and clear pending flags without running
     * `flushFn`. Used during teardown.
     */
    destroy() {
        this.destroyed = true;
        if (this.rafId !== undefined) {
            this.cancel(this.rafId);
            this.rafId = undefined;
        }
        this.dirty = DirtyFlag.None;
        this.scheduled = false;
    }

    private runFlush() {
        this.scheduled = false;
        this.rafId = undefined;
        const flags = this.dirty;
        if (flags === DirtyFlag.None) return;
        this.dirty = DirtyFlag.None;
        this.flushFn(flags);
    }
}
