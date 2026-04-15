import Exit, {longToShort, shortTolong, regularExits} from "./reader/Exit";
import MapReader from "./reader/MapReader";
import type {Settings} from "./types/Settings";
import {movePoint, movePointCircle, movePointRoundedRect} from "./directions";

const Colors = {
    OPEN_DOOR: 'rgb(10, 155, 10)',
    CLOSED_DOOR: 'rgb(226, 205, 59)',
    LOCKED_DOOR: 'rgb(155, 10, 10)',
    ONE_WAY_FILL: 'rgb(155, 10, 10)'
}

export type ExitDrawLine = {
    points: number[];
    stroke: string;
    strokeWidth: number;
    dash?: number[];
};

export type ExitDrawArrow = {
    points: number[];
    pointerLength: number;
    pointerWidth: number;
    stroke: string;
    strokeWidth: number;
    fill: string;
    dash?: number[];
};

export type ExitDrawDoor = {
    x: number;
    y: number;
    width: number;
    height: number;
    stroke: string;
    strokeWidth: number;
};

export type ExitDrawData = {
    lines: ExitDrawLine[];
    arrows: ExitDrawArrow[];
    doors: ExitDrawDoor[];
    bounds: { x: number; y: number; width: number; height: number };
    /** Set when this exit leads to a room in a different area (cross-area exit). */
    targetRoomId?: number;
};

function getDoorColor(doorType: 1 | 2 | 3) {
    switch (doorType) {
        case 1:
            return Colors.OPEN_DOOR
        case 2:
            return Colors.CLOSED_DOOR
        default:
            return Colors.LOCKED_DOOR
    }
}

export default class ExitRenderer {

    private mapReader: MapReader;
    private readonly settings: Settings;

    constructor(mapReader: MapReader, settings: Settings) {
        this.mapReader = mapReader;
        this.settings = settings;
    }

