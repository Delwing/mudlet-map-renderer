import MapReader from "./reader/MapReader";
import type {Settings} from "./types/Settings";
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

export interface PathSegment {
    points: number[];
}

export interface PathInnerMarker {
    room: MapData.Room;
    direction: MapData.direction;
}

export interface PathCustomLine {
    points: number[];
}

export interface PathResult {
    segments: PathSegment[];
    innerMarkers: PathInnerMarker[];
    customLines: PathCustomLine[];
}

function getRoomEdgePoint(settings: Settings, x: number, y: number, direction: MapData.direction, distance: number) {
    if (settings.roomShape === "circle") {
        return movePointCircle(x, y, direction, distance);
    } else if (settings.roomShape === "roundedRectangle") {
        return movePointRoundedRect(x, y, direction, distance, settings.roomSize * 0.2);
    }
    return movePoint(x, y, direction, distance);
}

function findConnection(mapReader: MapReader, fromRoom: MapData.Room, toRoom: MapData.Room): Connection {
    // Check regular exits from fromRoom
    for (const [dir, targetId] of Object.entries(fromRoom.exits)) {
        if (targetId === toRoom.id) {
            const direction = dir as MapData.direction;

            if (innerExits.includes(direction)) {
                const shortDir = longToShort[direction];
                const customLineKey = fromRoom.customLines[shortDir] ? shortDir :
                    fromRoom.customLines[direction] ? direction : undefined;
                return {type: 'inner', fromDir: direction, customLineKey, fromRoom, toRoom};
            }

            const shortDir = longToShort[direction];
            if (fromRoom.customLines[shortDir]) {
                return {type: 'special', fromDir: direction, customLineKey: shortDir, fromRoom, toRoom};
            }
            if (fromRoom.customLines[direction]) {
                return {type: 'special', fromDir: direction, customLineKey: direction, fromRoom, toRoom};
            }

            const reverseDir = findExitDirection(toRoom, fromRoom.id);
            return {type: 'regular', fromDir: direction, toDir: reverseDir, fromRoom, toRoom};
        }
    }

    // Check special exits from fromRoom
    for (const [exitName, targetId] of Object.entries(fromRoom.specialExits)) {
        if (targetId === toRoom.id) {
            if (fromRoom.customLines[exitName]) {
                return {type: 'special', customLineKey: exitName, fromRoom, toRoom};
            }
            return {type: 'inner', fromRoom, toRoom};
        }
    }

    // Check reverse (toRoom → fromRoom)
    for (const [dir, targetId] of Object.entries(toRoom.exits)) {
        if (targetId === fromRoom.id) {
            const direction = dir as MapData.direction;

            if (innerExits.includes(direction)) {
                const shortDir = longToShort[direction];
                const customLineKey = toRoom.customLines[shortDir] ? shortDir :
                    toRoom.customLines[direction] ? direction : undefined;
                return {type: 'inner', toDir: direction, customLineKey, fromRoom, toRoom};
            }

            const shortDir = longToShort[direction];
            if (toRoom.customLines[shortDir]) {
                return {type: 'special', toDir: direction, customLineKey: shortDir, fromRoom, toRoom};
            }
            if (toRoom.customLines[direction]) {
                return {type: 'special', toDir: direction, customLineKey: direction, fromRoom, toRoom};
            }

            return {type: 'regular', toDir: direction, fromRoom, toRoom};
        }
    }

    // Check special exits from toRoom
    for (const [exitName, targetId] of Object.entries(toRoom.specialExits)) {
        if (targetId === fromRoom.id) {
            if (toRoom.customLines[exitName]) {
                return {type: 'special', customLineKey: exitName, fromRoom, toRoom};
            }
            return {type: 'inner', fromRoom, toRoom};
        }
    }

    return {type: 'none', fromRoom, toRoom};
}

function findExitDirection(room: MapData.Room, targetId: number): MapData.direction | undefined {
    for (const [dir, id] of Object.entries(room.exits)) {
        if (id === targetId) {
            return dir as MapData.direction;
        }
    }
    return undefined;
}

function isRoomVisible(room: MapData.Room | undefined, currentArea: number, currentZIndex: number) {
    if (!room) return false;
    return room.area === currentArea && room.z === currentZIndex;
}

function getExitToRoom(from: MapData.Room, to: MapData.Room): { direction: MapData.direction } | undefined {
    for (const [dir, targetId] of Object.entries(from.exits)) {
        if (targetId === to.id) {
            return {direction: dir as MapData.direction};
        }
    }
    for (const [_, targetId] of Object.entries(from.specialExits)) {
        if (targetId === to.id) {
            return undefined;
        }
    }
    return undefined;
}

function getDirectionTowards(from: MapData.Room, to: MapData.Room): PlanarDirection | undefined {
    for (const direction of planarDirections) {
        if (from.exits[direction] === to.id) return direction;
    }
    for (const direction of planarDirections) {
        if (to.exits[direction] === from.id) return oppositeDirections[direction];
    }
    return undefined;
}

