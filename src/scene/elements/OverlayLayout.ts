/**
 * Pure shape builders for the built-in overlays exporters can stamp on top of
 * a scene: highlights, the position marker, and path overlays.
 *
 * Mirrors the geometry the {@link OverlayRenderer} produces against a
 * {@link DrawingBackend} — output as engine-agnostic {@link Shape}s so the
 * exporter pipeline can drive {@link buildDrawCommands} + per-engine
 * renderers without touching a backend.
 */

import type {
    HighlightData,
    PathOverlayData,
    PositionMarkerData,
} from "../OverlayStyle";
import type {Shape} from "../Shape";
import {hexToRgba} from "../../utils/color";

/**
 * Build a highlight ring around a room. Circle rooms get a single dashed
 * stroke; rectangular variants get four independent dashed lines (wrapped in
 * a group) so the corner dashes line up cleanly — each side's dash pattern
 * starts fresh at the corner instead of wrapping continuously around the
 * perimeter (same approach as the backend renderer).
 *
 * When the highlight carries more than one colour the ring is split into that
 * many equal pie wedges via {@link highlightWedgesToShape}.
 */
export function highlightToShape(data: HighlightData): Shape {
    if (data.colors.length > 1) {
        return highlightWedgesToShape(data);
    }

    const color = data.colors[0];
    const stroke = hexToRgba(color, data.strokeAlpha);
    const fill = data.fillAlpha > 0 ? hexToRgba(color, data.fillAlpha) : undefined;

    if (data.shape === "circle") {
        return {
            type: "circle",
            cx: data.cx, cy: data.cy,
            radius: data.size,
            paint: {
                fill,
                stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: data.dashEnabled,
            },
            layer: "overlay",
        };
    }

    // Rounded highlights can't be drawn as four corner-aligned straight lines —
    // the rounded corners would be lost. Emit a single rounded rect so the
    // stroke (and any fill) follow the corner radius.
    if (data.cornerRadius > 0) {
        return {
            type: "rect",
            x: data.cx - data.size,
            y: data.cy - data.size,
            width: data.size * 2,
            height: data.size * 2,
            cornerRadius: data.cornerRadius,
            paint: {
                fill,
                stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: data.dashEnabled,
            },
            layer: "overlay",
        };
    }

    // For rectangular highlights we draw four independent line segments so the
    // corner dashes line up cleanly. If the highlight has a fill, render an
    // underlying filled rect (with no stroke) so the dashed sides still sit on top.
    const x1 = data.cx - data.size;
    const y1 = data.cy - data.size;
    const x2 = data.cx + data.size;
    const y2 = data.cy + data.size;
    const sides: number[][] = [
        [x1, y1, x2, y1],
        [x2, y1, x2, y2],
        [x2, y2, x1, y2],
        [x1, y2, x1, y1],
    ];
    const children: Shape[] = [];
    if (fill) {
        children.push({
            type: "rect",
            x: x1, y: y1,
            width: data.size * 2,
            height: data.size * 2,
            cornerRadius: data.cornerRadius,
            paint: { fill },
            layer: "overlay",
        });
    }
    for (const points of sides) {
        children.push({
            type: "line",
            points,
            paint: {
                stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: data.dashEnabled,
            },
            lineCap: "butt",
            layer: "overlay",
        });
    }
    return {
        type: "group",
        x: 0, y: 0,
        children,
        layer: "overlay",
    };
}

/**
 * Split a highlight into N equal pie wedges — one per colour, starting at the
 * top and going clockwise. Each wedge gets an arc of the perimeter stroked in
 * its colour; when the highlight has a fill, each wedge is also a filled pie
 * slice. The perimeter follows the highlight boundary: a circle for circular
 * highlights, the square edges (corners included) for rectangular ones.
 */
function highlightWedgesToShape(data: HighlightData): Shape {
    const n = data.colors.length;
    const step = (Math.PI * 2) / n;
    const base = -Math.PI / 2;
    const children: Shape[] = [];

    for (let i = 0; i < n; i++) {
        const color = data.colors[i];
        const stroke = hexToRgba(color, data.strokeAlpha);
        const fill = data.fillAlpha > 0 ? hexToRgba(color, data.fillAlpha) : undefined;
        const a0 = base + i * step;
        const a1 = a0 + step;
        const boundary = highlightBoundaryPath(data, a0, a1);

        if (fill) {
            const vertices: number[] = [data.cx, data.cy];
            for (const [x, y] of boundary) vertices.push(x, y);
            children.push({
                type: "polygon",
                vertices,
                paint: { fill },
                layer: "overlay",
            });
        }

        const points: number[] = [];
        for (const [x, y] of boundary) points.push(x, y);
        children.push({
            type: "line",
            points,
            paint: {
                stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: data.dashEnabled,
            },
            lineCap: "butt",
            layer: "overlay",
        });
    }

    return {
        type: "group",
        x: 0, y: 0,
        children,
        layer: "overlay",
    };
}

