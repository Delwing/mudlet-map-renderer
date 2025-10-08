import data from "./mapExport.json";
import colors from "./colors.json";
import {Renderer, Settings} from "@src";
import type {RoomContextMenuEventDetail} from "@src";
import MapReader from "@src/reader/MapReader";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const walkerStatusElement = document.getElementById("walker-status") as HTMLDivElement;
const fpsElement = document.getElementById("fps") as HTMLDivElement | null;
const contextMenuElement = document.getElementById("context-menu") as HTMLDivElement | null;
const contextMenuContent = document.getElementById("context-menu-content") as HTMLDivElement | null;
const walkerToggleButton = document.getElementById("walker-toggle") as HTMLButtonElement | null;
const explorationToggle = document.getElementById("exploration-toggle") as HTMLInputElement | null;
const instantMoveToggle = document.getElementById("instant-move-toggle") as HTMLInputElement | null;
const highlightToggle = document.getElementById("highlight-toggle") as HTMLInputElement | null;
const destinationForm = document.getElementById("destination-form") as HTMLFormElement | null;
const destinationInput = document.getElementById("destination-input") as HTMLInputElement | null;
const destinationClearButton = document.getElementById("destination-clear") as HTMLButtonElement | null;
const destinationStatusElement = document.getElementById("destination-status") as HTMLDivElement | null;

const mapReader = new MapReader(data as MapData.Map, colors as MapData.Env[]);
const startingRoomId = 6730;

const renderer = new Renderer(stageElement, mapReader);
startFpsCounter();
const startingRoom = mapReader.getRoom(startingRoomId);
let currentRoomId = startingRoomId;
const walkerState: { timeoutId: number | undefined; running: boolean } = { timeoutId: undefined, running: false };
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;

if (startingRoom) {
    mapReader.addVisitedRoom(startingRoom.id);

    renderer.setPosition(startingRoomId);
    updateAreaStatus(startingRoom.area);
    updateDestinationStatus("No destination set.");

    stopWalker("Walker is stopped. Press Start to begin.");
} else {
    statusElement.textContent = "Starting room not found.";
    stopWalker("Walker is idle.");
    if (walkerToggleButton) {
        walkerToggleButton.disabled = true;
    }
}

function hideContextMenu() {
    if (!contextMenuElement) {
        return;
    }
    contextMenuElement.classList.remove("visible");
    contextMenuElement.hidden = true;
}

if (contextMenuElement && contextMenuContent) {
    stageElement.addEventListener("roomcontextmenu", event => {
        const contextEvent = event as CustomEvent<RoomContextMenuEventDetail>;
        const {roomId, position} = contextEvent.detail;
        contextMenuContent.textContent = `Room ${roomId}`;
        contextMenuElement.style.left = `${position.x}px`;
        contextMenuElement.style.top = `${position.y}px`;
        contextMenuElement.hidden = false;
        requestAnimationFrame(() => contextMenuElement.classList.add("visible"));
    });

    const handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            return;
        }
        hideContextMenu();
    };

    stageElement.addEventListener("pointerdown", handlePointerDown);
    stageElement.addEventListener("wheel", hideContextMenu, {passive: true});
    window.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            hideContextMenu();
        }
    });

    stageElement.addEventListener("scroll", hideContextMenu);
    window.addEventListener("pointerdown", event => {
        if (event.button === 2) {
            return;
        }
        if (event.target instanceof Node && contextMenuElement.contains(event.target)) {
            return;
        }
        hideContextMenu();
    });
}

function startFpsCounter() {
    if (!fpsElement) {
        return;
    }

    let lastSampleTime = performance.now();
    let frameCount = 0;

    const updateFps = (timestamp: number) => {
        frameCount += 1;
        const elapsed = timestamp - lastSampleTime;

        if (elapsed >= 500) {
            const fps = (frameCount / elapsed) * 1000;
            fpsElement.textContent = `FPS: ${fps.toFixed(1)}`;
            frameCount = 0;
            lastSampleTime = timestamp;
        }

        requestAnimationFrame(updateFps);
    };

    requestAnimationFrame(updateFps);
}

