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
 */
export function highlightToShape(data: HighlightData): Shape {
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
