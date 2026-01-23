import {Renderer, Settings, CullingMode, RoomShape} from "@src";
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
const roomShapeSelect = document.getElementById("room-shape") as HTMLSelectElement | null;
const cullingModeSelect = document.getElementById("culling-mode") as HTMLSelectElement | null;
const roomSizeSlider = document.getElementById("room-size-slider") as HTMLInputElement | null;
const roomSizeValue = document.getElementById("room-size-value") as HTMLSpanElement | null;
const lineWidthSlider = document.getElementById("line-width-slider") as HTMLInputElement | null;
const lineWidthValue = document.getElementById("line-width-value") as HTMLSpanElement | null;
const roomForm = document.getElementById("room-form") as HTMLFormElement | null;
const roomInput = document.getElementById("room-input") as HTMLInputElement | null;
const roomStatusElement = document.getElementById("room-status") as HTMLDivElement | null;
const lookForm = document.getElementById("look-form") as HTMLFormElement | null;
const lookInput = document.getElementById("look-input") as HTMLInputElement | null;
const lookStatusElement = document.getElementById("look-status") as HTMLDivElement | null;
const destinationForm = document.getElementById("destination-form") as HTMLFormElement | null;
const destinationInput = document.getElementById("destination-input") as HTMLInputElement | null;
const destinationClearButton = document.getElementById("destination-clear") as HTMLButtonElement | null;
const destinationStatusElement = document.getElementById("destination-status") as HTMLDivElement | null;
const cullingStatusElement = document.getElementById("culling-status") as HTMLDivElement | null;
const playerMarkerStrokeColor = document.getElementById("player-marker-stroke-color") as HTMLInputElement | null;
const playerMarkerStrokeAlpha = document.getElementById("player-marker-stroke-alpha") as HTMLInputElement | null;
const playerMarkerStrokeAlphaValue = document.getElementById("player-marker-stroke-alpha-value") as HTMLSpanElement | null;
const playerMarkerFillColor = document.getElementById("player-marker-fill-color") as HTMLInputElement | null;
const playerMarkerFillAlpha = document.getElementById("player-marker-fill-alpha") as HTMLInputElement | null;
const playerMarkerFillAlphaValue = document.getElementById("player-marker-fill-alpha-value") as HTMLSpanElement | null;
const playerMarkerStrokeWidth = document.getElementById("player-marker-stroke-width") as HTMLInputElement | null;
const playerMarkerStrokeWidthValue = document.getElementById("player-marker-stroke-width-value") as HTMLSpanElement | null;
const playerMarkerSize = document.getElementById("player-marker-size") as HTMLInputElement | null;
const playerMarkerSizeValue = document.getElementById("player-marker-size-value") as HTMLSpanElement | null;
const playerMarkerDashEnabled = document.getElementById("player-marker-dash-enabled") as HTMLInputElement | null;

const DEFAULT_STARTING_ROOM_ID = 18938;

const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

let mapReader!: MapReader;
let renderer!: Renderer;
let currentRoomId!: number;
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;

const walkerState: { timeoutId: number | undefined; running: boolean } = { timeoutId: undefined, running: false };

function parseRoomId(input: string | null | undefined) {
    if (!input) {
        return undefined;
    }
    const roomId = Number.parseInt(input, 10);
    if (Number.isNaN(roomId) || roomId <= 0) {
        return undefined;
    }
    return roomId;
}

function getStartingRoomId() {
    const params = new URLSearchParams(window.location.search);
    const requestedRoomId = parseRoomId(params.get("roomId") ?? params.get("room"));

    if (requestedRoomId !== undefined) {
        const requestedRoom = mapReader.getRoom(requestedRoomId);
        if (requestedRoom) {
            return { roomId: requestedRoomId, status: "" } as const;
        }
        return {
            roomId: DEFAULT_STARTING_ROOM_ID,
            status: `Room ${requestedRoomId} not found. Showing default room instead.`,
        } as const;
    }

    return { roomId: DEFAULT_STARTING_ROOM_ID, status: "" } as const;
}

async function loadJson<T>(url: string, label: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${label}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}