explorationToggle?.addEventListener("change", () => {
    if (explorationToggle.checked) {
        mapReader.decorateWithExploration();
    } else {
        mapReader.clearExplorationDecoration();
    }
    renderer.setPosition(currentRoomId);
    const currentRoom = mapReader.getRoom(currentRoomId);
    if (currentRoom) {
        updateAreaStatus(currentRoom.area);
    }
    updateDestinationGuidance();
});

if (explorationToggle) {
    explorationToggle.checked = mapReader.isExplorationEnabled();
}

instantMoveToggle?.addEventListener("change", () => {
    Settings.instantMapMove = instantMoveToggle.checked;
});

if (instantMoveToggle) {
    instantMoveToggle.checked = Settings.instantMapMove;
}

highlightToggle?.addEventListener("change", () => {
    Settings.highlightCurrentRoom = highlightToggle.checked;
    renderer.setPosition(currentRoomId);
});

if (highlightToggle) {
    highlightToggle.checked = Settings.highlightCurrentRoom;
}

destinationForm?.addEventListener("submit", event => {
    event.preventDefault();
    if (!destinationInput) {
        return;
    }
    const roomId = Number.parseInt(destinationInput.value, 10);
    if (Number.isNaN(roomId)) {
        updateDestinationStatus("Enter a valid room id.");
        return;
    }

    const room = mapReader.getRoom(roomId);
    if (!room) {
        updateDestinationStatus(`Room ${roomId} not found.`);
        return;
    }

    destinationRoomId = roomId;
    destinationInput.value = roomId.toString();
    updateDestinationGuidance();
});

destinationClearButton?.addEventListener("click", () => {
    destinationRoomId = undefined;
    currentDestinationPath = undefined;
    updateDestinationStatus("Destination cleared. Walking freely.");
    renderer.clearPaths();
    if (destinationInput) {
        destinationInput.value = "";
    }
});

walkerToggleButton?.addEventListener("click", () => {
    if (walkerState.running) {
        stopWalker();
    } else {
        startWalker();
    }
});

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

function inferDirectionFromRooms(source: MapData.Room, target: MapData.Room) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;

    const normalizedX = normalizeDelta(dx);
    const normalizedY = normalizeDelta(dy);

    if (normalizedX === 0 && normalizedY === 0) {
        return undefined;
    }

    return directionFromVector[`${normalizedX}:${normalizedY}`];
}

