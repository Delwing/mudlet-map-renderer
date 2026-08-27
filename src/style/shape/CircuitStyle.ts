import type {Shape, Paint, GroupShape, LineShape, CircleShape} from "../../scene/Shape";
import type {Style, StyleContext} from "../Style";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Solder-mask green — the board itself. */
const MASK = "#0a2f22";
/** Darker mask used for drill holes and via barrels. */
const DRILL = "#05170f";
/** Pad edge — a darker gold rim around each plated pad. */
const PAD_EDGE = "#8a6d14";
/** Copper trace colour. */
const COPPER = "#b87333";
/** White silkscreen legend. */
const SILKSCREEN = "#e8e8e0";
/** Faint mask-green grid, barely there under the traces. */
const GRID = "rgba(58, 122, 96, 0.22)";

/** Gold pad base; lightness rides the room's own luminance. */
const GOLD_R = 201, GOLD_G = 162, GOLD_B = 39;
/** Darkest a pad gets — tarnished gold rather than black. */
const PAD_FLOOR = 0.45;

/** Trace width as a fraction of room size. */
const TRACE_WIDTH = 0.055;
/** Via radius as a fraction of room size. */
const VIA_RADIUS = 0.075;
/** Drill-hole radius as a fraction of room size. */
const DRILL_RADIUS = 0.13;

/**
 * Map a room colour onto plated gold: the pad keeps a hint of the original
 * (brighter rooms plate brighter) but the hue is pinned to gold so the whole
 * board reads as one material.
 */
function toPad(color: string): string {
    const c = parseRgb(color);
    if (!c) return formatRgb(GOLD_R, GOLD_G, GOLD_B);
    const k = PAD_FLOOR + luminance(c) * (1 - PAD_FLOOR);
    return formatRgb(
        Math.round(GOLD_R * k),
        Math.round(GOLD_G * k),
        Math.round(GOLD_B * k),
        c.a,
    );
}

function padPaint(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toPad),
        stroke: paint.stroke ? PAD_EDGE : paint.stroke,
    };
}

/** Copper trace — thicker than the source exit, always solid and round. */
function trace(line: LineShape, ctx: StyleContext): LineShape {
    return {
        ...line,
        paint: {
            ...line.paint,
            stroke: COPPER,
            strokeWidth: Math.max(line.paint.strokeWidth ?? 0, ctx.roomSize * TRACE_WIDTH),
            dash: undefined,
            dashEnabled: undefined,
        },
        lineCap: "round",
        lineJoin: "round",
    };
}

/**
 * A via at the trace midpoint — dark barrel with a copper annulus, drawn as a
 * single stroked circle so each trace costs exactly one extra shape (the same
 * budget as Neon's glow pass). Inherits the source line's layer, which is
 * `undefined` for a group child (it takes the group's) and `"link"` for a
 * standalone connector.
 */
function via(line: LineShape, ctx: StyleContext): CircleShape | null {
    const points = line.points;
    if (points.length < 4) return null;
    const r = ctx.roomSize * VIA_RADIUS;
    return {
        type: "circle",
        cx: (points[0] + points[points.length - 2]) / 2,
        cy: (points[1] + points[points.length - 1]) / 2,
        radius: r,
        paint: {fill: DRILL, stroke: COPPER, strokeWidth: r * 0.55},
        layer: line.layer,
    };
}

/** Drill hole at the centre of a room's pad. */
function drillHole(ctx: StyleContext): CircleShape {
    const rs = ctx.roomSize;
    return {
        type: "circle",
        cx: rs / 2,
        cy: rs / 2,
        radius: rs * DRILL_RADIUS,
        paint: {fill: DRILL, stroke: PAD_EDGE, strokeWidth: rs * 0.02},
    };
}

/**
 * Style an exit group. The scene emits each exit as a group on the link layer
 * whose children carry no layer of their own, so the group is the only place
 * the link context is known. Only the first line in a group gets a via —
 * one per exit, not one per arrow segment.
 */
function linkGroup(group: GroupShape, ctx: StyleContext): GroupShape {
    const children: Shape[] = [];
    let vialess = true;
    for (const child of group.children) {
        if (child.type === "polygon") {
            // Arrowheads are part of the trace, not a pad.
            children.push({
                ...child,
                paint: {
                    ...child.paint,
                    fill: child.paint.fill !== undefined ? COPPER : undefined,
                    stroke: child.paint.stroke !== undefined ? COPPER : undefined,
                },
            });
            continue;
        }
        if (child.type !== "line" || child.grid || !child.paint.stroke) {
            children.push(child);
            continue;
        }
        children.push(trace(child, ctx));
        if (vialess) {
            const v = via(child, ctx);
            if (v) {
                children.push(v);
                vialess = false;
            }
        }
    }
    return {...group, children};
}

/**
 * Printed-circuit-board aesthetic as a {@link Style} — gold pads and copper
 * traces on a dark solder mask.
 *
 * - Room fills plate to gold, luminance-modulated so brighter rooms stay
 *   brighter; borders become a darker pad rim. Each room group gains a drill
 *   hole, slotted above the pad but below the room character.
 * - Exits become copper traces, one via per exit at its midpoint, arrowheads
 *   in copper too.
 * - Grid drops to a faint mask green; text becomes white silkscreen.
 * - Images pass through unchanged.
 */
export const circuitShapeStyle: Style = {
    transform(shape: Shape, ctx): Shape | Shape[] {
        switch (shape.type) {
            case "group": {
                if (shape.layer === "link") return linkGroup(shape, ctx);
                if (shape.hit?.kind !== "room") return shape;
                // Slot the hole above the pad but below the room character, or
                // the legend disappears down it.
                const firstText = shape.children.findIndex(c => c.type === "text");
                const at = firstText === -1 ? shape.children.length : firstText;
                const group: GroupShape = {
                    ...shape,
                    children: [
                        ...shape.children.slice(0, at),
                        drillHole(ctx),
                        ...shape.children.slice(at),
                    ],
                };
                return group;
            }
            case "rect":
            case "circle":
            case "polygon":
                return {...shape, paint: padPaint(shape.paint)};
            case "line": {
                if (shape.grid) {
                    return {...shape, paint: {...shape.paint, stroke: GRID}};
                }
                if (!shape.paint.stroke) return shape;
                const copper = trace(shape, ctx);
                // Standalone link lines (neighbour-area spill connectors) get
                // their own via; exits nested in a group go through linkGroup.
                if (shape.layer !== "link") return copper;
                const v = via(shape, ctx);
                return v ? [copper, v] : copper;
            }
            case "text":
                return {...shape, fill: SILKSCREEN};
            case "image":
                return shape;
        }
    },
};

/** Board colour, exported so callers can match the canvas to the solder mask. */
export const circuitBoardColor = MASK;
