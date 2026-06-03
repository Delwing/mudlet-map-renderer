import {
    MapRenderer,
    createSettings,
    PathFinder,
    compose, identityStyle,
    Parchment, Blueprint, Neon, Sketchy, Isometric, Construction, SciFi, GradientRooms,
    StainedGlass, GraphPaper, Topographic, Watercolor,
    DarkModern, TreasureMap, treasureMapDecorations,
    RippleEffect,
    WaypointOverlay,
    ExplorationLens, ALL_VISIBLE,
    type Style,
} from "@src";
import type {Settings} from "@src";
import {createOffscreenBackend} from "@src/rendering/offscreen";
import MapReader from "@src/reader/MapReader";
import {initControls} from "./controls";
import {initContextMenu} from "./context-menu";
import {Walker} from "./walker";
import {DemoPreview} from "./Preview";
import {
    getDirectionFromKeyboardEvent,
    getDirectionalExitTarget,
    isEditableElement,
} from "./navigation";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const walkerStatusElement = document.getElementById("walker-status") as HTMLDivElement;
const fpsElement = document.getElementById("fps") as HTMLDivElement | null;
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
const pulseMarkerToggle = document.getElementById("pulse-marker-toggle") as HTMLInputElement | null;

const DEFAULT_STARTING_ROOM_ID = 1;
const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

let mapReader!: MapReader;
let renderer!: MapRenderer;
let pathFinder!: PathFinder;
const settings: Settings = createSettings();
const explorationLens = new ExplorationLens();
let explorationEnabled = false;
let currentRoomId!: number;
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;
let pathColor = '#66E64D';
let walker!: Walker;
let preview!: DemoPreview;
let sketchColor = '#444444';
let savedBackgroundColor: string;
let savedLineColor: string;
let savedFontFamily: string;
let updateTerrainRooms: () => void = () => {};
let updateFogOfWar: () => void = () => {};

// --- FPS counter ---

function startFpsCounter() {
    if (!fpsElement) return;
    let lastSampleTime = performance.now();
    let frameCount = 0;
    const updateFps = (timestamp: number) => {
        frameCount += 1;
        const elapsed = timestamp - lastSampleTime;
        if (elapsed >= 500) {
            fpsElement.textContent = `FPS: ${((frameCount / elapsed) * 1000).toFixed(1)}`;
            frameCount = 0;
            lastSampleTime = timestamp;
        }
        requestAnimationFrame(updateFps);
    };
    requestAnimationFrame(updateFps);
}

startFpsCounter();

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

// Play a RippleEffect at the marker on each move via the public addLiveEffect API.
let pulseSeq = 0;
function pulseMarker(room: MapData.Room) {
    if (!pulseMarkerToggle?.checked) return;
    const marker = settings.playerMarker;
    const baseRadius = (settings.roomSize / 2) * marker.sizeFactor;
    const id = `ripple-${pulseSeq++}`;
    renderer.addLiveEffect(id, new RippleEffect(room.x, room.y, {
        color: marker.strokeColor,
        startRadius: baseRadius,
        endRadius: baseRadius * 3,
        strokeWidth: marker.strokeWidth,
        onComplete: () => renderer.removeLiveEffect(id),
    }));
}

function moveToRoom(room: MapData.Room) {
    if (roomInput) roomInput.value = room.id.toString();
    updateStatus(roomStatusElement, "");
    if (explorationLens.addVisited(room.id) && explorationEnabled) {
        renderer.refresh();
    }
    currentRoomId = room.id;
    renderer.setPosition(room.id);
    pulseMarker(room);
    updateAreaStatus(room.area);
    updateAreaSelector();
    populateLevelSelector(room.area, room.z);
    updateDestinationGuidance();
    updateTerrainRooms();
    updateFogOfWar();
}

