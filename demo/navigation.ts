import MapReader from "@src/reader/MapReader";

const exitNumberToDirection: Record<number, MapData.direction> = {
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

const keypadCodeToDirection: Partial<Record<string, MapData.direction>> = {
    Numpad1: "southwest",
    Numpad2: "south",
    Numpad3: "southeast",
    Numpad4: "west",
    Numpad6: "east",
    Numpad7: "northwest",
    Numpad8: "north",
    Numpad9: "northeast",
};

const keypadKeyToDirection: Partial<Record<string, MapData.direction>> = {
    "1": "southwest",
    "2": "south",
    "3": "southeast",
    "4": "west",
    "6": "east",
    "7": "northwest",
    "8": "north",
    "9": "northeast",
};

const directionFromVector: Record<string, MapData.direction> = {
    "0:-1": "north",
    "1:-1": "northeast",
    "-1:-1": "northwest",
    "1:0": "east",
    "-1:0": "west",
    "0:1": "south",
    "1:1": "southeast",
    "-1:1": "southwest",
};

function normalizeDelta(delta: number) {
    if (Math.abs(delta) < 0.5) {
        return 0;
    }
    return delta > 0 ? 1 : -1;
}

export function inferDirectionFromRooms(source: MapData.Room, target: MapData.Room) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const normalizedX = normalizeDelta(dx);
    const normalizedY = normalizeDelta(dy);
    if (normalizedX === 0 && normalizedY === 0) {
        return undefined;
    }
    return directionFromVector[`${normalizedX}:${normalizedY}`];
}

export function getDirectionFromKeyboardEvent(event: KeyboardEvent) {
    return keypadCodeToDirection[event.code] ?? keypadKeyToDirection[event.key] ?? undefined;
}

export function isEditableElement(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function getRoomExits(room: MapData.Room) {
    const lockedDirections = new Set(
        (room.exitLocks ?? [])
            .map(lockId => exitNumberToDirection[lockId])
            .filter((direction): direction is MapData.direction => Boolean(direction)),
    );
    const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

    const exits: number[] = [];

    Object.entries(room.exits ?? {}).forEach(([direction, exitId]) => {
        if (lockedDirections.has(direction as MapData.direction)) {
            return;
        }
        if (exitId > 0) {
            exits.push(exitId);
        }
    });

    Object.values(room.specialExits ?? {}).forEach(exitId => {
        if (exitId <= 0) {
            return;
        }
        if (lockedSpecialTargets.has(exitId)) {
            return;
        }
        exits.push(exitId);
    });

    return exits;
}

export function getDirectionalExitTarget(room: MapData.Room, direction: MapData.direction, mapReader: MapReader) {
    const lockedDirections = new Set(
        (room.exitLocks ?? [])
            .map(lockId => exitNumberToDirection[lockId])
            .filter((lockedDirection): lockedDirection is MapData.direction => Boolean(lockedDirection)),
    );

    if (lockedDirections.has(direction)) {
        return undefined;
    }

    const exits = room.exits ?? {};
    const directExitId = exits[direction];

    if (directExitId > 0) {
        return directExitId;
    }

    const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

    const specialExits = room.specialExits ?? {};
    for (const exitId of Object.values(specialExits)) {
        if (exitId <= 0) {
            continue;
        }
        if (lockedSpecialTargets.has(exitId)) {
            continue;
        }
        const targetRoom = mapReader.getRoom(exitId);
        if (!targetRoom) {
            continue;
        }
        const exitDirection = inferDirectionFromRooms(room, targetRoom);
        if (exitDirection === direction) {
            return exitId;
        }
    }

    return undefined;
}

export function findPathBetweenRooms(startRoomId: number, targetRoomId: number, mapReader: MapReader) {
    const startRoom = mapReader.getRoom(startRoomId);
    const targetRoom = mapReader.getRoom(targetRoomId);
    if (!startRoom || !targetRoom) {
        return undefined;
    }

    if (startRoomId === targetRoomId) {
        return [startRoomId];
    }

    const queue: number[] = [startRoomId];
    const visited = new Set<number>([startRoomId]);
    const parents = new Map<number, number>();

    while (queue.length) {
        const currentId = queue.shift();
        if (currentId === undefined) {
            break;
        }
        const currentRoom = mapReader.getRoom(currentId);
        if (!currentRoom) {
            continue;
        }

        for (const neighborId of getRoomExits(currentRoom)) {
            if (visited.has(neighborId)) {
                continue;
            }
            visited.add(neighborId);
            parents.set(neighborId, currentId);

            if (neighborId === targetRoomId) {
                const path = [targetRoomId];
                let current = targetRoomId;
                while (current !== startRoomId) {
                    const parent = parents.get(current);
                    if (parent === undefined) return undefined;
                    path.push(parent);
                    current = parent;
                }
                path.reverse();
                return path;
            }

            queue.push(neighborId);
        }
    }

    return undefined;
}
