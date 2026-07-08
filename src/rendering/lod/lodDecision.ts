export interface LodDecisionInput {
    /** Total rooms on the whole (area, z) plane — NOT the viewport count. */
    planeRoomCount: number;
    /** Camera scale (screen pixels per map unit), `camera.getScale()`. */
    scale: number;
    stageWidth: number;
    stageHeight: number;
    /** Max rooms the vector (Konva) scene may hold, `settings.lodRoomBudget`. */
    roomBudget: number;
}

/**
 * Decide raster overview vs full vector detail.
 *
 * If the WHOLE plane fits the budget, always draw vectors — a small area
 * never needs the raster overview. Genuinely large planes switch by ZOOM,
 * not by in-view room count: count varies with local density and would flip
 * modes mid-pan, while scale is constant during a pan. Bound: a fully-packed
 * viewport holds ~stageW*stageH/scale² rooms (one per map unit), so vectors
 * are safe once that worst case is within budget.
 */
export function shouldUseRaster(i: LodDecisionInput): boolean {
    return i.planeRoomCount > i.roomBudget &&
        i.scale * i.scale < (i.stageWidth * i.stageHeight) / i.roomBudget;
}

export type LodMode = "vector" | "roomsOnly" | "raster";

export interface LodModeInput extends Omit<LodDecisionInput, "roomBudget"> {
    /** Max rooms the vector scene may hold before switching to raster. */
    roomBudget: number;
    /**
     * Above this many rooms (and below `roomBudget`), exit lines are dropped
     * but rooms still render as full vector shapes — a bridge tier between
     * full vector and raster. Exit pairing + exit-shape building is typically
     * the single largest share of a dense rebuild's cost (exit count often
     * runs ~2x room count), so this tier buys back most of that cost while
     * keeping real vector rooms, not raster pixels. Must be ≤ `roomBudget`;
     * treated as unlimited (never hides exits) if omitted.
     */
    exitBudget?: number;
}

/**
 * Decide the LOD tier: full vector (rooms + exits + hit-test-eligible),
 * rooms-only vector (exits dropped, rooms still real vector shapes), or
 * raster overview. Same pan-invariant zoom-based math as {@link shouldUseRaster}
 * applied at two budgets — `exitBudget` always yields "roomsOnly" no later
 * (i.e. at an equal or lower zoom-out) than `roomBudget` yields "raster",
 * since exitBudget ≤ roomBudget.
 */
export function computeLodMode(i: LodModeInput): LodMode {
    if (shouldUseRaster({...i, roomBudget: i.roomBudget})) return "raster";
    if (i.exitBudget !== undefined && shouldUseRaster({...i, roomBudget: i.exitBudget})) return "roomsOnly";
    return "vector";
}
