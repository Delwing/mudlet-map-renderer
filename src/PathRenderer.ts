import Konva from "konva";
import MapReader from "./reader/MapReader";
import type {Settings} from "./Renderer";
import {movePoint, movePointCircle, movePointRoundedRect, PlanarDirection, planarDirections, oppositeDirections} from "./directions";
import {longToShort, regularExits} from "./reader/Exit";

type ConnectionType = 'regular' | 'special' | 'inner' | 'none';

interface Connection {
    type: ConnectionType;
    fromDir?: MapData.direction;
    toDir?: MapData.direction;
    customLineKey?: string;
    fromRoom: MapData.Room;
    toRoom: MapData.Room;
}

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

export default class PathRenderer {
    private readonly mapReader: MapReader;
    private readonly overlayLayer: Konva.Layer;
    private readonly settings: Settings;
    private paths: (Konva.Shape | Konva.Group)[] = [];

    constructor(mapReader: MapReader, overlayLayer: Konva.Layer, settings: Settings) {
        this.mapReader = mapReader;
        this.overlayLayer = overlayLayer;
        this.settings = settings;
    }

    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        if (this.settings.roomShape === "circle") {
            return movePointCircle(x, y, direction, distance);
        } else if (this.settings.roomShape === "roundedRectangle") {
            return movePointRoundedRect(x, y, direction, distance, this.settings.roomSize * 0.2);
        } else {
            return movePoint(x, y, direction, distance);
        }
    }

    private findConnection(fromRoom: MapData.Room, toRoom: MapData.Room): Connection {
        // Check regular exits from fromRoom
        for (const [dir, targetId] of Object.entries(fromRoom.exits)) {
            if (targetId === toRoom.id) {
                const direction = dir as MapData.direction;

                // Check if it's an inner exit
                if (innerExits.includes(direction)) {
                    // Inner exits can also have custom lines
                    const shortDir = longToShort[direction];
                    const customLineKey = fromRoom.customLines[shortDir] ? shortDir :
                                         fromRoom.customLines[direction] ? direction : undefined;
                    return { type: 'inner', fromDir: direction, customLineKey, fromRoom, toRoom };
                }

                // Check if there's a custom line for this direction (try both short and long form)
                const shortDir = longToShort[direction];
                if (fromRoom.customLines[shortDir]) {
                    return { type: 'special', fromDir: direction, customLineKey: shortDir, fromRoom, toRoom };
                }
                if (fromRoom.customLines[direction]) {
                    return { type: 'special', fromDir: direction, customLineKey: direction, fromRoom, toRoom };
                }

                // Regular exit - find the reverse direction from toRoom
                const reverseDir = this.findExitDirection(toRoom, fromRoom.id);
                return { type: 'regular', fromDir: direction, toDir: reverseDir, fromRoom, toRoom };
            }
        }

        // Check special exits from fromRoom
        for (const [exitName, targetId] of Object.entries(fromRoom.specialExits)) {
            if (targetId === toRoom.id) {
                // Check if there's a custom line for this special exit
                if (fromRoom.customLines[exitName]) {
                    return { type: 'special', customLineKey: exitName, fromRoom, toRoom };
                }
                // Special exit without custom line - treat as inner (no visual line)
                return { type: 'inner', fromRoom, toRoom };
            }
        }

        // Check reverse direction (toRoom might have the exit to fromRoom)
        for (const [dir, targetId] of Object.entries(toRoom.exits)) {
            if (targetId === fromRoom.id) {
                const direction = dir as MapData.direction;

                if (innerExits.includes(direction)) {
                    // Inner exits can also have custom lines
                    const shortDir = longToShort[direction];
                    const customLineKey = toRoom.customLines[shortDir] ? shortDir :
                                         toRoom.customLines[direction] ? direction : undefined;
                    return { type: 'inner', toDir: direction, customLineKey, fromRoom, toRoom };
                }

                const shortDir = longToShort[direction];
                if (toRoom.customLines[shortDir]) {
                    return { type: 'special', toDir: direction, customLineKey: shortDir, fromRoom, toRoom };
                }
                if (toRoom.customLines[direction]) {
                    return { type: 'special', toDir: direction, customLineKey: direction, fromRoom, toRoom };
                }

                return { type: 'regular', toDir: direction, fromRoom, toRoom };
            }
        }

        // Check special exits from toRoom
        for (const [exitName, targetId] of Object.entries(toRoom.specialExits)) {
            if (targetId === fromRoom.id) {
                if (toRoom.customLines[exitName]) {
                    return { type: 'special', customLineKey: exitName, fromRoom, toRoom };
                }
                return { type: 'inner', fromRoom, toRoom };
            }
        }

        return { type: 'none', fromRoom, toRoom };
    }

    private findExitDirection(room: MapData.Room, targetId: number): MapData.direction | undefined {
        for (const [dir, id] of Object.entries(room.exits)) {
            if (id === targetId) {
                return dir as MapData.direction;
            }
        }
        return undefined;
    }

    private createStrokedLine(points: number[], color: string): Konva.Group {
        const group = new Konva.Group();
        group.opacity(0.8);

        // Black outline (wider)
        group.add(new Konva.Line({
            points,
            stroke: 'black',
            strokeWidth: this.settings.lineWidth * 8,
            lineCap: 'round',
            lineJoin: 'round',
        }));

        // Colored line in the middle (narrower)
        group.add(new Konva.Line({
            points,
            stroke: color,
            strokeWidth: this.settings.lineWidth * 4,
            lineCap: 'round',
            lineJoin: 'round',
        }));

        return group;
    }

    private renderInnerExitMarker(room: MapData.Room, direction: MapData.direction, color: string): Konva.Group {
        const group = new Konva.Group();
        group.opacity(0.8);

        // Create triangle marker (same as ExitRenderer.renderInnerExits)
        const triangle = new Konva.RegularPolygon({
            x: room.x,
            y: room.y,
            sides: 3,
            fill: color,
            stroke: 'black',
            strokeWidth: this.settings.lineWidth * 2,
            radius: this.settings.roomSize / 5,
            scaleX: 1.4,
            scaleY: 0.8,
        });

        // Position based on direction
        switch (direction) {
            case "up":
                triangle.position(movePoint(room.x, room.y, "south", this.settings.roomSize / 4));
                break;
            case "down":
                triangle.rotation(180);
                triangle.position(movePoint(room.x, room.y, "north", this.settings.roomSize / 4));
                break;
            case "in":
                const inTriangle = triangle.clone();
                inTriangle.rotation(-90);
                inTriangle.position(movePoint(room.x, room.y, "east", this.settings.roomSize / 4));
                group.add(inTriangle);
                triangle.rotation(90);
                triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                break;
            case "out":
                const outTriangle = triangle.clone();
                outTriangle.rotation(90);
                outTriangle.position(movePoint(room.x, room.y, "east", this.settings.roomSize / 4));
                group.add(outTriangle);
                triangle.rotation(-90);
                triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                break;
        }

        group.add(triangle);
        return group;
    }

    renderPath(locations: number[], currentArea?: number, currentZIndex?: number, color: string = '#66E64D') {
        if (currentArea === undefined || currentZIndex === undefined) {
            return;
        }

        const rooms = locations
            .map(location => this.mapReader.getRoom(location))
            .filter((room): room is MapData.Room => room !== undefined);

        // Collect continuous path segments (break on inner exits or invisible rooms)
        let currentSegmentPoints: number[] = [];

        const flushSegment = () => {
            if (currentSegmentPoints.length >= 4) {
                const path = this.createStrokedLine(currentSegmentPoints, color);
                this.overlayLayer.add(path);
                this.paths.push(path);
            }
            currentSegmentPoints = [];
        };

        for (let i = 0; i < rooms.length - 1; i++) {
            const fromRoom = rooms[i];
            const toRoom = rooms[i + 1];

            const fromVisible = this.isRoomVisible(fromRoom, currentArea, currentZIndex);
            const toVisible = this.isRoomVisible(toRoom, currentArea, currentZIndex);

            if (!fromVisible && !toVisible) {
                flushSegment();
                continue;
            }

            const connection = this.findConnection(fromRoom, toRoom);

            if (fromVisible && toVisible) {
                switch (connection.type) {
                    case 'regular':
                        this.addRegularConnectionPoints(connection, currentSegmentPoints);
                        break;
                    case 'special':
                        // Add special exit points to current segment
                        this.addSpecialConnectionPoints(connection, currentSegmentPoints);
                        break;
                    case 'inner':
                        // Inner exits break the visual path - flush and render markers
                        flushSegment();
                        this.renderInnerConnection(connection, color);
                        break;
                    case 'none':
                        // Fallback: add direct line between centers
                        if (currentSegmentPoints.length === 0) {
                            currentSegmentPoints.push(fromRoom.x, fromRoom.y);
                        }
                        currentSegmentPoints.push(toRoom.x, toRoom.y);
                        break;
                }
            } else {
                // One room visible, one not - handle exit to other area
                const visibleRoom = fromVisible ? fromRoom : toRoom;
                const invisibleRoom = fromVisible ? toRoom : fromRoom;

                // Find the full connection info to handle all exit types
                const exitInfo = this.getExitToRoom(visibleRoom, invisibleRoom);

                if (exitInfo) {
                    if (innerExits.includes(exitInfo.direction)) {
                        // Inner exit to another area - flush segment and render marker
                        flushSegment();
                        const marker = this.renderInnerExitMarker(visibleRoom, exitInfo.direction, color);
                        this.overlayLayer.add(marker);
                        this.paths.push(marker);
                    } else if (regularExits.includes(exitInfo.direction)) {
                        // Regular exit to another area - add stub points to current segment
                        if (currentSegmentPoints.length === 0) {
                            currentSegmentPoints.push(visibleRoom.x, visibleRoom.y);
                        }
                        const edgePoint = this.getRoomEdgePoint(visibleRoom.x, visibleRoom.y, exitInfo.direction, this.settings.roomSize / 2);
                        const stubEnd = movePoint(visibleRoom.x, visibleRoom.y, exitInfo.direction, this.settings.roomSize);
                        currentSegmentPoints.push(edgePoint.x, edgePoint.y, stubEnd.x, stubEnd.y);
                        flushSegment();
                    }
                } else {
                    // Fallback: try planar direction
                    const dir = this.getDirectionTowards(visibleRoom, invisibleRoom);
                    if (dir) {
                        if (currentSegmentPoints.length === 0) {
                            currentSegmentPoints.push(visibleRoom.x, visibleRoom.y);
                        }
                        const edgePoint = this.getRoomEdgePoint(visibleRoom.x, visibleRoom.y, dir, this.settings.roomSize / 2);
                        const stubEnd = movePoint(visibleRoom.x, visibleRoom.y, dir, this.settings.roomSize);
                        currentSegmentPoints.push(edgePoint.x, edgePoint.y, stubEnd.x, stubEnd.y);
                        flushSegment();
                    }
                }
            }
        }

        flushSegment();

        return this.paths[0];
    }

    private addRegularConnectionPoints(connection: Connection, points: number[]) {
        const { fromRoom, toRoom, fromDir, toDir } = connection;

        // If this is the start of a segment, add fromRoom center
        if (points.length === 0) {
            points.push(fromRoom.x, fromRoom.y);
        }

        // Add fromRoom exit edge
        if (fromDir && regularExits.includes(fromDir)) {
            const fromEdge = this.getRoomEdgePoint(fromRoom.x, fromRoom.y, fromDir, this.settings.roomSize / 2);
            points.push(fromEdge.x, fromEdge.y);
        }

        // Add toRoom exit edge
        if (toDir && regularExits.includes(toDir)) {
            const toEdge = this.getRoomEdgePoint(toRoom.x, toRoom.y, toDir, this.settings.roomSize / 2);
            points.push(toEdge.x, toEdge.y);
        }

        // Add toRoom center
        points.push(toRoom.x, toRoom.y);
    }

    private addSpecialConnectionPoints(connection: Connection, points: number[]) {
        const { fromRoom, toRoom, customLineKey } = connection;

        // Find the custom line
        let room: MapData.Room = fromRoom;
        let customLine: MapData.Line | undefined;

        if (customLineKey) {
            customLine = fromRoom.customLines[customLineKey];
            if (!customLine) {
                customLine = toRoom.customLines[customLineKey];
                room = toRoom;
            }
        }

        // If this is the start of a segment, add room center
        if (points.length === 0) {
            points.push(room.x, room.y);
        }

        if (customLine) {
            // Add custom line points (they start from room position)
            customLine.points.forEach(point => {
                points.push(point.x, -point.y);
            });
        }

        // End at toRoom center
        points.push(toRoom.x, toRoom.y);
    }

    private renderInnerConnection(connection: Connection, color: string) {
        const { fromRoom, toRoom, fromDir, toDir, customLineKey } = connection;

        // If there's a custom line, draw it
        if (customLineKey) {
            // Determine which room has the custom line
            let room = fromRoom;
            let customLine = fromRoom.customLines[customLineKey];
            if (!customLine) {
                customLine = toRoom.customLines[customLineKey];
                room = toRoom;
            }

            if (customLine) {
                const points: number[] = [room.x, room.y];
                customLine.points.forEach(point => {
                    points.push(point.x, -point.y);
                });
                const linePath = this.createStrokedLine(points, color);
                this.overlayLayer.add(linePath);
                this.paths.push(linePath);
            }
        }

        // Draw inner exit marker on fromRoom if we have the direction
        if (fromDir && innerExits.includes(fromDir)) {
            const marker = this.renderInnerExitMarker(fromRoom, fromDir, color);
            this.overlayLayer.add(marker);
            this.paths.push(marker);
        }

        // Draw inner exit marker on toRoom if we have the direction
        if (toDir && innerExits.includes(toDir)) {
            const marker = this.renderInnerExitMarker(toRoom, toDir, color);
            this.overlayLayer.add(marker);
            this.paths.push(marker);
        }
    }

    clearPaths() {
        this.paths.forEach(path => {
            path.destroy();
        });
        this.paths = [];
    }

    private isRoomVisible(room: MapData.Room | undefined, currentArea: number | undefined, currentZIndex: number | undefined) {
        if (!room) {
            return false;
        }
        return room.area === currentArea && room.z === currentZIndex;
    }

    private getExitToRoom(from: MapData.Room, to: MapData.Room): { direction: MapData.direction } | undefined {
        // Check all exits (including inner exits)
        for (const [dir, targetId] of Object.entries(from.exits)) {
            if (targetId === to.id) {
                return { direction: dir as MapData.direction };
            }
        }
        // Check special exits
        for (const [_, targetId] of Object.entries(from.specialExits)) {
            if (targetId === to.id) {
                // Special exits don't have a standard direction, return undefined
                return undefined;
            }
        }
        return undefined;
    }

    private getDirectionTowards(from: MapData.Room, to: MapData.Room): PlanarDirection | undefined {
        for (const direction of planarDirections) {
            if (from.exits[direction] === to.id) {
                return direction;
            }
        }

        for (const direction of planarDirections) {
            if (to.exits[direction] === from.id) {
                return oppositeDirections[direction];
            }
        }

        return undefined;
    }
}
