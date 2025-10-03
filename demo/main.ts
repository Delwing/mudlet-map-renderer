import data from "./mapExport.json";
import colors from "./colors.json";
import {Renderer} from "@src";
import MapReader from "@src/reader/MapReader";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const walkerStatusElement = document.getElementById("walker-status") as HTMLDivElement;
const explorationToggle = document.getElementById("exploration-toggle") as HTMLInputElement | null;
const destinationForm = document.getElementById("destination-form") as HTMLFormElement | null;
const destinationInput = document.getElementById("destination-input") as HTMLInputElement | null;
const destinationClearButton = document.getElementById("destination-clear") as HTMLButtonElement | null;
const destinationStatusElement = document.getElementById("destination-status") as HTMLDivElement | null;

const mapReader = new MapReader(data as MapData.Map, colors as MapData.Env[]);
const startingRoomId = 1;

const visitedRooms = mapReader.decorateWithExploration([startingRoomId]);

const renderer = new Renderer(stageElement, mapReader);
const startingRoom = mapReader.getRoom(startingRoomId);
let currentRoomId = startingRoomId;
let walkerTimeout: number | undefined;
let destinationRoomId: number | undefined;
let currentDestinationPath: number[] | undefined;

if (startingRoom) {
    const startingArea = mapReader.getExplorationArea(startingRoom.area);
    startingArea?.addVisitedRoom(startingRoom.id);

    renderer.setPosition(startingRoomId);
    updateAreaStatus(startingRoom.area);
    updateDestinationStatus("No destination set.");

    walkerStatusElement.textContent = "Walker preparing first step…";
    scheduleNextStep(600);
} else {
    statusElement.textContent = "Starting room not found.";
    walkerStatusElement.textContent = "Walker is idle.";
}

explorationToggle?.addEventListener("change", () => {
    if (explorationToggle.checked) {
        mapReader.decorateWithExploration(visitedRooms);
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

function getRoomExits(room: MapData.Room) {
    return Object.values(room.exits).filter((exitId): exitId is number => typeof exitId === "number" && exitId > 0);
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

function pickNextRoom(room: MapData.Room) {
    const exits = getRoomExits(room)
        .map(exitRoomId => mapReader.getRoom(exitRoomId))
        .filter((candidate): candidate is MapData.Room => Boolean(candidate));

    if (!exits.length) {
        return undefined;
    }

    const unvisited = exits.filter(candidate => {
        const area = mapReader.getExplorationArea(candidate.area);
        if (area) {
            return !area.hasVisitedRoom(candidate.id);
        }
        return !visitedRooms?.has(candidate.id);
    });

    const choices = unvisited.length ? unvisited : exits;

    const preferredRoomId = getNextStepTowardsDestination(room.id);
    const preferredRoom = preferredRoomId ? choices.find(candidate => candidate.id === preferredRoomId) : undefined;

    if (preferredRoom) {
        const bias = unvisited.length ? 0.75 : 0.55;
        if (Math.random() < bias) {
            return preferredRoom;
        }
    }

    return choices[Math.floor(Math.random() * choices.length)];
}

function scheduleNextStep(delay = randomDelay()) {
    if (walkerTimeout) {
        window.clearTimeout(walkerTimeout);
    }
    walkerTimeout = window.setTimeout(walkStep, delay);
    walkerStatusElement.textContent = `Next step in ${(delay / 1000).toFixed(1)}s`;
}

function walkStep() {
    const room = mapReader.getRoom(currentRoomId);
    if (!room) {
        walkerStatusElement.textContent = "Walker lost its position.";
        return;
    }

    const nextRoom = pickNextRoom(room);
    if (!nextRoom) {
        walkerStatusElement.textContent = "Walker reached a dead end.";
        scheduleNextStep();
        return;
    }

    const explorationArea = mapReader.getExplorationArea(nextRoom.area);
    if (explorationArea) {
        explorationArea.addVisitedRoom(nextRoom.id);
    } else {
        visitedRooms?.add(nextRoom.id);
    }

    currentRoomId = nextRoom.id;

    renderer.setPosition(nextRoom.id);
    updateAreaStatus(nextRoom.area);
    updateDestinationGuidance();

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