async function initialize() {
    try {
        const [mapData, colorData] = await Promise.all([
            loadJson<MapData.Map>(mapDataUrl, "mapExport.json"),
            loadJson<MapData.Env[]>(colorDataUrl, "colors.json"),
        ]);
        mapReader = new MapReader(mapData, colorData);
    } catch (error) {
        console.error("Failed to load map data", error);
        statusElement.textContent = "Failed to load map data.";
        walkerStatusElement.textContent = "Walker unavailable.";
        if (walkerToggleButton) {
            walkerToggleButton.disabled = true;
        }
        if (cullingStatusElement) {
            cullingStatusElement.textContent = "Culling status unavailable.";
        }
        return;
    }

    renderer = new Renderer(stageElement, mapReader);
    startFpsCounter();

    const {roomId: startingRoomId, status: initialRoomStatus} = getStartingRoomId();
    const startingRoom = mapReader.getRoom(startingRoomId);
    renderer.renderHighlight(startingRoom.id, 'yellow')
    currentRoomId = startingRoomId;
    destinationRoomId = undefined;
    currentDestinationPath = undefined;

    if (startingRoom) {
        moveToRoom(startingRoom);
        stopWalker("Walker is stopped. Press Start to begin.");
        if (walkerToggleButton) {
            walkerToggleButton.disabled = false;
        }
    } else {
        statusElement.textContent = "Starting room not found.";
        stopWalker("Walker is idle.");
        if (walkerToggleButton) {
            walkerToggleButton.disabled = true;
        }
    }

    if (initialRoomStatus && roomStatusElement) {
        roomStatusElement.textContent = initialRoomStatus;
    }

    if (explorationToggle) {
        explorationToggle.checked = mapReader.isExplorationEnabled();
    }

    if (roomShapeSelect) {
        roomShapeSelect.value = Settings.roomShape;
    }

    if (cullingModeSelect) {
        cullingModeSelect.value = renderer.getCullingMode();
    }

    if (instantMoveToggle) {
        instantMoveToggle.checked = Settings.instantMapMove;
    }

    if (highlightToggle) {
        highlightToggle.checked = Settings.highlightCurrentRoom;
    }

    if (roomSizeSlider && roomSizeValue) {
        roomSizeSlider.value = Settings.roomSize.toString();
        roomSizeValue.textContent = Settings.roomSize.toFixed(1);
    }

    if (lineWidthSlider && lineWidthValue) {
        lineWidthSlider.value = Settings.lineWidth.toString();
        lineWidthValue.textContent = Settings.lineWidth.toFixed(3);
    }

    if (playerMarkerStrokeColor) {
        playerMarkerStrokeColor.value = Settings.playerMarker.strokeColor;
    }

    if (playerMarkerStrokeAlpha && playerMarkerStrokeAlphaValue) {
        playerMarkerStrokeAlpha.value = Settings.playerMarker.strokeAlpha.toString();
        playerMarkerStrokeAlphaValue.textContent = Settings.playerMarker.strokeAlpha.toFixed(2);
    }

    if (playerMarkerFillColor) {
        playerMarkerFillColor.value = Settings.playerMarker.fillColor;
    }

    if (playerMarkerFillAlpha && playerMarkerFillAlphaValue) {
        playerMarkerFillAlpha.value = Settings.playerMarker.fillAlpha.toString();
        playerMarkerFillAlphaValue.textContent = Settings.playerMarker.fillAlpha.toFixed(2);
    }

    if (playerMarkerStrokeWidth && playerMarkerStrokeWidthValue) {
        playerMarkerStrokeWidth.value = Settings.playerMarker.strokeWidth.toString();
        playerMarkerStrokeWidthValue.textContent = Settings.playerMarker.strokeWidth.toFixed(2);
    }

    if (playerMarkerSize && playerMarkerSizeValue) {
        playerMarkerSize.value = Settings.playerMarker.sizeFactor.toString();
        playerMarkerSizeValue.textContent = Settings.playerMarker.sizeFactor.toFixed(2);
    }

    if (playerMarkerDashEnabled) {
        playerMarkerDashEnabled.checked = Settings.playerMarker.dashEnabled;
    }

    updateCullingStatus();
    attachEventListeners();
}

