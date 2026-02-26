import {Renderer, createSettings, PathFinder} from "@src";
import type {Settings} from "@src";
import MapReader from "@src/reader/MapReader";
import {initControls, initPerfMonitor} from "./controls";
import {initContextMenu} from "./context-menu";
import {Walker} from "./walker";
import {
    getDirectionFromKeyboardEvent,
    getDirectionalExitTarget,
    isEditableElement,
} from "./navigation";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const walkerStatusElement = document.getElementById("walker-status") as HTMLDivElement;
const walkerToggleButton = document.getElementById("walker-toggle") as HTMLButtonElement | null;
const areaSelect = document.getElementById("area-select") as HTMLSelectElement | null;
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

const DEFAULT_STARTING_ROOM_ID = 3287;
const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

let mapReader!: MapReader;
let renderer!: Renderer;
let pathFinder!: PathFinder;
const settings: Settings = createSettings();
let currentRoomId!: number;
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;
let walker!: Walker;

// --- Helpers ---

function parseRoomId(input: string | null | undefined) {
    if (!input) return undefined;
    const roomId = Number.parseInt(input, 10);
    if (Number.isNaN(roomId) || roomId <= 0) return undefined;
    return roomId;
}

function updateStatus(el: HTMLElement | null, message: string) {
    if (el) el.textContent = message;
}

