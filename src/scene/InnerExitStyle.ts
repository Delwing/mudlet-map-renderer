import type {Settings} from "../types/Settings";
import type {IMapReader} from "../reader/MapReader";
import {movePoint} from "../directions";

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

export type TriangleData = {
    cx: number;
    cy: number;
    /** Pre-computed polygon vertices (3 pairs of x,y) */
    vertices: number[];
    fill: string;
    stroke: string;
    strokeWidth: number;
};

export type InnerExitData = {
    triangles: TriangleData[];
};

function computeTriangleVertices(cx: number, cy: number, radius: number, rotationDeg: number): number[] {
    const scaleX = 1.4, scaleY = 0.8;
    const angleRad = rotationDeg * Math.PI / 180;
    const vertices: number[] = [];
    for (let i = 0; i < 3; i++) {
        const a = (2 * Math.PI * i / 3) - Math.PI / 2;
        const px = Math.cos(a) * radius * scaleX;
        const py = Math.sin(a) * radius * scaleY;
        const rx = px * Math.cos(angleRad) - py * Math.sin(angleRad);
        const ry = px * Math.sin(angleRad) + py * Math.cos(angleRad);
        vertices.push(cx + rx, cy + ry);
    }
    return vertices;
}

function getSymbolColors(room: MapData.Room, mapReader: IMapReader, settings: Settings): { symbolColor: string; symbolFill: string } {
    const fallback = room.userData?.["system.fallback_symbol_color"];
    const symbolColor = fallback
        ?? ((settings.frameMode || settings.coloredMode)
            ? mapReader.getColorValue(room.env)
            : mapReader.getSymbolColor(room.env));
    const symbolFill = fallback
        ?? ((settings.frameMode || settings.coloredMode)
            ? mapReader.getColorValue(room.env)
            : mapReader.getSymbolColor(room.env, 0.6));
    return {symbolColor, symbolFill};
}

const DoorColors: Record<number, string> = {
    1: 'rgb(10, 155, 10)',
    2: 'rgb(226, 205, 59)',
    3: 'rgb(155, 10, 10)',
};

/**
 * Pre-computed triangle positions (centre + rotation) for one inner-exit
 * direction. `in`/`out` produce two triangles, `up`/`down` one.
 *
 * Shared between {@link computeInnerExits} (room rendering) and the path
 * overlay so a "go up" path marker lands exactly on top of the room's
 * regular up-arrow triangle.
 */
export function computeInnerExitTrianglesForDirection(
    room: MapData.Room,
    direction: MapData.direction,
    settings: Settings,
): Array<{ cx: number; cy: number; vertices: number[] }> {
    const rs = settings.roomSize;
    const triRadius = rs / 5;
    const make = (cx: number, cy: number, rot: number) => ({
        cx, cy, vertices: computeTriangleVertices(cx, cy, triRadius, rot),
    });
    switch (direction) {
        case "up": {
            const p = movePoint(room.x, room.y, "south", rs / 4);
            return [make(p.x, p.y, 0)];
        }
        case "down": {
            const p = movePoint(room.x, room.y, "north", rs / 4);
            return [make(p.x, p.y, 180)];
        }
        case "in": {
            const w = movePoint(room.x, room.y, "west", rs / 4);
            const e = movePoint(room.x, room.y, "east", rs / 4);
            return [make(w.x, w.y, 90), make(e.x, e.y, -90)];
        }
        case "out": {
            const w = movePoint(room.x, room.y, "west", rs / 4);
            const e = movePoint(room.x, room.y, "east", rs / 4);
            return [make(w.x, w.y, -90), make(e.x, e.y, 90)];
        }
        default:
            return [];
    }
}

/**
 * Compute inner exit triangle data for a room.
 * Returns pre-computed vertex positions so each backend just draws polygons.
 */
export function computeInnerExits(room: MapData.Room, mapReader: IMapReader, settings: Settings): InnerExitData {
    const triangles: TriangleData[] = [];
    const {symbolColor, symbolFill} = getSymbolColors(room, mapReader, settings);

    for (const exit of innerExits) {
        if (!room.exits[exit]) continue;

        const doorType = room.doors[exit];
        const stroke = doorType !== undefined ? (DoorColors[doorType] ?? DoorColors[3]) : symbolColor;

        for (const tri of computeInnerExitTrianglesForDirection(room, exit, settings)) {
            triangles.push({
                cx: tri.cx, cy: tri.cy,
                vertices: tri.vertices,
                fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
            });
        }
    }

    return {triangles};
}

/**
 * Compute triangle vertices for a standalone triangle (used by path overlay markers).
 */
export { computeTriangleVertices };
