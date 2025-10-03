import data from "./mapExport.json";
import colors from "./colors.json";
import {Renderer} from "@src";
import MapReader from "@src/reader/MapReader";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const walkerStatusElement = document.getElementById("walker-status") as HTMLDivElement;

const mapReader = new MapReader(data as MapData.Map, colors as MapData.Env[]);
const startingRoomId = 1;

mapReader.decorateWithExploration([startingRoomId]);

const renderer = new Renderer(stageElement, mapReader);
const startingRoom = mapReader.getRoom(startingRoomId);
let currentRoomId = startingRoomId;
let walkerTimeout: number | undefined;

if (startingRoom) {
    const startingArea = mapReader.getExplorationArea(startingRoom.area);
    startingArea?.addVisitedRoom(startingRoom.id);

    renderer.setPosition(startingRoomId);
    updateAreaStatus(startingRoom.area);

    walkerStatusElement.textContent = "Walker preparing first step…";
    scheduleNextStep(600);
} else {
    statusElement.textContent = "Starting room not found.";
    walkerStatusElement.textContent = "Walker is idle.";
}

function getRoomExits(room: MapData.Room) {
    return Object.values(room.exits).filter((exitId): exitId is number => typeof exitId === "number" && exitId > 0);
}

function updateAreaStatus(areaId: number) {
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
        return !area?.hasVisitedRoom(candidate.id);
    });

    const choices = unvisited.length ? unvisited : exits;
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
    const newlyVisited = explorationArea?.addVisitedRoom(nextRoom.id) ?? false;

    currentRoomId = nextRoom.id;

    renderer.setPosition(nextRoom.id);
    updateAreaStatus(nextRoom.area);

    walkerStatusElement.textContent = `Walker moved to room ${nextRoom.id}`;
    scheduleNextStep();
}