function moveToRoom(room: MapData.Room) {
    if (roomInput) roomInput.value = room.id.toString();
    updateStatus(roomStatusElement, "");
    mapReader.addVisitedRoom(room.id);
    currentRoomId = room.id;
    renderer.setPosition(room.id);
    updateAreaStatus(room.area);
    updateAreaSelector();
    updateDestinationGuidance();
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

function populateAreaSelector() {
    if (!areaSelect) return;
    const areas = mapReader.getAreas()
        .map(a => ({id: a.getAreaId(), name: a.getAreaName() ?? `Area ${a.getAreaId()}`}))
        .filter(a => !isNaN(a.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    areaSelect.innerHTML = "";
    for (const area of areas) {
        const option = document.createElement("option");
        option.value = area.id.toString();
        option.textContent = `${area.name} (${area.id})`;
        areaSelect.appendChild(option);
    }

    const currentRoom = mapReader.getRoom(currentRoomId);
    if (currentRoom) areaSelect.value = currentRoom.area.toString();
}

function updateAreaSelector() {
    if (!areaSelect) return;
    const currentRoom = mapReader.getRoom(currentRoomId);
    if (currentRoom) areaSelect.value = currentRoom.area.toString();
}

function updateDestinationGuidance() {
    if (!destinationRoomId) {
        updateStatus(destinationStatusElement, "No destination set.");
        currentDestinationPath = undefined;
        return;
    }

    const path = pathFinder.findPath(currentRoomId, destinationRoomId) ?? undefined;
    if (path) renderer.renderPath(path, 'green');
    renderer.clearPaths();

    if (!path) {
        updateStatus(destinationStatusElement, `No route to room ${destinationRoomId}. Wandering randomly.`);
        currentDestinationPath = undefined;
        return;
    }

    if (path.length < 2) {
        updateStatus(destinationStatusElement, `Already at destination room ${destinationRoomId}.`);
        currentDestinationPath = path;
        return;
    }

    renderer.renderPath(path);
    updateStatus(destinationStatusElement, `Biasing towards room ${destinationRoomId} (${path.length - 1} steps away).`);
    currentDestinationPath = path;
}

// --- Initialization ---

async function initialize() {
    try {
        const [mapData, colorData] = await Promise.all([
            fetch(mapDataUrl).then(r => r.json()) as Promise<MapData.Map>,
            fetch(colorDataUrl).then(r => r.json()) as Promise<MapData.Env[]>,
        ]);
        mapReader = new MapReader(mapData, colorData);
    } catch (error) {
        console.error("Failed to load map data", error);
        statusElement.textContent = "Failed to load map data.";
        walkerStatusElement.textContent = "Walker unavailable.";
        if (walkerToggleButton) walkerToggleButton.disabled = true;
        return;
    }

    pathFinder = new PathFinder(mapReader);
    renderer = new Renderer(stageElement, mapReader, settings);

    // Controls & perf
    const {explorationToggle} = initControls(settings, renderer, () => currentRoomId, pathFinder, updateDestinationGuidance);
    initPerfMonitor(settings);
    initContextMenu(stageElement, renderer, mapReader, moveToRoom, (msg) => updateStatus(roomStatusElement, msg));

    // Walker
    walker = new Walker(mapReader, pathFinder, walkerStatusElement, walkerToggleButton, {
        getCurrentRoomId: () => currentRoomId,
        moveToRoom,
        getDestinationRoomId: () => destinationRoomId,
        getDestinationPath: () => currentDestinationPath,
        setDestinationPath: (p) => { currentDestinationPath = p; },
    });

    // Starting room
    const params = new URLSearchParams(window.location.search);
    const requestedRoomId = parseRoomId(params.get("roomId") ?? params.get("room"));
    let startingRoomId = DEFAULT_STARTING_ROOM_ID;
    let initialStatus = "";

    if (requestedRoomId !== undefined) {
        const room = mapReader.getRoom(requestedRoomId);
        if (room) {
            startingRoomId = requestedRoomId;
        } else {
            initialStatus = `Room ${requestedRoomId} not found. Showing default room instead.`;
        }
    }

    const startingRoom = mapReader.getRoom(startingRoomId);
    renderer.renderHighlight(startingRoomId, 'yellow');
    currentRoomId = startingRoomId;

    if (startingRoom) {
        moveToRoom(startingRoom);
        walker.stop("Walker is stopped. Press Start to begin.");
        if (walkerToggleButton) walkerToggleButton.disabled = false;
    } else {
        statusElement.textContent = "Starting room not found.";
        walker.stop("Walker is idle.");
        if (walkerToggleButton) walkerToggleButton.disabled = true;
    }

    if (initialStatus) updateStatus(roomStatusElement, initialStatus);

    if (explorationToggle) {
        explorationToggle.checked = mapReader.isExplorationEnabled();
    }

    populateAreaSelector();

    // --- Form & navigation listeners ---

    areaSelect?.addEventListener("change", () => {
        const areaId = parseInt(areaSelect.value, 10);
        if (isNaN(areaId)) return;
        const area = mapReader.getArea(areaId);
        if (!area) return;
        const rooms = area.getRooms();
        if (!rooms || rooms.length === 0) return;
        const targetRoom = rooms.find(r => r.z === 0) ?? rooms[0];
        moveToRoom(targetRoom);
        updateStatus(roomStatusElement, `Switched to area: ${area.getAreaName()}`);
    });

    explorationToggle?.addEventListener("change", () => {
        if (explorationToggle.checked) {
            mapReader.decorateWithExploration();
        } else {
            mapReader.clearExplorationDecoration();
        }
        renderer.setPosition(currentRoomId);
        const currentRoom = mapReader.getRoom(currentRoomId);
        if (currentRoom) updateAreaStatus(currentRoom.area);
        updateDestinationGuidance();
    });

    walkerToggleButton?.addEventListener("click", () => {
        if (walker.running) walker.stop(); else walker.start();
    });

    roomForm?.addEventListener("submit", event => {
        event.preventDefault();
        if (!roomInput) return;
        const roomId = parseRoomId(roomInput.value);
        if (roomId === undefined) { updateStatus(roomStatusElement, "Enter a valid room id."); return; }
        const room = mapReader.getRoom(roomId);
        if (!room) { updateStatus(roomStatusElement, `Room ${roomId} not found.`); return; }
        moveToRoom(room);
        updateStatus(roomStatusElement, `Jumped to room ${room.id}.`);
        walkerStatusElement.textContent = walker.running
            ? `Jumped to room ${room.id}. Walker continues.`
            : `Moved to room ${room.id}.`;
    });

    lookForm?.addEventListener("submit", event => {
        event.preventDefault();
        if (!lookInput) return;
        const roomId = parseRoomId(lookInput.value);
        if (roomId === undefined) { updateStatus(lookStatusElement, "Enter a valid room id."); return; }
        const room = mapReader.getRoom(roomId);
        if (!room) { updateStatus(lookStatusElement, `Room ${roomId} not found.`); return; }
        renderer.centerOn(roomId);
        updateStatus(lookStatusElement, `Looking at room ${room.id}.`);
    });

    destinationForm?.addEventListener("submit", event => {
        event.preventDefault();
        if (!destinationInput) return;
        const roomId = Number.parseInt(destinationInput.value, 10);
        if (Number.isNaN(roomId)) { updateStatus(destinationStatusElement, "Enter a valid room id."); return; }
        const room = mapReader.getRoom(roomId);
        if (!room) { updateStatus(destinationStatusElement, `Room ${roomId} not found.`); return; }
        destinationRoomId = roomId;
        destinationInput.value = roomId.toString();
        updateDestinationGuidance();
    });

    destinationClearButton?.addEventListener("click", () => {
        destinationRoomId = undefined;
        currentDestinationPath = undefined;
        updateStatus(destinationStatusElement, "Destination cleared. Walking freely.");
        renderer.clearPaths();
        if (destinationInput) destinationInput.value = "";
    });

    window.addEventListener("keydown", event => {
        if (event.defaultPrevented || isEditableElement(event.target)) return;
        const direction = getDirectionFromKeyboardEvent(event);
        if (!direction) return;
        event.preventDefault();

        const room = mapReader.getRoom(currentRoomId);
        if (!room) return;
        const nextRoomId = getDirectionalExitTarget(room, direction, mapReader);
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
        walkerStatusElement.textContent = walker.running
            ? `Manual move ${direction} to room ${nextRoom.id}. Walker continues.`
            : `Moved ${direction} to room ${nextRoom.id}.`;
    });
}

void initialize();
