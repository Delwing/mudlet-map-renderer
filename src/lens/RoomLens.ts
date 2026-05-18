import type IExit from "../reader/Exit";

/**
 * How the renderer should treat an exit whose endpoints are not both visible.
 *
 * - `"full"`   — draw the exit normally (both endpoints are visible, or the
 *                lens overrides the default and wants the full line anyway).
 * - `"stub"`   — draw only a short stub leaving the visible endpoint; the
 *                far end isn't shown. This is the "explored frontier" look.
 * - `"hidden"` — don't draw the exit at all.
 *
 * Cross-area exits (rooms in different `area` ids) are an orthogonal concept
 * decided by raw room data, not by the lens. A lens that returns `"full"` for
 * a cross-area exit still gets the cross-area arrow treatment.
 */
export type ExitTreatment = "full" | "stub" | "hidden";

/**
 * Visibility filter applied during scene build.
 *
 * `IArea` / `IPlane` / `IMapReader` are pure data — they return every room and
 * every link exit the underlying map defines. The lens decides which of those
 * actually paint, and (optionally) how partially-visible exits should be
 * stubbed or hidden. Multiple concerns (exploration, guild scope, quest
 * overlay, …) compose through {@link composeLenses}.
 */
export interface RoomLens {
    isVisible(room: MapData.Room): boolean;

    /**
     * Decide how an exit between `a` and `b` should be drawn.
     *
     * Optional — when omitted, treatment is derived from endpoint visibility:
     * both visible → `"full"`, one visible → `"stub"`, neither → `"hidden"`.
     */
    getExitTreatment?(exit: IExit, a: MapData.Room, b: MapData.Room): ExitTreatment;

    /**
     * Monotonically increasing version. The renderer caches the value from the
     * last build and rebuilds when it changes. Mutations on a stateful lens
     * (e.g. {@link ExplorationLens.addVisited}) bump this; callers that mutate
     * the lens still call `renderer.refresh()` explicitly.
     */
    getVersion(): number;
}

export const ALL_VISIBLE: RoomLens = {
    isVisible: () => true,
    getVersion: () => 0,
};

/**
 * Default treatment when no lens supplies `getExitTreatment`: derive purely
 * from endpoint visibility.
 */
export function defaultExitTreatment(
    lens: RoomLens,
    _exit: IExit,
    a: MapData.Room,
    b: MapData.Room,
): ExitTreatment {
    const aVis = lens.isVisible(a);
    const bVis = lens.isVisible(b);
    if (aVis && bVis) return "full";
    if (aVis || bVis) return "stub";
    return "hidden";
}
