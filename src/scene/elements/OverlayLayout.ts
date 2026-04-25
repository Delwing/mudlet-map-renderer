/**
 * Pure shape builders for the built-in overlays exporters can stamp on top of
 * a scene: highlights, the position marker, and path overlays.
 *
 * Mirrors the geometry the {@link OverlayRenderer} produces against a
 * {@link DrawingBackend} — output as engine-agnostic {@link Shape}s so the
 * exporter pipeline can drive {@link DrawCommandBuilder} + per-engine
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
 * stroke; rectangular variants get four independent dashed lines so the
 * corner dashes line up cleanly (same approach as the backend renderer).
 */
export function highlightToShapes(data: HighlightData): Shape[] {
    if (data.shape === "circle") {
        return [{
            type: "circle",
            cx: data.cx, cy: data.cy,
            radius: data.size,
            paint: {
                stroke: data.stroke,
                strokeWidth: data.strokeWidth,
                dash: data.dash,
                dashEnabled: true,
            },
            layer: "overlay",
        }];
    }

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
    return sides.map((points): Shape => ({
        type: "line",
        points,
        paint: {
            stroke: data.stroke,
            strokeWidth: data.strokeWidth,
            dash: data.dash,
        },
        lineCap: "butt",
        layer: "overlay",
    }));
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