function getDirectionalExitTarget(room: MapData.Room, direction: MapData.direction) {
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

    if (typeof directExitId === "number" && directExitId > 0) {
        return directExitId;
    }

    const lockedSpecialTargets = new Set(room.mSpecialExitLocks ?? []);

    const specialExits = room.specialExits ?? {};
    for (const exitId of Object.values(specialExits)) {
        if (typeof exitId !== "number" || exitId <= 0) {
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

function moveToRoom(room: MapData.Room) {
    mapReader.addVisitedRoom(room.id);
    currentRoomId = room.id;
    renderer.setPosition(room.id);
    updateAreaStatus(room.area);
    updateDestinationGuidance();
}

function isEditableElement(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function getDirectionFromKeyboardEvent(event: KeyboardEvent) {
    const directionFromCode = keypadCodeToDirection[event.code];
    if (directionFromCode) {
        return directionFromCode;
    }

    const directionFromKey = keypadKeyToDirection[event.key];
    if (directionFromKey) {
        return directionFromKey;
    }

    return undefined;
}

function handleDirectionalMove(direction: MapData.direction) {
    const room = mapReader.getRoom(currentRoomId);
    if (!room) {
        return;
    }

    const nextRoomId = getDirectionalExitTarget(room, direction);
    if (!nextRoomId) {
        walkerStatusElement.textContent = `No ${direction} exit from room ${room.id}.`;
        return;
    }

    const nextRoom = mapReader.getRoom(nextRoomId);
    if (!nextRoom) {
        walkerStatusElement.textContent = `Unable to find destination room ${nextRoomId}.`;
        return;
    }

    moveToRoom(nextRoom);

    if (walkerState.running) {
        walkerStatusElement.textContent = `Manual move ${direction} to room ${nextRoom.id}. Walker continues.`;
    } else {
        walkerStatusElement.textContent = `Moved ${direction} to room ${nextRoom.id}.`;
    }
}

function getRoomExits(room: MapData.Room) {
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
        if (typeof exitId !== "number" || exitId <= 0) {
            return;
        }
        if (lockedSpecialTargets.has(exitId)) {
            return;
        }
        exits.push(exitId);
    });

    return exits;
}

function updateAreaStatus(areaId: number) {
    if (!mapReader.isExplorationEnabled()) {
        statusElement.textContent = `Area ${areaId}`;
        return;
    }

    const area = mapReader.getExplorationArea(areaId);
    if (!area) {
        statusElement.textContent = `Area ${areaId}`;
        return;
    }

    const visited = area.getVisitedRoomCount();
    const total = area.getTotalRoomCount();
    statusElement.innerHTML = `<strong>Area ${areaId}</strong><br/>Visited ${visited} of ${total} rooms`;
}

function randomDelay() {
    return 800 + Math.random() * 1200;
}

const PREFERRED_PATH_PROBABILITY = 0.7;

function updateWalkerToggle() {
    if (!walkerToggleButton) {
        return;
    }
    walkerToggleButton.textContent = walkerState.running ? "Stop walker" : "Start walker";
}

function startWalker() {
    if (walkerState.running) {
        return;
    }
    walkerState.running = true;
    updateWalkerToggle();
    walkerStatusElement.textContent = "Walker preparing first step…";
    scheduleNextStep(600);
}

function stopWalker(message = "Walker paused.") {
    if (walkerState.timeoutId !== undefined) {
        window.clearTimeout(walkerState.timeoutId);
        walkerState.timeoutId = undefined;
    }
    walkerState.running = false;
    updateWalkerToggle();
    walkerStatusElement.textContent = message;
}

function findPreferredRoomId(room: MapData.Room) {
    const queue: number[] = [room.id];
    const cameFrom = new Map<number, number | null>([[room.id, null]]);

    while (queue.length) {
        const currentId = queue.shift()!;
        const currentRoom = mapReader.getRoom(currentId);
        if (!currentRoom) {
            continue;
        }

        const area = mapReader.getExplorationArea(currentRoom.area);
        const isVisited = area?.hasVisitedRoom(currentId) ?? mapReader.hasVisitedRoom(currentId);
        const isStartRoom = currentId === room.id;
        if (!isVisited && !isStartRoom) {
            let stepId = currentId;
            let parentId = cameFrom.get(stepId) ?? null;
            while (parentId !== null && parentId !== room.id) {
                stepId = parentId;
                parentId = cameFrom.get(stepId) ?? null;
            }
            return stepId;
        }

        for (const neighbourId of getRoomExits(currentRoom)) {
            if (!cameFrom.has(neighbourId)) {
                cameFrom.set(neighbourId, currentId);
                queue.push(neighbourId);
            }
        }
    }

    return undefined;
}

function pickNextRoom(room: MapData.Room) {
    const exits = getRoomExits(room)
        .map(exitRoomId => mapReader.getRoom(exitRoomId))
        .filter((candidate): candidate is MapData.Room => Boolean(candidate));

    if (!exits.length) {
        return undefined;
    }

    const preferredExplorationRoomId = findPreferredRoomId(room);
    if (preferredExplorationRoomId !== undefined) {
        const preferredRoom = exits.find(candidate => candidate.id === preferredExplorationRoomId);
        if (preferredRoom && Math.random() < PREFERRED_PATH_PROBABILITY) {
            return preferredRoom;
        }
    }

    const unvisited = exits.filter(candidate => {
        const area = mapReader.getExplorationArea(candidate.area);
        if (area) {
            return !area.hasVisitedRoom(candidate.id);
        }
        return !mapReader.hasVisitedRoom(candidate.id);
    });

    const preferredDestinationRoomId = getNextStepTowardsDestination(room.id);
    const preferredRoom = preferredDestinationRoomId !== undefined
        ? exits.find(candidate => candidate.id === preferredDestinationRoomId)
        : undefined;

    if (preferredRoom) {
        const bias = unvisited.length ? 0.75 : 0.55;
        if (Math.random() < bias) {
            return preferredRoom;
        }
    }

    const choices = unvisited.length ? unvisited : exits;

    return choices[Math.floor(Math.random() * choices.length)];
}

function scheduleNextStep(delay = randomDelay()) {
    const {timeoutId} = walkerState;
    if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
    }
    if (!walkerState.running) {
        walkerState.timeoutId = undefined;
        return;
    }
    walkerState.timeoutId = window.setTimeout(walkStep, delay);
    walkerStatusElement.textContent = `Next step in ${(delay / 1000).toFixed(1)}s`;
}

function walkStep() {
    if (!walkerState.running) {
        return;
    }
    walkerState.timeoutId = undefined;
    const room = mapReader.getRoom(currentRoomId);
    if (!room) {
        stopWalker("Walker lost its position.");
        return;
    }

    const nextRoom = pickNextRoom(room);
    if (!nextRoom) {
        walkerStatusElement.textContent = "Walker reached a dead end.";
        scheduleNextStep();
        return;
    }

    moveToRoom(nextRoom);

    walkerStatusElement.textContent = `Walker moved to room ${nextRoom.id}`;
    scheduleNextStep();
}

function getNextStepTowardsDestination(fromRoomId: number) {
    if (!destinationRoomId || destinationRoomId === fromRoomId) {
        return undefined;
    }
    if (currentDestinationPath && currentDestinationPath[0] === fromRoomId) {
        if (currentDestinationPath.length >= 2) {
            return currentDestinationPath[1];
        }
        return undefined;
    }
    const path = findPathBetweenRooms(fromRoomId, destinationRoomId);
    if (!path || path.length < 2) {
        return undefined;
    }
    currentDestinationPath = path;
    return path[1];
}

function findPathBetweenRooms(startRoomId: number, targetRoomId: number) {
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
                return buildPathFromParents(targetRoomId, parents, startRoomId);
            }

            queue.push(neighborId);
        }
    }

    return undefined;
}

