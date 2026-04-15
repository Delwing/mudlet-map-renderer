import type {Settings} from "../types/Settings";
import {movePoint, movePointCircle, movePointRoundedRect} from "../directions";

const dirNumbers: Record<number, MapData.direction> = {
    1: "north", 2: "northeast", 3: "northwest", 4: "east", 5: "west",
    6: "south", 7: "southeast", 8: "southwest", 9: "up", 10: "down",
    11: "in", 12: "out",
};

export type StubData = {
    x1: number; y1: number;
    x2: number; y2: number;
    stroke: string;
    strokeWidth: number;
};

function getRoomEdgePoint(settings: Settings, x: number, y: number, direction: MapData.direction, distance: number) {
    if (settings.roomShape === "circle") return movePointCircle(x, y, direction, distance);
    if (settings.roomShape === "roundedRectangle") return movePointRoundedRect(x, y, direction, distance, settings.roomSize * 0.2);
    return movePoint(x, y, direction, distance);
}

/**
 * Compute stub line data for a room's one-way exit indicators.
 */
export function computeStubs(room: MapData.Room, settings: Settings, colorOverride?: string): StubData[] {
    const stubs: StubData[] = [];
    for (const stub of room.stubs) {
        const direction = dirNumbers[stub];
        if (!direction) continue;
        const start = getRoomEdgePoint(settings, room.x, room.y, direction, settings.roomSize / 2);
        const end = movePoint(room.x, room.y, direction, settings.roomSize / 2 + 0.5);
        stubs.push({
            x1: start.x, y1: start.y,
            x2: end.x, y2: end.y,
            stroke: colorOverride ?? settings.lineColor,
            strokeWidth: settings.lineWidth,
        });
    }
    return stubs;
}
