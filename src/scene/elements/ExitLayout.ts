import type MapReader from "../../reader/MapReader";
import type {Settings} from "../../types/Settings";
import type {ExitDrawArrow, ExitDrawData} from "../../ExitRenderer";
import {computeInnerExits} from "../InnerExitStyle";
import type {GroupShape, PolygonShape, Shape} from "../Shape";

export interface DepthOffset {
    x: number;
    y: number;
}

/**
 * Pure layout for a room's inner exits (up/down/in/out triangles). Returns
 * polygon shapes in coordinates relative to the room's top-left, ready to
 * drop into the room's GroupShape as children.
 */
export function layoutInnerExits(
    room: MapData.Room,
    mapReader: MapReader,
    settings: Settings,
): PolygonShape[] {
    const rs = settings.roomSize;
    const gx = room.x - rs / 2;
    const gy = room.y - rs / 2;
    const {triangles} = computeInnerExits(room, mapReader, settings);

    return triangles.map(tri => {
        const relVertices: number[] = new Array(tri.vertices.length);
        for (let i = 0; i < tri.vertices.length; i += 2) {
            relVertices[i] = tri.vertices[i] - gx;
            relVertices[i + 1] = tri.vertices[i + 1] - gy;
        }
        return {
            type: "polygon",
            vertices: relVertices,
            paint: {
                fill: tri.fill,
                stroke: tri.stroke,
                strokeWidth: tri.strokeWidth,
            },
        };
    });
}

/**
 * Pure layout for a single inter-room link exit, given its computed
 * {@link ExitDrawData}. Returns a {@link GroupShape} positioned at the
 * style's `depthOffset` (zero for flat styles, non-zero for Isometric where
 * exits attach to the cube base instead of the top face).
 */
export function layoutLinkExit(data: ExitDrawData, depthOffset: DepthOffset = {x: 0, y: 0}): GroupShape {
    const children: Shape[] = [];

    for (const line of data.lines) {
        children.push({
            type: "line",
            points: line.points,
            paint: {
                stroke: line.stroke,
                strokeWidth: line.strokeWidth,
                dash: line.dash,
            },
        });
    }

    for (const arrow of data.arrows) {
        appendArrowShapes(children, arrow);
    }

    for (const door of data.doors) {
        children.push({
            type: "rect",
            x: door.x,
            y: door.y,
            width: door.width,
            height: door.height,
            paint: {
                stroke: door.stroke,
                strokeWidth: door.strokeWidth,
            },
        });
    }

    return {
        type: "group",
        x: depthOffset.x,
        y: depthOffset.y,
        layer: "link",
        children,
    };
}

function appendArrowShapes(out: Shape[], arrow: ExitDrawArrow): void {
    out.push({
        type: "line",
        points: arrow.points,
        paint: {
            stroke: arrow.stroke,
            strokeWidth: arrow.strokeWidth,
            dash: arrow.dash,
        },
    });

    const lastIdx = arrow.points.length - 2;
    const tipX = arrow.points[lastIdx];
    const tipY = arrow.points[lastIdx + 1];
    const prevX = arrow.points[lastIdx - 2];
    const prevY = arrow.points[lastIdx - 1];
    const angle = Math.atan2(tipY - prevY, tipX - prevX);
    const pl = arrow.pointerLength;
    const pw = arrow.pointerWidth / 2;
    const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
    const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
    const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
    const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));

    out.push({
        type: "polygon",
        vertices: [tipX, tipY, x1, y1, x2, y2],
        paint: {
            fill: arrow.fill,
            stroke: arrow.stroke,
            strokeWidth: arrow.strokeWidth,
        },
    });
}
