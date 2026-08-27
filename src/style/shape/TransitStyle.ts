import type {Shape, Paint, FillStyle, GroupShape, LineShape, CircleShape, TextShape} from "../../scene/Shape";
import type {Style, StyleContext} from "../Style";
import {hslToRgbString, parseRgb, rgbToHsl} from "./paintMap";

/**
 * Dark slate ink — station rings fall back to it when a room has no usable
 * hue, and it inks the labels.
 */
const INK = "#16202c";
/** Station core — the white disc every stop is drawn on. */
const STATION_CORE = "#ffffff";
/** Faint grid so the routes stay the loudest thing on the canvas. */
const GRID = "rgba(120, 136, 156, 0.18)";

/**
 * Classic four-colour route palette, indexed by the segment's angle bucket:
 * east–west, NE–SW diagonal, north–south, NW–SE diagonal. Mudlet exits run on
 * those four axes, so bucketing by angle gives every run of same-direction
 * track one consistent colour — the way a real transit line reads.
 */
const ROUTES = ["#d1495b", "#e07a20", "#1f6feb", "#2a9d5c"];

/** Station disc radius as a fraction of room size. */
const STATION_RADIUS = 0.3;
/** Interchange discs are fatter so junctions pop out of the network. */
const INTERCHANGE_RADIUS = 0.42;
/** Exits (+ special exits) at or above this count make a room an interchange. */
const INTERCHANGE_DEGREE = 3;
/** Station ring thickness as a fraction of room size. */
const RING_WIDTH = 0.12;
/** Route line thickness as a fraction of room size. */
const ROUTE_WIDTH = 0.2;

/** Saturate a room colour into a route-map ring: vivid, mid-dark, hue kept. */
function toRing(color: string): string {
    const c = parseRgb(color);
    if (!c) return INK;
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    // Grey rooms have no hue worth boosting — they get the slate ink instead.
    if (s < 0.08) return INK;
    return hslToRgbString(h, Math.max(s, 0.62), Math.min(0.52, Math.max(0.36, l)), c.a);
}

/** Representative colour for a fill — the midpoint stop of a gradient. */
function fillColor(fill: FillStyle | undefined): string | undefined {
    if (fill === undefined) return undefined;
    if (typeof fill === "string") return fill;
    if (fill.stops.length === 0) return undefined;
    return fill.stops[Math.floor(fill.stops.length / 2)].color;
}

/** The room's own colour, read off the first filled body child in its group. */
function bodyColor(children: Shape[]): string | undefined {
    for (const child of children) {
        if (child.type !== "rect" && child.type !== "circle" && child.type !== "polygon") continue;
        const c = fillColor(child.paint.fill);
        if (c) return c;
    }
    return undefined;
}

/** Number of ways out of a room — drives the interchange test. */
function exitDegree(payload: unknown): number {
    const room = payload as {
        exits?: Record<string, unknown>;
        specialExits?: Record<string, unknown>;
    } | undefined;
    if (!room || typeof room !== "object") return 0;
    return Object.keys(room.exits ?? {}).length
        + Object.keys(room.specialExits ?? {}).length;
}

/**
 * Route colour for a polyline, bucketed by the angle of its overall run
 * (first vertex → last). Undirected: a segment and its reverse get the same
 * colour, so a two-way exit drawn either way round stays on one route.
 */
function routeColor(points: number[]): string {
    if (points.length < 4) return ROUTES[0];
    const dx = points[points.length - 2] - points[0];
    const dy = points[points.length - 1] - points[1];
    if (dx === 0 && dy === 0) return ROUTES[0];
    // Fold to [0, 180) so direction doesn't matter, then bucket into quarters
    // offset by half a bucket so the axes land in the middle of their band.
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    deg = ((deg % 180) + 180) % 180;
    const bucket = Math.floor((((deg + 22.5) % 180) / 180) * ROUTES.length);
    return ROUTES[bucket % ROUTES.length];
}

