import type {Shape, Paint, GroupShape, LineShape} from "../../scene/Shape";
import type {Style, StyleContext} from "../Style";
import {hslToRgbString, luminance, mapFill, parseRgb} from "./paintMap";

/** Bright phosphor green — every stroke and glyph on the screen. */
const PHOSPHOR = "#33ff66";
/** Dim phosphor for the grid, so it reads as screen texture not content. */
const GRID = "rgba(51, 255, 102, 0.1)";
/** Scanline overlay drawn across each room cell. */
const SCANLINE = "rgba(51, 255, 102, 0.14)";

/** Hue every fill is pinned to — CRT green regardless of the room's env. */
const SCREEN_HUE = 135;
/** Fill saturation; high enough to stay green, low enough to stay dark. */
const SCREEN_SAT = 0.6;
/** Fill lightness band — rooms glow between these, never washing out. */
const MIN_LIGHT = 0.05;
const LIGHT_RANGE = 0.16;

/** Number of scanlines drawn across each room cell. */
const SCANLINES = 2;
/** Scanline thickness as a fraction of room size. */
const SCANLINE_WIDTH = 0.045;
/** Half-gap between the two rails of an exit, as a fraction of room size. */
const RAIL_GAP = 0.045;
/** Rail thickness as a fraction of room size. */
const RAIL_WIDTH = 0.018;

/**
 * Collapse any colour to the phosphor ramp: hue and saturation are fixed,
 * only lightness carries the original — so a colour map becomes a brightness
 * map, which is exactly what a monochrome CRT does.
 */
function toScreen(color: string): string {
    const c = parseRgb(color);
    if (!c) return hslToRgbString(SCREEN_HUE, SCREEN_SAT, MIN_LIGHT);
    return hslToRgbString(
        SCREEN_HUE,
        SCREEN_SAT,
        MIN_LIGHT + luminance(c) * LIGHT_RANGE,
        c.a,
    );
}

function screenPaint(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toScreen),
        stroke: paint.stroke ? PHOSPHOR : paint.stroke,
    };
}

/** Horizontal scanlines across a room cell, in the group's local frame. */
function scanlines(ctx: StyleContext): LineShape[] {
    const rs = ctx.roomSize;
    const out: LineShape[] = [];
    for (let i = 1; i <= SCANLINES; i++) {
        const y = (rs * i) / (SCANLINES + 1);
        out.push({
            type: "line",
            points: [0, y, rs, y],
            paint: {stroke: SCANLINE, strokeWidth: rs * SCANLINE_WIDTH},
        });
    }
    return out;
}

/**
 * Split a straight exit into the two parallel rails of a box-drawing "═".
 * Only 2-point lines split; a polyline keeps one rail, since offsetting a
 * bend correctly needs mitre maths the look doesn't earn.
 */
function rails(shape: LineShape, ctx: StyleContext): LineShape | LineShape[] {
    const single: LineShape = {
        ...shape,
        paint: {...shape.paint, stroke: PHOSPHOR},
    };
    if (shape.points.length !== 4) return single;
    const [x0, y0, x1, y1] = shape.points;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) return single;

    const rs = ctx.roomSize;
    // Unit normal to the run; the rails sit one gap either side of it.
    const nx = (-dy / len) * rs * RAIL_GAP;
    const ny = (dx / len) * rs * RAIL_GAP;
    const paint: Paint = {
        ...shape.paint,
        stroke: PHOSPHOR,
        strokeWidth: rs * RAIL_WIDTH,
    };
    return [
        {...shape, points: [x0 + nx, y0 + ny, x1 + nx, y1 + ny], paint},
        {...shape, points: [x0 - nx, y0 - ny, x1 - nx, y1 - ny], paint},
    ];
}

/**
 * Style an exit group. The scene emits each exit as a group on the link layer
 * whose children carry no layer of their own, so the group is the only place
 * the link context is known.
 */
function linkGroup(group: GroupShape, ctx: StyleContext): GroupShape {
    const children: Shape[] = [];
    for (const child of group.children) {
        if (child.type !== "line" || child.grid || !child.paint.stroke) {
            children.push(child);
            continue;
        }
        const out = rails(child, ctx);
        if (Array.isArray(out)) children.push(...out);
        else children.push(out);
    }
    return {...group, children};
}

/**
 * Terminal / phosphor-CRT aesthetic as a {@link Style} — the map as it would
 * look on the green screen the MUD came from.
 *
 * - Every fill collapses to one green ramp: hue and saturation fixed, only
 *   the room's luminance surviving, so colour becomes brightness.
 * - Strokes and text go bright phosphor; each room cell gains
 *   {@link SCANLINES} translucent scanlines, slotted below the room character.
 * - Straight exits split into the two parallel rails of a box-drawing rule;
 *   bent exits keep a single rail.
 * - Grid drops to dim phosphor; images pass through unchanged.
 */
export const terminalShapeStyle: Style = {
    transform(shape: Shape, ctx): Shape | Shape[] {
        switch (shape.type) {
            case "group": {
                if (shape.layer === "link") return linkGroup(shape, ctx);
                if (shape.hit?.kind !== "room") return shape;
                const firstText = shape.children.findIndex(c => c.type === "text");
                const at = firstText === -1 ? shape.children.length : firstText;
                const group: GroupShape = {
                    ...shape,
                    children: [
                        ...shape.children.slice(0, at),
                        ...scanlines(ctx),
                        ...shape.children.slice(at),
                    ],
                };
                return group;
            }
            case "rect":
            case "circle":
            case "polygon":
                return {...shape, paint: screenPaint(shape.paint)};
            case "line":
                if (shape.grid) {
                    return {...shape, paint: {...shape.paint, stroke: GRID}};
                }
                if (!shape.paint.stroke) return shape;
                // Standalone link lines (neighbour-area spill connectors);
                // exits nested in a group are handled by linkGroup above.
                if (shape.layer !== "link") {
                    return {...shape, paint: {...shape.paint, stroke: PHOSPHOR}};
                }
                return rails(shape, ctx);
            case "text":
                return {...shape, fill: PHOSPHOR};
            case "image":
                return shape;
        }
    },
};
