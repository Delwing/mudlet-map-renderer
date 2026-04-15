import {
    MapRenderer,
    createSettings,
    PathFinder,
    KonvaBackend,
    SketchyBackend,
    ParchmentBackend,
    BlueprintBackend,
    NeonBackend,
    IsometricBackend,
    DrawingBackend
} from "@src";
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
const levelSelect = document.getElementById("level-select") as HTMLSelectElement | null;
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

const DEFAULT_STARTING_ROOM_ID = 5468;
const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

let mapReader!: MapReader;
let renderer!: MapRenderer;
let pathFinder!: PathFinder;
const settings: Settings = createSettings();
let currentRoomId!: number;
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;
let pathColor = '#66E64D';
let walker!: Walker;
let sketchColor = '#444444';
let savedBackgroundColor: string;
let savedLineColor: string;
let savedFontFamily: string;
let updateTerrainRooms: () => void = () => {};
let updateFogOfWar: () => void = () => {};

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
    populateLevelSelector(room.area, room.z);
    updateDestinationGuidance();
    updateTerrainRooms();
    updateFogOfWar();
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

function populateLevelSelector(areaId: number, selectedZ?: number) {
    if (!levelSelect) return;
    const area = mapReader.getArea(areaId);
    if (!area) return;
    const levels = area.getZLevels();
    levelSelect.innerHTML = "";
    for (const z of levels) {
        const option = document.createElement("option");
        option.value = z.toString();
        option.textContent = `Z: ${z}`;
        levelSelect.appendChild(option);
    }
    const target = selectedZ ?? (levels.includes(0) ? 0 : levels[0]);
    if (target !== undefined) levelSelect.value = target.toString();
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

    renderer.renderPath(path, pathColor);
    updateStatus(destinationStatusElement, `Biasing towards room ${destinationRoomId} (${path.length - 1} steps away).`);
    currentDestinationPath = path;
}

// --- Render mode helpers ---

function getIsoRotation(): number {
    const el = document.getElementById("iso-rotation") as HTMLInputElement | null;
    return el ? parseInt(el.value, 10) : 30;
}

