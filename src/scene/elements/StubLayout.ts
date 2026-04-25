import type {Settings} from "../../types/Settings";
import {computeStubs} from "../StubStyle";
import type {DepthOffset} from "./ExitLayout";
import type {GroupShape} from "../Shape";

export interface StubLayoutOptions {
    /** Cartesian offset applied to each stub group (style-driven). */
    depthOffset?: DepthOffset;
    /** Stroke override (used by highlighted-room overlays). */
    colorOverride?: string;
}

/**
 * Pure layout for a room's stub indicators (the short lines for each entry
 * in `room.stubs`). Returns one {@link GroupShape} per stub, positioned at
 * the style's depth offset.
 */
export function layoutStubs(
    room: MapData.Room,
    settings: Settings,
    options: StubLayoutOptions = {},
): GroupShape[] {
    const depthOffset = options.depthOffset ?? {x: 0, y: 0};

    return computeStubs(room, settings, options.colorOverride).map(stub => ({
        type: "group",
        x: depthOffset.x,
        y: depthOffset.y,
        layer: "link",
        hit: {
            kind: "stub",
            id: `${stub.roomId}:${stub.direction}`,
            payload: stub,
        },
        children: [{
            type: "line",
            points: [stub.x1, stub.y1, stub.x2, stub.y2],
            paint: {
                stroke: stub.stroke,
                strokeWidth: stub.strokeWidth,
            },
        }],
    }));
}