function updateAreaStatus(areaId: number) {
    if (!explorationEnabled) {
        statusElement.textContent = `Area ${areaId}`;
        return;
    }
    const area = mapReader.getArea(areaId);
    if (!area) {
        statusElement.textContent = `Area ${areaId}`;
        return;
    }
    const rooms = area.getRooms();
    const total = rooms.length;
    let visited = 0;
    for (const r of rooms) {
        if (explorationLens.hasVisited(r.id)) visited++;
    }
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

    // The treasure-map decorations (compass rose + border frame) are a scene
    // overlay, not part of the Style. Clear it on every mode change; re-add below
    // only for the treasure-map mode.
    renderer.removeSceneOverlay("treasure-decor");
    let addTreasureDecor = false;

    // A Style is target-agnostic: the same `style` drives the interactive canvas,
    // SVG export, and PNG export. Adding new render modes is just `compose(...)`.
    let style: Style = identityStyle;

    switch (mode) {
        case "pencil":
            style = Sketchy({jitter, color: sketchColor});
            settings.backgroundColor = '#ffffff';
            break;
        case "parchment":
            style = Parchment;
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "parchment-pencil":
            style = compose(Sketchy({jitter, color: '#4a3728'}), Parchment);
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "isometric": {
            const depth = settings.roomSize * 0.3;
            style = Isometric({depth, rotation: getIsoRotation()});
            break;
        }
        case "isometric-parchment": {
            const depth = settings.roomSize * 0.3;
            style = compose(
                Isometric({depth, rotation: getIsoRotation()}),
                Sketchy({jitter, color: '#4a3728'}),
                Parchment,
            );
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        }
        case "blueprint":
            style = Blueprint;
            settings.backgroundColor = '#0a1628';
            settings.lineColor = '#4a7ab5';
            settings.fontFamily = '"Courier New", monospace';
            break;
        case "neon":
            style = Neon;
            settings.backgroundColor = '#0a0a0f';
            settings.lineColor = '#00ffaa';
            break;
        case "construction":
            style = Construction;
            settings.backgroundColor = '#2a2a2a';
            settings.lineColor = '#ffc200';
            break;
        case "scifi":
            style = SciFi;
            settings.backgroundColor = '#030810';
            settings.lineColor = '#0a2a3d';
            break;
        case "stained-glass":
            style = StainedGlass;
            // Stone-slate surround, not pure black: the leading is near-black, so a
            // lighter backdrop lets the came + exit lines read while panes glow.
            settings.backgroundColor = '#33333b';
            settings.lineColor = '#1c1c22';
            break;
        case "watercolor":
            style = Watercolor();
            settings.backgroundColor = '#fbf7ef';
            settings.lineColor = '#8a8a94';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "graph-paper":
            style = GraphPaper;
            settings.backgroundColor = '#eef3fb';
            settings.lineColor = '#9cc0e8';
            settings.fontFamily = '"Courier New", monospace';
            break;
        case "topographic":
            style = Topographic;
            settings.backgroundColor = '#efe7d2';
            settings.lineColor = '#c9b98f';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "dark-modern":
            style = DarkModern;
            settings.backgroundColor = '#16181d';
            settings.lineColor = '#5b6573';
            settings.fontFamily = 'system-ui, sans-serif';
            break;
        case "treasure-map":
            style = TreasureMap;
            settings.backgroundColor = '#e8cf9e';
            settings.lineColor = '#5a3a22';
            settings.fontFamily = 'Georgia, serif';
            addTreasureDecor = true;
            break;
        case "gradient":
            // Pure shaded-room demo using the new linear-gradient fill.
            style = GradientRooms();
            break;
        case "gradient-parchment":
            // Stops get recoloured through the parchment palette — gradient survives.
            style = compose(Parchment, GradientRooms());
            settings.backgroundColor = '#f4e4c1';
            settings.lineColor = '#5c4033';
            settings.fontFamily = 'Georgia, serif';
            break;
        case "gradient-blueprint":
            style = compose(Blueprint, GradientRooms());
            settings.backgroundColor = '#0a1628';
            settings.lineColor = '#4a7ab5';
            settings.fontFamily = '"Courier New", monospace';
            break;
    }

    renderer.setStyle(style);
    renderer.updateBackground();
    renderer.refresh();
    if (addTreasureDecor) renderer.addSceneOverlay("treasure-decor", treasureMapDecorations());
    preview?.refresh();
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
    // OffscreenCanvas (worker) demo mode — opt-in via ?backend=offscreen.
    // Switching backends means recreating the renderer, so the toggle reloads
    // the page with the param flipped.
    const useOffscreen = new URLSearchParams(location.search).get("backend") === "offscreen";
    const offscreenToggle = document.getElementById("offscreen-toggle") as HTMLInputElement | null;
    if (offscreenToggle) {
        offscreenToggle.checked = useOffscreen;
        offscreenToggle.addEventListener("change", () => {
            const url = new URL(location.href);
            if (offscreenToggle.checked) url.searchParams.set("backend", "offscreen");
            else url.searchParams.delete("backend");
            location.href = url.href;
        });
    }

    renderer = useOffscreen
        ? new MapRenderer(mapReader, settings, stageElement, createOffscreenBackend(stageElement))
        : new MapRenderer(mapReader, settings, stageElement);
    if (useOffscreen) {
        statusElement.textContent = "Rendering in Web Worker (OffscreenCanvas)";
    }
    preview = new DemoPreview(stageElement, renderer);

    // Waypoints — auto-placed labels that avoid rooms, exit lines, and each
    // other (obstacles derived from room adjacency inside the overlay).
    const waypointOverlay = new WaypointOverlay();
    const waypointsToggle = document.getElementById("waypoints-toggle") as HTMLInputElement | null;
    let waypointsEnabled = false;
    const setWaypointsEnabled = (on: boolean) => {
        if (on === waypointsEnabled) return;
        waypointsEnabled = on;
        if (on) renderer.addSceneOverlay("waypoints", waypointOverlay);
        else renderer.removeSceneOverlay("waypoints");
        if (waypointsToggle) waypointsToggle.checked = on;
    };
    waypointsToggle?.addEventListener("change", () => setWaypointsEnabled(waypointsToggle.checked));

    const wpPalette =["#ffcc33", "#4fc3f7", "#81c784", "#e57373", "#ba68c8", "#ffb74d", "#f06292", "#4dd0e1"];
    let wpColorSeq = 0;
    const waypointControls = {
        has: (roomId: number) => waypointOverlay.has(roomId),
        add: (roomId: number, label: string) => {
            waypointOverlay.add({
                roomId, label, color: wpPalette[wpColorSeq++ % wpPalette.length],
                // Demo: clicking a waypoint bubble centres the map on its room.
                onClick: (wp) => {
                    renderer.centerOn(wp.roomId);
                    updateStatus(roomStatusElement, `Clicked waypoint on room ${wp.roomId}.`);
                },
            });
            setWaypointsEnabled(true); // make sure they're visible after adding
        },
        remove: (roomId: number) => waypointOverlay.remove(roomId),
    };

    // Waypoint bubbles aren't part of the renderer's hit-tester (they're overlay
    // shapes), so resolve clicks against the overlay ourselves: convert the
    // pointer to world space and ask the overlay which bubble (if any) was hit.
    let wpClickStart: {x: number; y: number} | null = null;
    stageElement.addEventListener("mousedown", (e) => {
        if (e.button === 0) wpClickStart = {x: e.clientX, y: e.clientY};
    });
    stageElement.addEventListener("mouseup", (e) => {
        const start = wpClickStart;
        wpClickStart = null;
        if (e.button !== 0 || !start || !waypointsEnabled) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (dx * dx + dy * dy > 25) return; // a drag, not a click
        const rect = stageElement.getBoundingClientRect();
        const p = renderer.camera.clientToMapPoint(e.clientX, e.clientY, rect);
        if (!p) return;
        const wp = waypointOverlay.hitTest(p.x, p.y);
        wp?.onClick?.(wp);
    });
    // Pointer cursor when hovering a clickable bubble. Runs after the renderer's
    // own cursor handler (registered earlier), so it only upgrades to "pointer"
    // over a clickable bubble and otherwise leaves the renderer's choice intact.
    stageElement.addEventListener("mousemove", (e) => {
        if (!waypointsEnabled) return;
        const rect = stageElement.getBoundingClientRect();
        const p = renderer.camera.clientToMapPoint(e.clientX, e.clientY, rect);
        if (!p) return;
        if (waypointOverlay.hitTest(p.x, p.y)?.onClick) stageElement.style.cursor = "pointer";
    });

    // Controls
    const controlsResult = initControls(settings, renderer, () => currentRoomId, pathFinder, updateDestinationGuidance, (color) => {
        pathColor = color;
        if (currentDestinationPath) {
            renderer.clearPaths();
            renderer.renderPath(currentDestinationPath, pathColor);
        }
    }, applyRenderMode, mapReader, explorationLens);
    const explorationToggle = controlsResult.explorationToggle;
    updateTerrainRooms = controlsResult.updateTerrainRooms;
    updateFogOfWar = controlsResult.updateFogOfWar;
    initContextMenu(stageElement, renderer, mapReader, moveToRoom, (msg) => updateStatus(roomStatusElement, msg), waypointControls);

    // Walker
    walker = new Walker(mapReader, pathFinder, walkerStatusElement, walkerToggleButton, explorationLens, {
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
    // Showcase multi-colour highlights: passing an array of colours splits a
    // room's highlight into that many equal pie wedges (one colour each). Apply
    // a 2- and 3-colour split to a couple of other rooms in the starting area so
    // the new array form of renderHighlight is visible on load.
    if (startingRoom) {
        const others = (mapReader.getArea(startingRoom.area)?.getRooms() ?? [])
            .filter(r => r.z === startingRoom.z && r.id !== startingRoomId);
        if (others[0]) renderer.renderHighlight(others[0].id, ['#ff3b30', '#0a84ff']);
        if (others[1]) renderer.renderHighlight(others[1].id, ['#ff3b30', '#34c759', '#0a84ff']);

        // Seed a few spread-out waypoints (min separation) so each label has
        // space to auto-place cleanly against its local rooms/exits, rather
        // than a cluster of labels fighting over the same spot.
        const candidates = (mapReader.getArea(startingRoom.area)?.getRooms() ?? [])
            .filter(r => r.z === startingRoom.z)
            .sort((a, b) => Math.hypot(a.x - startingRoom.x, a.y - startingRoom.y)
                - Math.hypot(b.x - startingRoom.x, b.y - startingRoom.y));
        const minSep = Math.max(4, settings.roomSize * 6);
        const picks: typeof candidates = [];
        for (const r of candidates) {
            if (picks.every(p => Math.hypot(p.x - r.x, p.y - r.y) >= minSep)) picks.push(r);
            if (picks.length >= 5) break;
        }
        const wpLabels = ["Shop", "Bank", "Inn", "Smithy", "Temple"];
        const wpColors = ["#ffcc33", "#4fc3f7", "#81c784", "#e57373", "#ba68c8"];
        waypointOverlay.set(picks.map((r, i) => ({
            roomId: r.id, label: wpLabels[i % wpLabels.length], color: wpColors[i % wpColors.length],
        })));
    }
    currentRoomId = startingRoomId;

    if (startingRoom) {
        moveToRoom(startingRoom);
        renderer.fitArea();
        preview.refresh();
        walker.stop("Walker is stopped. Press Start to begin.");
        if (walkerToggleButton) walkerToggleButton.disabled = false;
    } else {
        statusElement.textContent = "Starting room not found.";
        walker.stop("Walker is idle.");
        if (walkerToggleButton) walkerToggleButton.disabled = true;
    }

    if (initialStatus) updateStatus(roomStatusElement, initialStatus);

    if (explorationToggle) {
        explorationToggle.checked = explorationEnabled;
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
        preview?.refresh();
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
        preview?.refresh();
        updateTerrainRooms();
        updateFogOfWar();
    });

    explorationToggle?.addEventListener("change", () => {
        explorationEnabled = explorationToggle.checked;
        renderer.setLens(explorationEnabled ? explorationLens : ALL_VISIBLE);
        renderer.updatePositionMarker(currentRoomId);
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
        const previousArea = renderer.state.currentArea;
        populateLevelSelector(room.area, room.z);
        renderer.clearPosition();
        renderer.centerOn(targetRoomId);
        if (previousArea !== room.area) {
            // centerOn switched the area; recompute the zoom-out lock against the
            // new area's bounds. No position/zoom change — just minZoom.
            const bounds = renderer.getAreaBounds();
            if (bounds) {
                renderer.minZoom = renderer.backend.camera.computeFitZoom(
                    bounds.minX, bounds.maxX, bounds.minY, bounds.maxY,
                );
            }
        }
        if (areaSelect) areaSelect.value = room.area.toString();
        if (levelSelect) levelSelect.value = room.z.toString();
        updateAreaStatus(room.area);
        updateStatus(roomStatusElement, `Navigated to area: ${area.getAreaName()}`);
    }) as EventListener);
}

void initialize();
