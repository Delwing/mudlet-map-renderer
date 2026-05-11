import type {RoomLens} from "./RoomLens";

/**
 * Fog-of-war lens: rooms render only when their id is in the visited set.
 *
 * Default exit treatment is left to {@link RoomLens}'s built-in derivation
 * (both visible → full, one visible → stub, neither → hidden), which produces
 * the "explored frontier" look without any extra wiring.
 *
 * Mutations bump {@link getVersion} so a composing renderer can detect the
 * change; the renderer still needs an explicit `refresh()` after mutation —
 * the lens doesn't emit events.
 */
export class ExplorationLens implements RoomLens {
    private readonly visited: Set<number>;
    private version = 0;

    constructor(visited?: Iterable<number>) {
        this.visited = visited instanceof Set
            ? new Set(visited)
            : new Set(visited ?? []);
    }

    isVisible(room: MapData.Room): boolean {
        return this.visited.has(room.id);
    }

    getVersion(): number {
        return this.version;
    }

    hasVisited(roomId: number): boolean {
        return this.visited.has(roomId);
    }

    getVisitedRoomIds(): number[] {
        return [...this.visited];
    }

    getVisitedCount(): number {
        return this.visited.size;
    }

    /** Returns true if the room was newly added. */
    addVisited(roomId: number): boolean {
        if (this.visited.has(roomId)) return false;
        this.visited.add(roomId);
        this.version++;
        return true;
    }

    /** Returns the number of newly added rooms. */
    addVisitedAll(roomIds: Iterable<number>): number {
        let added = 0;
        for (const id of roomIds) {
            if (!this.visited.has(id)) {
                this.visited.add(id);
                added++;
            }
        }
        if (added > 0) this.version++;
        return added;
    }

    /** Replace the visited set wholesale. */
    setVisited(roomIds: Iterable<number>): void {
        this.visited.clear();
        for (const id of roomIds) this.visited.add(id);
        this.version++;
    }

    clear(): void {
        if (this.visited.size === 0) return;
        this.visited.clear();
        this.version++;
    }
}