function attachEventListeners() {
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

    instantMoveToggle?.addEventListener("change", () => {
        Settings.instantMapMove = instantMoveToggle.checked;
    });

    highlightToggle?.addEventListener("change", () => {
        Settings.highlightCurrentRoom = highlightToggle.checked;
        renderer.setPosition(currentRoomId);
    });

    roomShapeSelect?.addEventListener("change", () => {
        const value = (roomShapeSelect.value ?? "rectangle") as RoomShape;
        Settings.roomShape = value;
        renderer.refresh();
    });

    cullingModeSelect?.addEventListener("change", () => {
        const value = (cullingModeSelect.value ?? "indexed") as CullingMode;
        renderer.setCullingMode(value);
        updateCullingStatus();
    });

    roomSizeSlider?.addEventListener("input", () => {
        const value = parseFloat(roomSizeSlider.value);
        Settings.roomSize = value;
        if (roomSizeValue) {
            roomSizeValue.textContent = value.toFixed(1);
        }
        renderer.refresh();
    });

    lineWidthSlider?.addEventListener("input", () => {
        const value = parseFloat(lineWidthSlider.value);
        Settings.lineWidth = value;
        if (lineWidthValue) {
            lineWidthValue.textContent = value.toFixed(3);
        }
        renderer.refresh();
    });

    playerMarkerStrokeColor?.addEventListener("input", () => {
        Settings.playerMarker.strokeColor = playerMarkerStrokeColor.value;
        renderer.setPosition(currentRoomId);
    });

    playerMarkerStrokeAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeAlpha.value);
        Settings.playerMarker.strokeAlpha = value;
        if (playerMarkerStrokeAlphaValue) {
            playerMarkerStrokeAlphaValue.textContent = value.toFixed(2);
        }
        renderer.setPosition(currentRoomId);
    });

    playerMarkerFillColor?.addEventListener("input", () => {
        Settings.playerMarker.fillColor = playerMarkerFillColor.value;
        renderer.setPosition(currentRoomId);
    });

    playerMarkerFillAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerFillAlpha.value);
        Settings.playerMarker.fillAlpha = value;
        if (playerMarkerFillAlphaValue) {
            playerMarkerFillAlphaValue.textContent = value.toFixed(2);
        }
        renderer.setPosition(currentRoomId);
    });

    playerMarkerStrokeWidth?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeWidth.value);
        Settings.playerMarker.strokeWidth = value;
        if (playerMarkerStrokeWidthValue) {
            playerMarkerStrokeWidthValue.textContent = value.toFixed(2);
        }
        renderer.setPosition(currentRoomId);
    });

    playerMarkerSize?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerSize.value);
        Settings.playerMarker.sizeFactor = value;
        if (playerMarkerSizeValue) {
            playerMarkerSizeValue.textContent = value.toFixed(2);
        }
        renderer.setPosition(currentRoomId);
    });

    playerMarkerDashEnabled?.addEventListener("change", () => {
        Settings.playerMarker.dashEnabled = playerMarkerDashEnabled.checked;
        renderer.setPosition(currentRoomId);
    });

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

    roomForm?.addEventListener("submit", event => {
        event.preventDefault();
        if (!roomInput) {
            return;
        }

        const roomId = parseRoomId(roomInput.value);
        if (roomId === undefined) {
            updateRoomStatus("Enter a valid room id.");
            return;
        }

        const room = mapReader.getRoom(roomId);
        if (!room) {
            updateRoomStatus(`Room ${roomId} not found.`);
            return;
        }

        moveToRoom(room);
        updateRoomStatus(`Jumped to room ${room.id}.`);
        if (walkerState.running) {
            walkerStatusElement.textContent = `Jumped to room ${room.id}. Walker continues.`;
        } else {
            walkerStatusElement.textContent = `Moved to room ${room.id}.`;
        }
    });

    lookForm?.addEventListener("submit", event => {
        event.preventDefault();
        if (!lookInput) {
            return;
        }

        const roomId = parseRoomId(lookInput.value);
        if (roomId === undefined) {
            updateLookStatus("Enter a valid room id.");
            return;
        }

        const room = mapReader.getRoom(roomId);
        if (!room) {
            updateLookStatus(`Room ${roomId} not found.`);
            return;
        }

        renderer.centerOn(roomId);
        updateLookStatus(`Looking at room ${room.id}.`);
    });

    walkerToggleButton?.addEventListener("click", () => {
        if (walkerState.running) {
            stopWalker();
        } else {
            startWalker();
        }
    });

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
}

void initialize();

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

function describeCullingMode(mode: CullingMode) {
    switch (mode) {
        case "none":
            return "No culling";
        case "basic":
            return "Classic culling";
        case "indexed":
        default:
            return "Spatial index culling";
    }
}

function updateCullingStatus() {
    if (!cullingStatusElement) {
        return;
    }
    const mode = renderer.getCullingMode();
    const description = describeCullingMode(mode);
    cullingStatusElement.textContent = `Culling mode: ${description}`;
}


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

function moveToRoom(room: MapData.Room) {
    updateRoomInput(room.id);
    updateRoomStatus("");
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

function updateRoomStatus(message: string) {
    if (!roomStatusElement) {
        return;
    }
    roomStatusElement.textContent = message;
}

function updateLookStatus(message: string) {
    if (!lookStatusElement) {
        return;
    }
    lookStatusElement.textContent = message;
}

function updateRoomInput(roomId: number) {
    if (!roomInput) {
        return;
    }
    roomInput.value = roomId.toString();
}

function updateDestinationGuidance() {
    if (!destinationRoomId) {
        updateDestinationStatus("No destination set.");
        currentDestinationPath = undefined;
        return;
    }

    const path = findPathBetweenRooms(currentRoomId, destinationRoomId);
    if (path) {
        renderer.renderPath(path, 'green')
    }
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