/** Rebuild a room group as a transit station: white disc, coloured ring. */
function station(group: GroupShape, ctx: StyleContext): GroupShape {
    const rs = ctx.roomSize;
    const ring = toRing(bodyColor(group.children) ?? INK);
    const interchange = exitDegree(group.hit?.payload) >= INTERCHANGE_DEGREE;
    const radius = rs * (interchange ? INTERCHANGE_RADIUS : STATION_RADIUS);

    const disc: CircleShape = {
        type: "circle",
        cx: rs / 2,
        cy: rs / 2,
        radius,
        paint: {fill: STATION_CORE, stroke: ring, strokeWidth: rs * RING_WIDTH},
    };

    // Keep the room character so stations stay identifiable; drop the body,
    // emboss, and border children the disc replaces.
    const labels = group.children.filter((c): c is TextShape => c.type === "text");
    return {...group, children: [disc, ...labels.map(t => ({...t, fill: INK}))]};
}

/** Fatten an exit into a rounded route line coloured by its axis. */
function route(line: LineShape, ctx: StyleContext): LineShape {
    return {
        ...line,
        paint: {
            ...line.paint,
            stroke: routeColor(line.points),
            strokeWidth: Math.max(line.paint.strokeWidth ?? 0, ctx.roomSize * ROUTE_WIDTH),
            // Routes are solid track — a dashed metro line reads as a fault.
            dash: undefined,
            dashEnabled: undefined,
        },
        lineCap: "round",
        lineJoin: "round",
    };
}

/**
 * Style an exit group. The scene emits each exit as a group on the link layer
 * whose children (connector line, arrowhead, door) carry no layer of their
 * own, so the per-shape branch cannot recognise them — the group is the only
 * place the link context is known.
 */
function linkGroup(group: GroupShape, ctx: StyleContext): GroupShape {
    let ink: string | undefined;
    const children = group.children.map(child => {
        if (child.type !== "line" || child.grid || !child.paint.stroke) return child;
        const styled = route(child, ctx);
        ink ??= styled.paint.stroke;
        return styled;
    });

    // Arrowheads ride the colour of the route they cap, or they read as a
    // different line crossing the junction.
    if (ink !== undefined) {
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.type !== "polygon") continue;
            children[i] = {
                ...child,
                paint: {
                    ...child.paint,
                    fill: child.paint.fill !== undefined ? ink : undefined,
                    stroke: child.paint.stroke !== undefined ? ink : undefined,
                },
            };
        }
    }
    return {...group, children};
}

/**
 * Transit / metro-map aesthetic as a {@link Style}. Inverts the usual
 * hierarchy: connections become the subject and rooms shrink to stations.
 *
 * - Room groups collapse to a white station disc ringed in the room's own
 *   colour (saturated into a route-map tone; grey rooms take slate ink).
 *   Rooms with {@link INTERCHANGE_DEGREE}+ exits get a fatter interchange
 *   disc, read straight off the room payload the scene attached.
 * - Exits become fat rounded-cap routes coloured by their axis, so every run
 *   of same-direction track shares one route colour, and their arrowheads
 *   follow suit.
 * - Grid drops to a faint wash; text inks dark slate.
 * - Images pass through unchanged.
 */
export const transitShapeStyle: Style = {
    transform(shape: Shape, ctx): Shape | Shape[] {
        switch (shape.type) {
            case "group":
                if (shape.hit?.kind === "room") return station(shape, ctx);
                if (shape.layer === "link") return linkGroup(shape, ctx);
                return shape;
            case "line":
                if (shape.grid) {
                    return {...shape, paint: {...shape.paint, stroke: GRID}};
                }
                // Standalone link lines (neighbour-area spill connectors);
                // exits nested in a group are handled by linkGroup above.
                if (shape.layer !== "link" || !shape.paint.stroke) return shape;
                return route(shape, ctx);
            case "text":
                return {...shape, fill: INK};
            case "rect":
            case "circle":
            case "polygon":
            case "image":
                // Room bodies are discarded by the group branch above; anything
                // else here is label/decoration geometry that keeps its paint.
                return shape;
        }
    },
};
