import type {DrawingBackend, GroupNode} from "../backend/DrawingBackend";
import type {HighlightData, PositionMarkerData, PathOverlayData} from "./OverlayStyle";
import type {ExitDrawData, ExitDrawArrow} from "../ExitRenderer";
import type {SpecialExitData} from "./SpecialExitStyle";
import type {StubData} from "./StubStyle";
import type {TriangleData} from "./InnerExitStyle";
import {hexToRgba} from "../utils/color";

/**
 * Render a highlight shape through DrawingBackend.
 */
export function renderHighlight(backend: DrawingBackend, data: HighlightData): GroupNode {
    const group = backend.createGroup(0, 0);
    if (data.shape === 'circle') {
        backend.addCircle(group, {
            cx: data.cx, cy: data.cy, radius: data.size,
            stroke: data.stroke, strokeWidth: data.strokeWidth,
            dash: data.dash, dashEnabled: true,
        });
    } else {
        // Draw 4 individual dashed lines so corners stay clean.
        const x1 = data.cx - data.size;
        const y1 = data.cy - data.size;
        const x2 = data.cx + data.size;
        const y2 = data.cy + data.size;
        const sides: number[][] = [
            [x1, y1, x2, y1], // top
            [x2, y1, x2, y2], // right
            [x2, y2, x1, y2], // bottom
            [x1, y2, x1, y1], // left
        ];
        for (const pts of sides) {
            backend.addLine(group, {
                points: pts,
                stroke: data.stroke, strokeWidth: data.strokeWidth,
                dash: data.dash,
                lineCap: 'butt',
            });
        }
    }
    return group;
}

/**
 * Render a position marker through DrawingBackend.
 */
export function renderPositionMarker(backend: DrawingBackend, data: PositionMarkerData): GroupNode {
    const group = backend.createGroup(0, 0);
    const strokeColor = hexToRgba(data.strokeColor, data.strokeAlpha);
    const fillColor = data.fillAlpha > 0 ? hexToRgba(data.fillColor, data.fillAlpha) : undefined;
    if (data.shape === 'circle') {
        backend.addCircle(group, {
            cx: data.cx, cy: data.cy, radius: data.size,
            fill: fillColor, stroke: strokeColor,
            strokeWidth: data.strokeWidth,
            dash: data.dash, dashEnabled: data.dashEnabled,
        });
    } else {
        backend.addRect(group, {
            x: data.cx - data.size, y: data.cy - data.size,
            width: data.size * 2, height: data.size * 2,
            fill: fillColor, stroke: strokeColor,
            strokeWidth: data.strokeWidth,
            cornerRadius: data.cornerRadius,
            dash: data.dash, dashEnabled: data.dashEnabled,
        });
    }
    return group;
}

/**
 * Render a path overlay (segments + directional triangles) through DrawingBackend.
 */
export function renderPathOverlay(backend: DrawingBackend, data: PathOverlayData): GroupNode {
    const group = backend.createGroup(0, 0);
    for (const seg of data.segments) {
        // Outline
        backend.addLine(group, {
            points: seg.points,
            stroke: 'black', strokeWidth: data.outlineWidth,
            lineCap: 'round', lineJoin: 'round', alpha: 0.8,
        });
        // Inner colored line
        backend.addLine(group, {
            points: seg.points,
            stroke: data.color, strokeWidth: data.lineWidth,
            lineCap: 'round', lineJoin: 'round', alpha: 0.8,
        });
    }
    for (const tri of data.triangles) {
        backend.addPolygon(group, {
            vertices: tri.vertices,
            fill: data.color, stroke: 'black',
            strokeWidth: data.outlineWidth / 4,
        });
    }
    return group;
}

/**
 * Render ExitDrawData through DrawingBackend (replaces renderWithColor Konva method).
 */
export function renderExitDrawData(backend: DrawingBackend, data: ExitDrawData): GroupNode {
    const group = backend.createGroup(0, 0);
    for (const line of data.lines) {
        backend.addLine(group, {
            points: line.points,
            stroke: line.stroke, strokeWidth: line.strokeWidth,
            dash: line.dash,
        });
    }
    for (const arrow of data.arrows) {
        renderArrowToBackend(backend, group, arrow);
    }
    for (const door of data.doors) {
        backend.addRect(group, {
            x: door.x, y: door.y,
            width: door.width, height: door.height,
            stroke: door.stroke, strokeWidth: door.strokeWidth,
        });
    }
    return group;
}

function renderArrowToBackend(backend: DrawingBackend, group: GroupNode, arrow: ExitDrawArrow) {
    // Line part
    backend.addLine(group, {
        points: arrow.points,
        stroke: arrow.stroke, strokeWidth: arrow.strokeWidth,
        dash: arrow.dash,
    });
    // Arrowhead triangle
    const lastIdx = arrow.points.length - 2;
    const tipX = arrow.points[lastIdx], tipY = arrow.points[lastIdx + 1];
    const prevX = arrow.points[lastIdx - 2], prevY = arrow.points[lastIdx - 1];
    const angle = Math.atan2(tipY - prevY, tipX - prevX);
    const pl = arrow.pointerLength, pw = arrow.pointerWidth / 2;
    const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
    const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
    const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
    const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));
    backend.addPolygon(group, {
        vertices: [tipX, tipY, x1, y1, x2, y2],
        fill: arrow.fill, stroke: arrow.stroke,
        strokeWidth: arrow.strokeWidth,
    });
}

/**
 * Render special exits through DrawingBackend.
 */
export function renderSpecialExitGroup(backend: DrawingBackend, se: SpecialExitData): GroupNode {
    const group = backend.createGroup(0, 0);
    backend.addLine(group, {
        points: se.line.points,
        stroke: se.line.stroke, strokeWidth: se.line.strokeWidth,
        dash: se.line.dash,
    });
    if (se.arrow) {
        backend.addPolygon(group, {
            vertices: [se.arrow.tipX, se.arrow.tipY, se.arrow.x1, se.arrow.y1, se.arrow.x2, se.arrow.y2],
            fill: se.arrow.fill, stroke: se.arrow.stroke,
            strokeWidth: se.arrow.strokeWidth,
        });
    }
    if (se.door) {
        backend.addRect(group, {
            x: se.door.x, y: se.door.y,
            width: se.door.width, height: se.door.height,
            stroke: se.door.stroke, strokeWidth: se.door.strokeWidth,
        });
    }
    return group;
}

/**
 * Render stub lines through DrawingBackend into a group (at absolute coordinates).
 */
export function renderStubsGroup(backend: DrawingBackend, stubs: StubData[]): GroupNode {
    const group = backend.createGroup(0, 0);
    for (const stub of stubs) {
        backend.addLine(group, {
            points: [stub.x1, stub.y1, stub.x2, stub.y2],
            stroke: stub.stroke, strokeWidth: stub.strokeWidth,
        });
    }
    return group;
}

/**
 * Render inner exit triangles through DrawingBackend into a group (at absolute coordinates).
 */
export function renderInnerExitsGroup(backend: DrawingBackend, triangles: TriangleData[]): GroupNode {
    const group = backend.createGroup(0, 0);
    for (const tri of triangles) {
        backend.addPolygon(group, {
            vertices: tri.vertices,
            fill: tri.fill, stroke: tri.stroke,
            strokeWidth: tri.strokeWidth,
        });
    }
    return group;
}
