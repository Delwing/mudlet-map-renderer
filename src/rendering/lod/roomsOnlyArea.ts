import type {IArea} from "../../reader/Area";

/**
 * Wrap an {@link IArea} so `getLinkExits` reports none, while every other
 * method delegates unchanged. Used for the "rooms only" LOD tier: a bridge
 * between full vector (rooms + exit lines) and the raster overview — rooms
 * still render as real vector shapes (env colour, border, shape), but exit
 * pairing and exit-line shape building are skipped entirely, which is a large
 * share of a dense rebuild's cost (pairing scales with exit count, typically
 * ~2x room count in a well-connected area).
 *
 * A plain object literal rather than a class: `IArea` implementations are
 * often plain objects or class instances whose methods live on the
 * prototype, so `{...area}` would silently drop them — explicit delegation
 * avoids that trap.
 */
export function withoutLinkExits(area: IArea): IArea {
    return {
        getAreaName: () => area.getAreaName(),
        getAreaId: () => area.getAreaId(),
        getVersion: () => area.getVersion(),
        getPlane: (zIndex: number) => area.getPlane(zIndex),
        getPlanes: () => area.getPlanes(),
        getZLevels: () => area.getZLevels(),
        getRooms: () => area.getRooms(),
        getFullBounds: () => area.getFullBounds(),
        getLinkExits: () => [],
    };
}