function buildPathFromParents(targetId: number, parents: Map<number, number>, startId: number) {
    const path = [targetId];
    let current = targetId;

    while (current !== startId) {
        const parent = parents.get(current);
        if (parent === undefined) {
            return undefined;
        }
        path.push(parent);
        current = parent;
    }

    path.reverse();
    return path;
}

function updateDestinationStatus(message: string) {
    if (!destinationStatusElement) {
        return;
    }
    destinationStatusElement.textContent = message;
}

function updateDestinationGuidance() {
    if (!destinationRoomId) {
        updateDestinationStatus("No destination set.");
        currentDestinationPath = undefined;
        return;
    }

    const path = findPathBetweenRooms(currentRoomId, destinationRoomId);
    renderer.clearPaths();

    if (!path) {
        updateDestinationStatus(`No route to room ${destinationRoomId}. Wandering randomly.`);
        currentDestinationPath = undefined;
        return;
    }

    if (path.length < 2) {
        updateDestinationStatus(`Already at destination room ${destinationRoomId}.`);
        currentDestinationPath = path;
        return;
    }

    renderer.renderPath(path);
    updateDestinationStatus(`Biasing towards room ${destinationRoomId} (${path.length - 1} steps away).`);
    currentDestinationPath = path;
}

window.addEventListener("keydown", event => {
    if (event.defaultPrevented) {
        return;
    }

    if (isEditableElement(event.target)) {
        return;
    }

    const direction = getDirectionFromKeyboardEvent(event);
    if (!direction) {
        return;
    }

    event.preventDefault();
    handleDirectionalMove(direction);
});
