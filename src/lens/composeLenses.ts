import type {RoomLens, ExitTreatment} from "./RoomLens";
import {defaultExitTreatment} from "./RoomLens";
import type IExit from "../reader/Exit";

/**
 * How a composite lens reconciles disagreeing children when both expose
 * `getExitTreatment`.
 *
 * - `"most-restrictive"` (default): `hidden` > `stub` > `full`. A single
 *   child that says hide wins. Safe default for stacked visibility filters.
 * - `"least-restrictive"`: `full` > `stub` > `hidden`. Useful when lenses are
 *   additive scopes ("show guild rooms OR quest rooms").
 * - `"first"`: the first child whose `getExitTreatment` returns non-undefined
 *   decides. Lets the caller pick a dominant lens by ordering.
 */
export type ExitConflictStrategy = "most-restrictive" | "least-restrictive" | "first";

export type ComposeOptions = {
    /** Defaults to `"most-restrictive"`. */
    exitStrategy?: ExitConflictStrategy;
    /**
     * AND (visibility must hold in every lens) vs OR (any lens may grant
     * visibility). Defaults to `"and"` — restrictive intersection.
     */
    visibility?: "and" | "or";
};

const TREATMENT_ORDER: Record<ExitTreatment, number> = {
    hidden: 2,
    stub: 1,
    full: 0,
};

function pickTreatment(
    a: ExitTreatment,
    b: ExitTreatment,
    strategy: ExitConflictStrategy,
): ExitTreatment {
    if (strategy === "first") return a;
    if (strategy === "least-restrictive") {
        return TREATMENT_ORDER[a] < TREATMENT_ORDER[b] ? a : b;
    }
    return TREATMENT_ORDER[a] > TREATMENT_ORDER[b] ? a : b;
}

/**
 * Combine multiple lenses into one. Visibility uses AND by default (a room
 * must pass every lens to render); exit treatment uses most-restrictive when
 * children disagree. Both behaviours are configurable via {@link ComposeOptions}.
 *
 * Composing zero lenses returns a no-op equivalent to `ALL_VISIBLE`.
 */
export function composeLenses(...lenses: RoomLens[]): RoomLens;
export function composeLenses(options: ComposeOptions, ...lenses: RoomLens[]): RoomLens;
export function composeLenses(
    first?: ComposeOptions | RoomLens,
    ...rest: RoomLens[]
): RoomLens {
    let options: ComposeOptions = {};
    let lenses: RoomLens[];
    if (first && typeof (first as RoomLens).isVisible === "function") {
        lenses = [first as RoomLens, ...rest];
    } else {
        options = (first as ComposeOptions) ?? {};
        lenses = rest;
    }

    const strategy = options.exitStrategy ?? "most-restrictive";
    const visibilityMode = options.visibility ?? "and";

    if (lenses.length === 0) {
        return {isVisible: () => true, getVersion: () => 0};
    }
    if (lenses.length === 1) {
        return lenses[0];
    }

    return {
        isVisible(room: MapData.Room) {
            if (visibilityMode === "or") {
                return lenses.some(l => l.isVisible(room));
            }
            return lenses.every(l => l.isVisible(room));
        },
        getExitTreatment(exit: IExit, a: MapData.Room, b: MapData.Room): ExitTreatment {
            let chosen: ExitTreatment | undefined;
            for (const lens of lenses) {
                const t = lens.getExitTreatment
                    ? lens.getExitTreatment(exit, a, b)
                    : defaultExitTreatment(lens, exit, a, b);
                if (chosen === undefined) {
                    chosen = t;
                } else {
                    chosen = pickTreatment(chosen, t, strategy);
                    if (strategy === "first") break;
                }
            }
            return chosen ?? "full";
        },
        getVersion() {
            // Sum of children's versions — any child bump bumps the composite.
            let v = 0;
            for (const lens of lenses) v += lens.getVersion();
            return v;
        },
    };
}
