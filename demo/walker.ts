import MapReader from "@src/reader/MapReader";
import PathFinder from "@src/PathFinder";
import {ExplorationLens} from "@src";
import {getRoomExits} from "./navigation";

const PREFERRED_PATH_PROBABILITY = 0.7;

export type WalkerCallbacks = {
    getCurrentRoomId: () => number;
    moveToRoom: (room: MapData.Room) => void;
    getDestinationRoomId: () => number | undefined;
    getDestinationPath: () => number[] | undefined;
    setDestinationPath: (path: number[] | undefined) => void;
};

export class Walker {
    private readonly mapReader: MapReader;
    private readonly pathFinder: PathFinder;
    private readonly explorationLens: ExplorationLens;
    private readonly walkerStatusElement: HTMLDivElement;
    private readonly walkerToggleButton: HTMLButtonElement | null;
    private readonly callbacks: WalkerCallbacks;
    private timeoutId: number | undefined;
    running = false;

    constructor(
        mapReader: MapReader,
        pathFinder: PathFinder,
        walkerStatusElement: HTMLDivElement,
        walkerToggleButton: HTMLButtonElement | null,
        explorationLens: ExplorationLens,
        callbacks: WalkerCallbacks,
    ) {
        this.mapReader = mapReader;
        this.pathFinder = pathFinder;
        this.explorationLens = explorationLens;
        this.walkerStatusElement = walkerStatusElement;
        this.walkerToggleButton = walkerToggleButton;
        this.callbacks = callbacks;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.updateToggle();
        this.walkerStatusElement.textContent = "Walker preparing first step…";
        this.scheduleNextStep(600);
    }

    stop(message = "Walker paused.") {
        if (this.timeoutId !== undefined) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        this.running = false;
        this.updateToggle();
        this.walkerStatusElement.textContent = message;
    }

    private updateToggle() {
        if (this.walkerToggleButton) {
            this.walkerToggleButton.textContent = this.running ? "Stop walker" : "Start walker";
        }
    }

    private scheduleNextStep(delay = this.randomDelay()) {
        if (this.timeoutId !== undefined) {
            window.clearTimeout(this.timeoutId);
        }
        if (!this.running) {
            this.timeoutId = undefined;
            return;
        }
        this.timeoutId = window.setTimeout(() => this.walkStep(), delay);
        this.walkerStatusElement.textContent = `Next step in ${(delay / 1000).toFixed(1)}s`;
    }

    private walkStep() {
        if (!this.running) return;
        this.timeoutId = undefined;
        const room = this.mapReader.getRoom(this.callbacks.getCurrentRoomId());
        if (!room) {
            this.stop("Walker lost its position.");
            return;
        }

        const nextRoom = this.pickNextRoom(room);
        if (!nextRoom) {
            this.walkerStatusElement.textContent = "Walker reached a dead end.";
            this.scheduleNextStep();
            return;
        }

        this.callbacks.moveToRoom(nextRoom);
        this.walkerStatusElement.textContent = `Walker moved to room ${nextRoom.id}`;
        this.scheduleNextStep();
    }

    private pickNextRoom(room: MapData.Room) {
        const exits = getRoomExits(room)
            .map(exitRoomId => this.mapReader.getRoom(exitRoomId))
            .filter((candidate): candidate is MapData.Room => Boolean(candidate));

        if (!exits.length) return undefined;

        const preferredExplorationRoomId = this.findPreferredRoomId(room);
        if (preferredExplorationRoomId !== undefined) {
            const preferredRoom = exits.find(candidate => candidate.id === preferredExplorationRoomId);
            if (preferredRoom && Math.random() < PREFERRED_PATH_PROBABILITY) {
                return preferredRoom;
            }
        }

        const unvisited = exits.filter(candidate => !this.explorationLens.hasVisited(candidate.id));

        const preferredDestinationRoomId = this.getNextStepTowardsDestination(room.id);
        const preferredRoom = preferredDestinationRoomId !== undefined
            ? exits.find(candidate => candidate.id === preferredDestinationRoomId)
            : undefined;

        if (preferredRoom) {
            const bias = unvisited.length ? 0.75 : 0.55;
            if (Math.random() < bias) return preferredRoom;
        }

        const choices = unvisited.length ? unvisited : exits;
        return choices[Math.floor(Math.random() * choices.length)];
    }

    private findPreferredRoomId(room: MapData.Room) {
        const queue: number[] = [room.id];
        const cameFrom = new Map<number, number | null>([[room.id, null]]);

        while (queue.length) {
            const currentId = queue.shift()!;
            const currentRoom = this.mapReader.getRoom(currentId);
            if (!currentRoom) continue;

            const isVisited = this.explorationLens.hasVisited(currentId);
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

    private getNextStepTowardsDestination(fromRoomId: number) {
        const destinationRoomId = this.callbacks.getDestinationRoomId();
        if (!destinationRoomId || destinationRoomId === fromRoomId) return undefined;

        const currentPath = this.callbacks.getDestinationPath();
        if (currentPath && currentPath[0] === fromRoomId) {
            if (currentPath.length >= 2) return currentPath[1];
            return undefined;
        }

        const path = this.pathFinder.findPath(fromRoomId, destinationRoomId);
        if (!path || path.length < 2) return undefined;
        this.callbacks.setDestinationPath(path);
        return path[1];
    }

    private randomDelay() {
        return 800 + Math.random() * 1200;
    }
}
