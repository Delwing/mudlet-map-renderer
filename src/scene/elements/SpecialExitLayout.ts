import type {Settings} from "../../types/Settings";
import {computeSpecialExits} from "../SpecialExitStyle";
import type {SpecialExitData} from "../SpecialExitStyle";
import type {GroupShape, Shape} from "../Shape";

export interface SpecialExitLayoutOptions {
    /** Stroke override (used by highlighted-room overlays). */
    colorOverride?: string;
}

/**
 * Build a {@link GroupShape} for a single already-computed special-exit
 * record. Lets callers compute the data once (e.g. ScenePipeline records
 * `drawnSpecialExits` for hit-testing) and reuse it for layout.
 */
export function specialExitToShape(se: SpecialExitData, roomId: number): GroupShape {
    const children: Shape[] = [];

    children.push({
        type: "line",
        points: se.line.points,
        paint: {
            stroke: se.line.stroke,
            strokeWidth: se.line.strokeWidth,
            dash: se.line.dash,
        },
    });

    if (se.arrow) {
        const a = se.arrow;
        children.push({
            type: "polygon",
            vertices: [a.tipX, a.tipY, a.x1, a.y1, a.x2, a.y2],
            paint: {
                fill: a.fill,
                stroke: a.stroke,
                strokeWidth: a.strokeWidth,
            },
        });
    }

    if (se.door) {
        const d = se.door;
        children.push({
            type: "rect",
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
            paint: {
                stroke: d.stroke,
                strokeWidth: d.strokeWidth,
            },
        });
    }

    return {
        type: "group",
        x: 0,
        y: 0,
        layer: "link",
        hit: {
            kind: "specialExit",
            id: `${roomId}:${se.dir}`,
            payload: {roomId, exitName: se.dir},
        },
        children,
    };
}

/**
 * Pure layout for a room's custom-line special exits. Returns one
 * {@link GroupShape} per special exit at the world origin; the active
 * {@link Style} applies any depth offset for the link layer.
 */
export function layoutSpecialExits(
    room: MapData.Room,
    settings: Settings,
    options: SpecialExitLayoutOptions = {},
): GroupShape[] {
    return computeSpecialExits(room, settings, options.colorOverride)
        .map(se => specialExitToShape(se, room.id));
}