    /**
     * Get the edge point of a room based on its shape.
     * The inset accounts for the inner border so exit lines reach the visible room edge.
     */
    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        const inset = this.settings.borders ? this.settings.lineWidth / 2 : 0;
        const d = distance - inset;
        if (this.settings.roomShape === "circle") {
            return movePointCircle(x, y, direction, d);
        } else if (this.settings.roomShape === "roundedRectangle") {
            return movePointRoundedRect(x, y, direction, d, this.settings.roomSize * 0.2);
        } else {
            return movePoint(x, y, direction, d);
        }
    }

    renderData(exit: Exit, zIndex: number): ExitDrawData | undefined {
        return this.renderDataWithColor(exit, this.settings.lineColor, zIndex);
    }

    renderDataWithColor(exit: Exit, color: string, zIndex: number): ExitDrawData | undefined {
        const aIsRegular = exit.aDir && regularExits.includes(exit.aDir);
        const bIsRegular = exit.bDir && regularExits.includes(exit.bDir);

        if (aIsRegular && bIsRegular) {
            return this.renderTwoWayExitData(exit, color, zIndex);
        } else if (aIsRegular || bIsRegular) {
            const regularDir = aIsRegular ? 'a' : 'b';
            return this.renderOneWayExitData(exit, color, regularDir);
        }
        return;
    }

    private renderTwoWayExitData(exit: Exit, color: string, zIndex: number): ExitDrawData | undefined {
        const sourceRoom = this.mapReader.getRoom(exit.a);
        const targetRoom = this.mapReader.getRoom(exit.b);
        if (!sourceRoom || !targetRoom || !exit.aDir || !exit.bDir) return;
        if (sourceRoom.customLines[longToShort[exit.aDir]] && targetRoom.customLines[longToShort[exit.bDir]]) return;
        if (sourceRoom.z !== targetRoom.z) {
            if (zIndex !== targetRoom.z && sourceRoom.customLines[longToShort[exit.aDir]]) return;
            if (zIndex !== sourceRoom.z && targetRoom.customLines[longToShort[exit.bDir]]) return;
        }

        const p1 = this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, exit.aDir, this.settings.roomSize / 2);
        const p2 = this.getRoomEdgePoint(targetRoom.x, targetRoom.y, exit.bDir, this.settings.roomSize / 2);
        const points = [p1.x, p1.y, p2.x, p2.y];

        const lines: ExitDrawLine[] = [{ points, stroke: color, strokeWidth: this.settings.lineWidth }];
        const doors: ExitDrawDoor[] = [];
        const doorType = sourceRoom.doors[longToShort[exit.aDir]] ?? targetRoom.doors[longToShort[exit.bDir]];
        if (doorType) {
            const dx = points[0] + (points[2] - points[0]) / 2;
            const dy = points[1] + (points[3] - points[1]) / 2;
            doors.push({
                x: dx - this.settings.roomSize / 4,
                y: dy - this.settings.roomSize / 4,
                width: this.settings.roomSize / 2,
                height: this.settings.roomSize / 2,
                stroke: getDoorColor(doorType),
                strokeWidth: this.settings.lineWidth,
            });
        }

        const minX = Math.min(points[0], points[2]);
        const maxX = Math.max(points[0], points[2]);
        const minY = Math.min(points[1], points[3]);
        const maxY = Math.max(points[1], points[3]);
        // If rooms are on different z-levels, make the exit clickable to navigate to the other z
        const crossZTarget = sourceRoom.z !== targetRoom.z
            ? (sourceRoom.z === zIndex ? targetRoom.id : sourceRoom.id)
            : undefined;
        return { lines, arrows: [], doors, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, targetRoomId: crossZTarget };
    }

    private renderOneWayExitData(exit: Exit, color: string, fromSide?: 'a' | 'b'): ExitDrawData | undefined {
        const useA = fromSide === 'a' || (!fromSide && exit.aDir);
        const sourceRoom = useA ? this.mapReader.getRoom(exit.a) : this.mapReader.getRoom(exit.b);
        const targetRoom = useA ? this.mapReader.getRoom(exit.b) : this.mapReader.getRoom(exit.a);
        const dir = useA ? exit.aDir : exit.bDir;
        if (!dir || !sourceRoom || !targetRoom || !regularExits.includes(dir) || sourceRoom.customLines[longToShort[dir] || dir]) return;

        if (sourceRoom.area != targetRoom.area && dir) {
            const targetEnvColor = this.mapReader.getColorValue(targetRoom.env);
            const start = this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize / 2);
            const end = movePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize * 1.5);
            const stroke = targetEnvColor;
            return {
                lines: [],
                arrows: [{
                    points: [start.x, start.y, end.x, end.y],
                    pointerLength: 0.3, pointerWidth: 0.3,
                    strokeWidth: this.settings.lineWidth * 1.4,
                    stroke, fill: stroke,
                }],
                doors: [],
                bounds: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) },
                targetRoomId: targetRoom.id,
            };
        }

        const isCrossZone = targetRoom.area !== sourceRoom.area || targetRoom.z !== sourceRoom.z;
        let targetPoint = { x: targetRoom.x, y: targetRoom.y };
        if (isCrossZone) {
            targetPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize / 2);
        }

        const startPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, 0.3);
        const midX = startPoint.x - (startPoint.x - targetPoint.x) / 2;
        const midY = startPoint.y - (startPoint.y - targetPoint.y) / 2;
        const edgePoint = this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize / 2);
        const linePoints = [edgePoint.x, edgePoint.y, targetPoint.x, targetPoint.y];

        const allX = [edgePoint.x, targetPoint.x, midX];
        const allY = [edgePoint.y, targetPoint.y, midY];
        const minX = Math.min(...allX);
        const maxX = Math.max(...allX);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);

        return {
            lines: [{ points: linePoints, stroke: color, strokeWidth: this.settings.lineWidth, dash: [0.1, 0.05] }],
            arrows: [{
                points: [linePoints[0], linePoints[1], midX, midY],
                pointerLength: 0.5, pointerWidth: 0.35,
                strokeWidth: this.settings.lineWidth * 1.4,
                stroke: color, fill: Colors.ONE_WAY_FILL,
                dash: [0.1, 0.05],
            }],
            doors: [],
            bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            ...(isCrossZone ? { targetRoomId: targetRoom.id } : {}),
        };
    }

    /**
     * Returns hit-zone bounds for special exits (custom lines) that lead to rooms in another area.
     */
    getSpecialExitAreaTargets(room: MapData.Room): { bounds: { x: number; y: number; width: number; height: number }; targetRoomId: number }[] {
        const results: { bounds: { x: number; y: number; width: number; height: number }; targetRoomId: number }[] = [];
        for (const [dir, line] of Object.entries(room.customLines)) {
            let targetId: number | undefined = room.specialExits[dir];
            if (targetId === undefined) {
                const longDir = shortTolong[dir];
                if (longDir) {
                    targetId = room.exits[longDir] ?? room.specialExits[longDir];
                }
            }
            if (targetId === undefined) continue;
            const targetRoom = this.mapReader.getRoom(targetId);
            if (!targetRoom || (targetRoom.area === room.area && targetRoom.z === room.z)) continue;
            const points = [room.x, room.y];
            line.points.reduce((acc, point) => { acc.push(point.x, -point.y); return acc; }, points);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < points.length; i += 2) {
                minX = Math.min(minX, points[i]);
                maxX = Math.max(maxX, points[i]);
                minY = Math.min(minY, points[i + 1]);
                maxY = Math.max(maxY, points[i + 1]);
            }
            results.push({ bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, targetRoomId: targetId });
        }
        return results;
    }
}