/**
 * Point on the highlight boundary for a ray cast from the centre at `angle`:
 * the circle edge, the square edge, or — when the highlight has a corner radius
 * — the rounded-rect perimeter (flat edges with quarter-circle corners).
 */
function highlightBoundaryPoint(data: HighlightData, angle: number): [number, number] {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (data.shape === "circle") {
        return [data.cx + data.size * c, data.cy + data.size * s];
    }

    const half = data.size;
    const m = Math.max(Math.abs(c), Math.abs(s));
    // Where the ray meets the sharp square (relative to the centre).
    const px = (half / m) * c;
    const py = (half / m) * s;

    const r = Math.min(data.cornerRadius, half);
    const inset = half - r;
    // Past the straight section on both axes → inside a rounded corner; re-solve
    // the ray against that corner's quarter circle (centre at ±inset, radius r).
    if (r > 0 && Math.abs(px) > inset && Math.abs(py) > inset) {
        const ccx = Math.sign(px) * inset;
        const ccy = Math.sign(py) * inset;
        const dC = ccx * c + ccy * s;
        const cc = ccx * ccx + ccy * ccy;
        const t = dC + Math.sqrt(Math.max(0, dC * dC - (cc - r * r)));
        return [data.cx + t * c, data.cy + t * s];
    }
    return [data.cx + px, data.cy + py];
}

/**
 * Sample the highlight boundary from angle a0 to a1. Circles and rounded rects
 * are subdivided into short steps so the curves stay smooth; sharp squares only
 * insert the corner angles that fall inside the range so the polyline hugs the
 * corners instead of cutting across them.
 */
function highlightBoundaryPath(data: HighlightData, a0: number, a1: number): Array<[number, number]> {
    const angles: number[] = [a0];
    const rounded = data.shape !== "circle" && data.cornerRadius > 0;
    if (data.shape === "circle" || rounded) {
        // Finer steps for rounded rects so the small corner arcs read as curves.
        const step = rounded ? Math.PI / 36 : Math.PI / 18;
        const segments = Math.max(1, Math.ceil((a1 - a0) / step));
        for (let k = 1; k < segments; k++) {
            angles.push(a0 + ((a1 - a0) * k) / segments);
        }
    } else {
        // Square corners sit at 45° + k·90°; include those strictly inside (a0, a1).
        const quarter = Math.PI / 2;
        const first = Math.PI / 4;
        const start = Math.ceil((a0 - first) / quarter);
        const end = Math.floor((a1 - first) / quarter);
        for (let k = start; k <= end; k++) {
            const corner = first + k * quarter;
            if (corner > a0 + 1e-9 && corner < a1 - 1e-9) angles.push(corner);
        }
    }
    angles.push(a1);
    angles.sort((x, y) => x - y);
    return angles.map((a) => highlightBoundaryPoint(data, a));
}

/** Build the player-position marker. */
export function positionMarkerToShape(data: PositionMarkerData): Shape {
    const stroke = hexToRgba(data.strokeColor, data.strokeAlpha);
    const fill = data.fillAlpha > 0 ? hexToRgba(data.fillColor, data.fillAlpha) : undefined;

    if (data.shape === "circle") {
        return {
            type: "circle",
            cx: data.cx, cy: data.cy,
            radius: data.size,
            paint: {
                fill,
                stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: data.dashEnabled,
            },
            layer: "overlay",
        };
    }

    return {
        type: "rect",
        x: data.cx - data.size,
        y: data.cy - data.size,
        width: data.size * 2,
        height: data.size * 2,
        cornerRadius: data.cornerRadius,
        paint: {
            fill,
            stroke,
            strokeWidth: data.strokeWidth,
            dash: data.dash,
            dashEnabled: data.dashEnabled,
        },
        layer: "overlay",
    };
}

/** Build a path overlay: outline + inner colour line per segment, plus directional triangles. */
export function pathToShapes(data: PathOverlayData): Shape[] {
    const shapes: Shape[] = [];

    for (const seg of data.segments) {
        shapes.push({
            type: "line",
            points: seg.points,
            paint: {
                stroke: "black",
                strokeWidth: data.outlineWidth,
                alpha: 0.8,
            },
            lineCap: "round",
            lineJoin: "round",
            layer: "overlay",
        });
        shapes.push({
            type: "line",
            points: seg.points,
            paint: {
                stroke: data.color,
                strokeWidth: data.lineWidth,
                alpha: 0.8,
            },
            lineCap: "round",
            lineJoin: "round",
            layer: "overlay",
        });
    }

    for (const tri of data.triangles) {
        shapes.push({
            type: "polygon",
            vertices: tri.vertices,
            paint: {
                fill: data.color,
                stroke: "black",
                strokeWidth: data.outlineWidth / 4,
            },
            layer: "overlay",
        });
    }

    return shapes;
}
