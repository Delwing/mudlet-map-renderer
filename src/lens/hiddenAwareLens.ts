import type {RoomLens} from "./RoomLens";
import {defaultExitTreatment} from "./RoomLens";
import {isRoomHidden} from "../scene/RoomFlags";

/**
 * Wrap a lens so Mudlet-hidden rooms (`settings.hiddenRooms === "hide"`) count
 * as not-visible: the room filter drops them via `isVisible`, and any exit
 * touching one is treated as `"hidden"` via `getExitTreatment`. This reuses the
 * existing lens machinery so every consumer (scene build, current-room overlay)
 * hides hidden rooms and their exits identically.
 *
 * Returns `lens` unchanged when `hideHidden` is false (the "show"/"faded" modes
 * keep hidden rooms visible — "faded" fades them in the room pass instead).
 */
export function hiddenAwareLens(lens: RoomLens, hideHidden: boolean): RoomLens {
    if (!hideHidden) return lens;
    return {
        isVisible: room => lens.isVisible(room) && !isRoomHidden(room),
        getExitTreatment: (exit, a, b) =>
            isRoomHidden(a) || isRoomHidden(b)
                ? "hidden"
                : lens.getExitTreatment
                    ? lens.getExitTreatment(exit, a, b)
                    : defaultExitTreatment(lens, exit, a, b),
        getVersion: () => lens.getVersion(),
    };
}
