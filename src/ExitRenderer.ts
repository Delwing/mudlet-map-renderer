import Exit, {longToShort, shortTolong, regularExits} from "./reader/Exit";
import MapReader from "./reader/MapReader";
import Konva from "konva";
import type {Settings} from "./Renderer";
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

const dirNumbers: Record<number, MapData.direction> = {
    1: "north",
    2: "northeast",
    3: "northwest",
    4: "east",
    5: "west",
    6: "south",
    7: "southeast",
    8: "southwest",
    9: "up",
    10: "down",
    11: "in",
    12: "out",
};

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

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
     * Get the edge point of a room based on its shape
     */
    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        if (this.settings.roomShape === "circle") {
            return movePointCircle(x, y, direction, distance);
        } else if (this.settings.roomShape === "roundedRectangle") {
            return movePointRoundedRect(x, y, direction, distance, this.settings.roomSize * 0.2);
        } else {
            return movePoint(x, y, direction, distance);
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

    render(exit: Exit, zIndex: number) {
        return this.renderWithColor(exit, this.settings.lineColor, zIndex);
    }

    renderWithColor(exit: Exit, color: string, zIndex: number) {
        const aIsRegular = exit.aDir && regularExits.includes(exit.aDir);
        const bIsRegular = exit.bDir && regularExits.includes(exit.bDir);

        if (aIsRegular && bIsRegular) {
            return this.renderTwoWayExit(exit, color, zIndex);
        } else if (aIsRegular || bIsRegular) {
            const regularDir = aIsRegular ? 'a' : 'b';
            return this.renderOneWayExit(exit, color, regularDir);
        }
        return;
    }

    private renderTwoWayExit(exit: Exit, color: string, zIndex: number) {
        const sourceRoom = this.mapReader.getRoom(exit.a)
        const targetRoom = this.mapReader.getRoom(exit.b);

        if (!sourceRoom || !targetRoom || !exit.aDir || !exit.bDir) {
            return;
        }

        if (sourceRoom.customLines[longToShort[exit.aDir]] && targetRoom.customLines[longToShort[exit.bDir]]) {
            return
        }

        if (sourceRoom.z !== targetRoom.z) {
            if (zIndex !== targetRoom.z && sourceRoom.customLines[longToShort[exit.aDir]]) {
                return
            }
            if (zIndex !== sourceRoom.z && targetRoom.customLines[longToShort[exit.bDir]]) {
                return
            }
        }

        const exitRender = new Konva.Group({ listening: false });

        const points = []
        points.push(...Object.values(this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, exit.aDir, this.settings.roomSize / 2)));
        points.push(...Object.values(this.getRoomEdgePoint(targetRoom.x, targetRoom.y, exit.bDir, this.settings.roomSize / 2)));

        if (sourceRoom.doors[longToShort[exit.aDir]] || targetRoom.doors[longToShort[exit.bDir]]) {
            const door = this.renderDoor(points, sourceRoom.doors[longToShort[exit.aDir]] ?? targetRoom.doors[longToShort[exit.bDir]])
            exitRender.add(door);
        }

        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: this.settings.lineWidth,
            perfectDrawEnabled: false,
            listening: false,
        });
        exitRender.add(link);

        return exitRender;
    }

    private renderOneWayExit(exit: Exit, color: string, fromSide?: 'a' | 'b') {
        // Determine which side is the source based on fromSide parameter or which dir exists
        const useA = fromSide === 'a' || (!fromSide && exit.aDir);
        const sourceRoom = useA ? this.mapReader.getRoom(exit.a) : this.mapReader.getRoom(exit.b);
        const targetRoom = useA ? this.mapReader.getRoom(exit.b) : this.mapReader.getRoom(exit.a);
        const dir = useA ? exit.aDir : exit.bDir;

        if (!dir || !sourceRoom || !targetRoom || !regularExits.includes(dir) || sourceRoom.customLines[longToShort[dir] || dir]) {
            return;
        }

        if (sourceRoom.area != targetRoom.area && dir) {
            const targetEnvColor = this.mapReader.getColorValue(targetRoom.env);
            return this.renderAreaExit(sourceRoom, dir, targetEnvColor);
        }

        let targetPoint = {x: targetRoom.x, y: targetRoom.y};
        if (targetRoom.area !== sourceRoom.area || targetRoom.z !== sourceRoom.z) {
            targetPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize / 2);
        }

        const startPoint = movePoint(sourceRoom.x, sourceRoom.y, dir, 0.3);

        const middlePointX = startPoint.x - (startPoint.x - targetPoint.x) / 2;
        const middlePointY = startPoint.y - (startPoint.y - targetPoint.y) / 2;

        const group = new Konva.Group({ listening: false });
        const points = []
        points.push(...Object.values(this.getRoomEdgePoint(sourceRoom.x, sourceRoom.y, dir, this.settings.roomSize / 2)));
        points.push(targetPoint.x, targetPoint.y);
        const link = new Konva.Line({
            points,
            stroke: color,
            strokeWidth: this.settings.lineWidth,
            dashEnabled: true,
            dash: [0.1, 0.05],
            perfectDrawEnabled: false,
            listening: false,
        });
        group.add(link)

        const arrow = new Konva.Arrow({
            points: [points[0], points[1], middlePointX, middlePointY],
            pointerLength: 0.5,
            pointerWidth: 0.35,
            strokeWidth: this.settings.lineWidth * 1.4,
            stroke: color,
            fill: Colors.ONE_WAY_FILL,
            dashEnabled: true,
            dash: [0.1, 0.05],
            perfectDrawEnabled: false,
            listening: false,
        })

        group.add(arrow)

        return group;
    }

    renderAreaExit(room: MapData.Room, dir: MapData.direction, color?: string) {
        const start = this.getRoomEdgePoint(room.x, room.y, dir, this.settings.roomSize / 2)
        const end = movePoint(room.x, room.y, dir, this.settings.roomSize * 1.5)
        const stroke = color ?? this.mapReader.getColorValue(room.env);
        return new Konva.Arrow({
            points: [start.x, start.y, end.x, end.y],
            pointerLength: 0.3,
            pointerWidth: 0.3,
            strokeWidth: this.settings.lineWidth * 1.4,
            stroke,
            fill: stroke,
            perfectDrawEnabled: false,
            listening: false,
        })
    }

    renderSpecialExits(room: MapData.Room, overrideColor?: string) {
        return Object.entries(room.customLines).flatMap(([dir, line]) => {
            const points = [room.x, room.y]
            line.points.reduce((acc, point) => {
                acc.push(point.x, -point.y);
                return acc;
            }, points)

            const construct = line.attributes.arrow ? Konva.Arrow : Konva.Line;
            const strokeColor = overrideColor ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`;
            const lineRender = new construct({
                points: points,
                strokeWidth: this.settings.lineWidth,
                stroke: strokeColor,
                fill: overrideColor ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g} , ${line.attributes.color.b})`,
                pointerLength: 0.3,
                pointerWidth: 0.2,
                perfectDrawEnabled: false,
                listening: false,
            })

            let style = line.attributes.style;
            if (style === "dot line") {
                lineRender.dash([0.05, 0.05])
                lineRender.dashOffset(0.1)
            } else if (style === "dash line") {
                lineRender.dash([0.4, 0.2])
            } else if (style === "solid line") {
            } else if (style !== undefined) {
                console.log("Brak opisu stylu: " + style);
            }

            const result: (Konva.Line | Konva.Arrow | Konva.Rect)[] = [lineRender];

            const doorType = room.doors[dir];
            if (doorType && points.length >= 4) {
                result.push(this.renderDoor(points, doorType));
            }

            return result;
        })
    }

    /**
     * Returns hit-zone bounds for special exits (custom lines) that lead to rooms in another area.
     */
    getSpecialExitAreaTargets(room: MapData.Room): { bounds: { x: number; y: number; width: number; height: number }; targetRoomId: number }[] {
        const results: { bounds: { x: number; y: number; width: number; height: number }; targetRoomId: number }[] = [];
        for (const [dir, line] of Object.entries(room.customLines)) {
            // customLines keys can be short direction codes ("n","ne") or arbitrary special exit names ("portal_1")
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

    renderStubs(room: MapData.Room, color: string = this.settings.lineColor) {
        return room.stubs.map(stub => {
            const direction = dirNumbers[stub];
            const start = this.getRoomEdgePoint(room.x, room.y, direction, this.settings.roomSize / 2)
            const end = movePoint(room.x, room.y, direction, this.settings.roomSize / 2 + 0.5)
            const points = [start.x, start.y, end.x, end.y]
            return new Konva.Line({
                points,
                stroke: color,
                strokeWidth: this.settings.lineWidth,
                perfectDrawEnabled: false,
                listening: false,
            });
        })
    }

    private getSymbolColor(envId: number, opacity?: number): string {
        if (this.settings.frameMode) {
            return this.mapReader.getColorValue(envId);
        }
        return this.mapReader.getSymbolColor(envId, opacity);
    }

    renderInnerExits(room: MapData.Room) {
        return innerExits.map(exit => {
            if (room.exits[exit]) {
                const render = new Konva.Group({ listening: false });
                const triangle = new Konva.RegularPolygon({
                    x: room.x,
                    y: room.y,
                    sides: 3,
                    fill: this.getSymbolColor(room.env, 0.6),
                    stroke: this.getSymbolColor(room.env),
                    strokeWidth: this.settings.lineWidth,
                    radius: this.settings.roomSize / 5,
                    scaleX: 1.4,
                    scaleY: 0.8,
                    perfectDrawEnabled: false,
                    listening: false,
                })
                render.add(triangle);

                let doorType = room.doors[exit];
                if (doorType !== undefined) {
                    switch (doorType) {
                        case 1:
                            triangle.stroke(Colors.OPEN_DOOR)
                            break;
                        case 2:
                            triangle.stroke(Colors.CLOSED_DOOR);
                            break;
                        default:
                            triangle.stroke(Colors.LOCKED_DOOR);
                    }
                }

                const triangleStroke = triangle.stroke();
                switch (exit) {
                    case "up":
                        triangle.position(movePoint(room.x, room.y, "south", this.settings.roomSize / 4));
                        break;
                    case "down":
                        triangle.rotation(180);
                        triangle.position(movePoint(room.x, room.y, "north", this.settings.roomSize / 4));
                        break;
                    case "in": {
                        triangle.rotation(90);
                        triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                        const eastPos = movePoint(room.x, room.y, "east", this.settings.roomSize / 4);
                        render.add(new Konva.RegularPolygon({
                            x: eastPos.x,
                            y: eastPos.y,
                            sides: 3,
                            fill: triangle.fill(),
                            stroke: triangleStroke,
                            strokeWidth: this.settings.lineWidth,
                            radius: this.settings.roomSize / 5,
                            scaleX: 1.4,
                            scaleY: 0.8,
                            rotation: -90,
                            perfectDrawEnabled: false,
                            listening: false,
                        }));
                        break;
                    }
                    case "out": {
                        triangle.rotation(-90);
                        triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                        const eastPos = movePoint(room.x, room.y, "east", this.settings.roomSize / 4);
                        render.add(new Konva.RegularPolygon({
                            x: eastPos.x,
                            y: eastPos.y,
                            sides: 3,
                            fill: triangle.fill(),
                            stroke: triangleStroke,
                            strokeWidth: this.settings.lineWidth,
                            radius: this.settings.roomSize / 5,
                            scaleX: 1.4,
                            scaleY: 0.8,
                            rotation: 90,
                            perfectDrawEnabled: false,
                            listening: false,
                        }));
                        break;
                    }
                }
                return render
            }
        }).filter(e => e !== undefined)
    }

    renderDoor(points: number[], type: 1 | 2 | 3) {
        const point = {
            x: points[0] + (points[2] - points[0]) / 2,
            y: points[1] + (points[3] - points[1]) / 2,
        }
        return new Konva.Rect({
            x: point.x - this.settings.roomSize / 4,
            y: point.y - this.settings.roomSize / 4,
            width: this.settings.roomSize / 2,
            height: this.settings.roomSize / 2,
            stroke: getDoorColor(type),
            strokeWidth: this.settings.lineWidth,
            perfectDrawEnabled: false,
            listening: false,
        })
    }

}