function applyRenderMode(mode: string) {
    const sketchColorInput = document.getElementById("sketch-color") as HTMLInputElement | null;
    if (sketchColorInput) sketchColor = sketchColorInput.value;
    const jitter = settings.lineWidth * 0.6;
    const isIso = mode.startsWith("isometric");

    // Show/hide iso rotation control
    const isoRotationLabel = document.getElementById("iso-rotation-label") as HTMLElement | null;
    if (isoRotationLabel) isoRotationLabel.style.display = isIso ? '' : 'none';

    // Restore saved settings before applying new mode
    settings.backgroundColor = savedBackgroundColor;
    settings.lineColor = savedLineColor;
    settings.fontFamily = savedFontFamily;
    // Build the decorator chain as a factory (inner backend → wrapped backend).
    // Used for both Konva (interactive) and SVG (export).
    type BackendFactory = (inner: DrawingBackend) => DrawingBackend;
    const identity = (x: number, y: number) => ({x, y});
    let factory: BackendFactory = (inner) => inner;
    let forward = identity;
    let inverse = identity;

    switch (mode) {
        case "pencil":
            factory = (inner) => new SketchyBackend(inner, jitter, sketchColor);
            settings.backgroundColor = '#ffffff';
            break;
        case "parchment":
            factory = (inner) => new ParchmentBackend(inner);
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "parchment-pencil": {
            const pencilColor = '#4a3728';
            factory = (inner) => new SketchyBackend(new ParchmentBackend(inner), jitter, pencilColor);
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        }
        case "isometric": {
            const depth = settings.roomSize * 0.3;
            const rotation = getIsoRotation();
            const isoProto = new IsometricBackend(new KonvaBackend(), {depth, rotation});
            forward = isoProto.getTransform();
            inverse = isoProto.getInverseTransform();
            factory = (inner) => new IsometricBackend(inner, {depth, rotation});
            break;
        }
        case "isometric-parchment": {
            const depth = settings.roomSize * 0.3;
            const pencilColor = '#4a3728';
            const rotation = getIsoRotation();
            const isoProto = new IsometricBackend(new KonvaBackend(), {depth, rotation});
            forward = isoProto.getTransform();
            inverse = isoProto.getInverseTransform();
            factory = (inner) => new IsometricBackend(
                new SketchyBackend(new ParchmentBackend(inner), jitter, pencilColor),
                {depth, rotation},
            );
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        }
        case "blueprint":
            factory = (inner) => new BlueprintBackend(inner);
            settings.backgroundColor = '#0a1628';
            settings.lineColor = '#4a7ab5';
            settings.fontFamily = '"Courier New", monospace';
            break;
        case "neon":
            factory = (inner) => new NeonBackend(inner);
            settings.backgroundColor = '#0a0a0f';
            settings.lineColor = '#00ffaa';
            break;
    }

    renderer.setCullingTransform(forward, inverse);
    renderer.setDrawingBackend(factory(new KonvaBackend()));
    renderer.setDrawingBackendFactory(factory);

    renderer.updateBackground();
    renderer.refresh();
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
    savedBackgroundColor = settings.backgroundColor;
    savedLineColor = settings.lineColor;
    savedFontFamily = settings.fontFamily;
    renderer = new MapRenderer(mapReader, settings, stageElement);

    // Controls & perf
    const controlsResult = initControls(settings, renderer, () => currentRoomId, pathFinder, updateDestinationGuidance, (color) => {
        pathColor = color;
        if (currentDestinationPath) {
            renderer.clearPaths();
            renderer.renderPath(currentDestinationPath, pathColor);
        }
    }, applyRenderMode, mapReader);
    const explorationToggle = controlsResult.explorationToggle;
    updateTerrainRooms = controlsResult.updateTerrainRooms;
    updateFogOfWar = controlsResult.updateFogOfWar;
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
    const requestedRoomId = parseRoomId(params.get("roomId") ?? params.get("room") ?? undefined);
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
        const levels = area.getZLevels();
        const z = levels.includes(0) ? 0 : levels[0] ?? 0;
        populateLevelSelector(areaId, z);
        renderer.clearPosition();
        renderer.drawArea(areaId, z);
        renderer.fitArea();
        updateAreaStatus(areaId);
        updateTerrainRooms();
        updateFogOfWar();
        updateStatus(roomStatusElement, `Switched to area: ${area.getAreaName()}`);
    });

    levelSelect?.addEventListener("change", () => {
        const z = parseInt(levelSelect.value, 10);
        if (isNaN(z)) return;
        const areaId = parseInt(areaSelect?.value ?? "", 10);
        if (isNaN(areaId)) return;
        renderer.clearPosition();
        renderer.drawArea(areaId, z);
        renderer.fitArea();
        updateTerrainRooms();
        updateFogOfWar();
    });

    explorationToggle?.addEventListener("change", () => {
        if (explorationToggle.checked) {
            mapReader.decorateWithExploration();
        } else {
            mapReader.clearExplorationDecoration();
        }
        renderer.setPosition(currentRoomId, false);
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

    // Area exit arrow click → navigate to the target room's area
    stageElement.addEventListener("areaexitclick", ((event: CustomEvent) => {
        const targetRoomId = event.detail?.targetRoomId;
        if (typeof targetRoomId !== 'number') return;
        const room = mapReader.getRoom(targetRoomId);
        if (!room) {
            updateStatus(roomStatusElement, `Target room ${targetRoomId} not found.`);
            return;
        }
        const area = mapReader.getArea(room.area);
        if (!area) return;
        populateLevelSelector(room.area, room.z);
        renderer.clearPosition();
        renderer.centerOn(targetRoomId);
        if (areaSelect) areaSelect.value = room.area.toString();
        if (levelSelect) levelSelect.value = room.z.toString();
        updateAreaStatus(room.area);
        updateStatus(roomStatusElement, `Navigated to area: ${area.getAreaName()}`);
    }) as EventListener);
}

void initialize();