function addRegularConnectionPoints(settings: Settings, connection: Connection, points: number[]) {
    const {fromRoom, toRoom, fromDir, toDir} = connection;

    if (points.length === 0) {
        points.push(fromRoom.x, fromRoom.y);
    }

    if (fromDir && regularExits.includes(fromDir)) {
        const fromEdge = getRoomEdgePoint(settings, fromRoom.x, fromRoom.y, fromDir, settings.roomSize / 2);
        points.push(fromEdge.x, fromEdge.y);
    }

    if (toDir && regularExits.includes(toDir)) {
        const toEdge = getRoomEdgePoint(settings, toRoom.x, toRoom.y, toDir, settings.roomSize / 2);
        points.push(toEdge.x, toEdge.y);
    }

    points.push(toRoom.x, toRoom.y);
}

function addSpecialConnectionPoints(connection: Connection, points: number[]) {
    const {fromRoom, toRoom, customLineKey} = connection;

    let room: MapData.Room = fromRoom;
    let customLine: MapData.Line | undefined;

    if (customLineKey) {
        customLine = fromRoom.customLines[customLineKey];
        if (!customLine) {
            customLine = toRoom.customLines[customLineKey];
            room = toRoom;
        }
    }

    if (points.length === 0) {
        points.push(room.x, room.y);
    }

    if (customLine) {
        customLine.points.forEach(point => {
            points.push(point.x, -point.y);
        });
    }

    points.push(toRoom.x, toRoom.y);
}

export function computePathData(
    mapReader: MapReader,
    settings: Settings,
    locations: number[],
    currentArea: number,
    currentZIndex: number,
): PathResult {
    const segments: PathSegment[] = [];
    const innerMarkers: PathInnerMarker[] = [];
    const customLines: PathCustomLine[] = [];

    const rooms = locations
        .map(location => mapReader.getRoom(location))
        .filter((room): room is MapData.Room => room !== undefined);

    let currentSegmentPoints: number[] = [];

    const flushSegment = () => {
        if (currentSegmentPoints.length >= 4) {
            segments.push({points: [...currentSegmentPoints]});
        }
        currentSegmentPoints = [];
    };

    const processInnerConnection = (connection: Connection) => {
        const {fromRoom, toRoom, fromDir, toDir, customLineKey} = connection;

        if (customLineKey) {
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
                customLines.push({points});
            }
        }

        if (fromDir && innerExits.includes(fromDir)) {
            innerMarkers.push({room: fromRoom, direction: fromDir});
        }
        if (toDir && innerExits.includes(toDir)) {
            innerMarkers.push({room: toRoom, direction: toDir});
        }
    };

    for (let i = 0; i < rooms.length - 1; i++) {
        const fromRoom = rooms[i];
        const toRoom = rooms[i + 1];

        const fromVisible = isRoomVisible(fromRoom, currentArea, currentZIndex);
        const toVisible = isRoomVisible(toRoom, currentArea, currentZIndex);

        if (!fromVisible && !toVisible) {
            flushSegment();
            continue;
        }

        if (fromVisible && toVisible) {
            const connection = findConnection(mapReader, fromRoom, toRoom);

            switch (connection.type) {
                case 'regular':
                    addRegularConnectionPoints(settings, connection, currentSegmentPoints);
                    break;
                case 'special':
                    addSpecialConnectionPoints(connection, currentSegmentPoints);
                    break;
                case 'inner':
                    flushSegment();
                    processInnerConnection(connection);
                    break;
                case 'none':
                    if (currentSegmentPoints.length === 0) {
                        currentSegmentPoints.push(fromRoom.x, fromRoom.y);
                    }
                    currentSegmentPoints.push(toRoom.x, toRoom.y);
                    break;
            }
        } else {
            const visibleRoom = fromVisible ? fromRoom : toRoom;
            const invisibleRoom = fromVisible ? toRoom : fromRoom;
            const exitInfo = getExitToRoom(visibleRoom, invisibleRoom);

            if (exitInfo) {
                if (innerExits.includes(exitInfo.direction)) {
                    flushSegment();
                    innerMarkers.push({room: visibleRoom, direction: exitInfo.direction});
                } else if (regularExits.includes(exitInfo.direction)) {
                    if (currentSegmentPoints.length === 0) {
                        currentSegmentPoints.push(visibleRoom.x, visibleRoom.y);
                    }
                    const edgePoint = getRoomEdgePoint(settings, visibleRoom.x, visibleRoom.y, exitInfo.direction, settings.roomSize / 2);
                    const stubEnd = movePoint(visibleRoom.x, visibleRoom.y, exitInfo.direction, settings.roomSize);
                    currentSegmentPoints.push(edgePoint.x, edgePoint.y, stubEnd.x, stubEnd.y);
                    flushSegment();
                }
            } else {
                const dir = getDirectionTowards(visibleRoom, invisibleRoom);
                if (dir) {
                    if (currentSegmentPoints.length === 0) {
                        currentSegmentPoints.push(visibleRoom.x, visibleRoom.y);
                    }
                    const edgePoint = getRoomEdgePoint(settings, visibleRoom.x, visibleRoom.y, dir, settings.roomSize / 2);
                    const stubEnd = movePoint(visibleRoom.x, visibleRoom.y, dir, settings.roomSize);
                    currentSegmentPoints.push(edgePoint.x, edgePoint.y, stubEnd.x, stubEnd.y);
                    flushSegment();
                }
            }
        }
    }

    flushSegment();

    return {segments, innerMarkers, customLines};
}
