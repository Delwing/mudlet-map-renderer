import type {Settings} from "../types/Settings";
import MapReader from "../reader/MapReader";
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

function getSymbolColors(room: MapData.Room, mapReader: MapReader, settings: Settings): { symbolColor: string; symbolFill: string } {
    const symbolColor = settings.frameMode
        ? mapReader.getColorValue(room.env)
        : mapReader.getSymbolColor(room.env);
    const symbolFill = settings.frameMode
        ? mapReader.getColorValue(room.env)
        : mapReader.getSymbolColor(room.env, 0.6);
    return {symbolColor, symbolFill};
}

const DoorColors: Record<number, string> = {
    1: 'rgb(10, 155, 10)',
    2: 'rgb(226, 205, 59)',
    3: 'rgb(155, 10, 10)',
};

/**
 * Compute inner exit triangle data for a room.
 * Returns pre-computed vertex positions so each backend just draws polygons.
 */
export function computeInnerExits(room: MapData.Room, mapReader: MapReader, settings: Settings): InnerExitData {
    const triangles: TriangleData[] = [];
    const rs = settings.roomSize;
    const triRadius = rs / 5;
    const {symbolColor, symbolFill} = getSymbolColors(room, mapReader, settings);

    for (const exit of innerExits) {
        if (!room.exits[exit]) continue;

        const doorType = room.doors[exit];
        const stroke = doorType !== undefined ? (DoorColors[doorType] ?? DoorColors[3]) : symbolColor;

        switch (exit) {
            case "up": {
                const pos = movePoint(room.x, room.y, "south", rs / 4);
                triangles.push({
                    cx: pos.x, cy: pos.y,
                    vertices: computeTriangleVertices(pos.x, pos.y, triRadius, 0),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                break;
            }
            case "down": {
                const pos = movePoint(room.x, room.y, "north", rs / 4);
                triangles.push({
                    cx: pos.x, cy: pos.y,
                    vertices: computeTriangleVertices(pos.x, pos.y, triRadius, 180),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                break;
            }
            case "in": {
                const posW = movePoint(room.x, room.y, "west", rs / 4);
                const posE = movePoint(room.x, room.y, "east", rs / 4);
                triangles.push({
                    cx: posW.x, cy: posW.y,
                    vertices: computeTriangleVertices(posW.x, posW.y, triRadius, 90),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                triangles.push({
                    cx: posE.x, cy: posE.y,
                    vertices: computeTriangleVertices(posE.x, posE.y, triRadius, -90),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                break;
            }
            case "out": {
                const posW = movePoint(room.x, room.y, "west", rs / 4);
                const posE = movePoint(room.x, room.y, "east", rs / 4);
                triangles.push({
                    cx: posW.x, cy: posW.y,
                    vertices: computeTriangleVertices(posW.x, posW.y, triRadius, -90),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                triangles.push({
                    cx: posE.x, cy: posE.y,
                    vertices: computeTriangleVertices(posE.x, posE.y, triRadius, 90),
                    fill: symbolFill, stroke, strokeWidth: settings.lineWidth,
                });
                break;
            }
        }
    }

    return {triangles};
}

/**
 * Compute triangle vertices for a standalone triangle (used by path overlay markers).
 */
export { computeTriangleVertices };
