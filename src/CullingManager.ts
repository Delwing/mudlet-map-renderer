/**
 * CullingManager — RAF-debounced scheduler for the shared clip step.
 *
 * The actual shape-filtering logic lives in {@link clipSceneToViewport} so
 * every rendering path (interactive Konva, SVG export, PNG export) uses the
 * same predicate. CullingManager's jobs are:
 *
 *  - Scheduling: batches rapid camera changes into one clip pass per frame via
 *    `requestAnimationFrame` (`scheduleCulling`).
 *  - Coordinate transform: stores the world→scene projection so callers can
 *    retrieve it without threading it through every call site.
 */

import type {Settings} from "./types/Settings";
import type {CoordFn} from "./coord/CoordFn";
import {IDENTITY_TRANSFORM} from "./coord/CoordFn";

export class CullingManager {
    private cullingScheduled = false;
    private coordinateTransform: CoordFn = IDENTITY_TRANSFORM;

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
