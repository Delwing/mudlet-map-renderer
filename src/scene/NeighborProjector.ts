import type {IMapReader} from "../reader/MapReader";
import type {IArea} from "../reader/Area";
import {movePoint, planarDirections} from "../directions";
import {longToShort} from "./../reader/Exit";

const PLANAR = new Set<string>(planarDirections);

/**
 * Clone a room placed at projected `(x, y)` in the current area+plane, shifting
 * its custom-line points by the same delta so they follow the room. Custom-line
 * points are stored with world-y negated (`world = -point.y`), so a world shift
 * of `dy` maps to `point.y -= dy`.
 */
export function projectRoom(room: MapData.Room, x: number, y: number, area: number, z: number): MapData.Room {
    const dx = x - room.x;
    const dy = y - room.y;
    let customLines = room.customLines;
    if (customLines && Object.keys(customLines).length > 0 && (dx !== 0 || dy !== 0)) {
        customLines = {};
        for (const [key, line] of Object.entries(room.customLines)) {
            customLines[key] = {...line, points: line.points.map(p => ({x: p.x + dx, y: p.y - dy}))};
        }
    }
    return {...room, x, y, area, z, customLines};
}

/** True if `a`'s exit to `b` (regular or special) is drawn as a custom-line polyline. */
function customLineBetween(a: MapData.Room, b: MapData.Room): boolean {
    const has = (key: string) => !!(a.customLines[key] || a.customLines[longToShort[key as MapData.direction]]);
    for (const [dir, t] of Object.entries(a.exits ?? {})) if (t === b.id && has(dir)) return true;
    for (const [name, t] of Object.entries(a.specialExits ?? {})) if (t === b.id && has(name)) return true;
    return false;
}

/**
 * Gap (in grid units) placed between the boundary room and the first
 * neighbouring-area room. Two units rather than one so the area change reads
 * as a visible seam instead of looking like an ordinary adjacent room.
 */
const BOUNDARY_GAP = 2;

/** One neighbouring-area room, with its position projected into the current area's frame. */
export interface ProjectedRoom {
    /** The real room (its `id` is preserved so the rendered shape stays clickable). */
    room: MapData.Room;
    /** Projected X in the current area's coordinate space. */
    x: number;
    /** Projected Y in the current area's coordinate space. */
    y: number;
}

/** A connector line between two projected room centres (current-area frame). */
export interface ProjectedEdge {
    ax: number;
    ay: number;
    bx: number;
    by: number;
}

/** Result of {@link computeNeighborSpill}: faded preview geometry for neighbouring areas. */
export interface NeighborSpill {
    rooms: ProjectedRoom[];
    edges: ProjectedEdge[];
}

/**
 * Walk the exit graph outward from the player's room (BFS, depth ≤ `maxSteps`)
 * and project the positions of rooms that live in a *different* area onto the
 * current area's coordinate plane, so they can be drawn across the boundary.
 *
 * Areas use independent (area-local) coordinates, so we can't trust a
 * neighbour room's raw x/y to align with the current area. Instead we carry a
 * projected position through the BFS:
 *   - within one area, we advance by the real coordinate delta between rooms;
 *   - crossing a boundary, we place the target one grid step away in the exit's
 *     planar direction (the only geometric anchor we have).
 *
 * Only planar exits (n/s/e/w + diagonals) are followed — non-planar links
 * (up/down/in/out, special exits) can't be placed on the plane. Only rooms on
 * the current z-level (`currentZ`) are collected.
 *
 * Returns `undefined` when there's nothing to draw.
 */
export function computeNeighborSpill(
    mapReader: IMapReader,
    currentAreaId: number,
    currentZ: number,
    playerRoomId: number,
    maxSteps: number,
    isVisible: (room: MapData.Room) => boolean = () => true,
): NeighborSpill | undefined {
    const start = mapReader.getRoom(playerRoomId);
    if (!start || maxSteps <= 0) return undefined;

    interface QueueNode {
        id: number;
        x: number;
        y: number;
        depth: number;
    }

    // roomId → projected position (also serves as the visited set; first/shortest path wins).
    const visited = new Map<number, {x: number; y: number}>();
    visited.set(start.id, {x: start.x, y: start.y});
    const queue: QueueNode[] = [{id: start.id, x: start.x, y: start.y, depth: 0}];

    const ghostIds: number[] = [];
    const edges: ProjectedEdge[] = [];

    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= maxSteps) continue;

        const room = mapReader.getRoom(cur.id);
        if (!room) continue;

        // Follow both regular exits (which carry a planar direction) and special
        // exits (named commands, no direction) so rooms reachable only via a
        // special exit still spill.
        const candidates: Array<{targetId: number; dir?: MapData.direction}> = [
            ...Object.entries(room.exits ?? {}).map(([d, t]) => ({targetId: t, dir: d as MapData.direction})),
            ...Object.values(room.specialExits ?? {}).map(t => ({targetId: t})),
        ];

        for (const {targetId, dir} of candidates) {
            const target = mapReader.getRoom(targetId);
            if (!target || visited.has(target.id)) continue;

            const sameArea = target.area === room.area;
            let nx: number;
            let ny: number;
            if (sameArea) {
                // Same area — coordinates are consistent, advance by the real delta.
                nx = cur.x + (target.x - room.x);
                ny = cur.y + (target.y - room.y);
            } else {
                // Boundary crossing — anchor the neighbour a small gap along the
                // exit. Needs a planar direction, which special exits lack, so
                // we can only cross areas via a regular planar exit.
                if (!dir) continue;
                const stepped = movePoint(cur.x, cur.y, dir, BOUNDARY_GAP);
                if (stepped.x === cur.x && stepped.y === cur.y) continue; // non-planar exit
                nx = stepped.x;
                ny = stepped.y;
            }

            visited.set(target.id, {x: nx, y: ny});
            queue.push({id: target.id, x: nx, y: ny, depth: cur.depth + 1});

            // Collect the target as a ghost only when it's in another area on
            // this plane and actually visible (lens / fog-of-war).
            if (target.area !== currentAreaId && target.z === currentZ && isVisible(target)) {
                ghostIds.push(target.id);
            }
        }
    }

    if (ghostIds.length === 0) return undefined;

    const rooms: ProjectedRoom[] = ghostIds.map(id => {
        const p = visited.get(id)!;
        return {room: mapReader.getRoom(id), x: p.x, y: p.y};
    });

    // Connectors: draw a plain line for every exit (planar regular + special)
    // between two positioned, on-plane rooms where at least one side is spilled.
    // This shows the full local connectivity of the spilled rooms (not just the
    // BFS-discovery edges) and renders each boundary crossing as a plain line.
    // Exits between two current-area rooms are left to the main scene pass.
    // Exits with a custom line are skipped — they're drawn as polylines by the
    // room pass (offset to follow the spilled room). Deduped per room pair.
    const seen = new Set<string>();
    for (const [id, pos] of visited) {
        const room = mapReader.getRoom(id);
        if (!room || room.z !== currentZ || !isVisible(room)) continue;
        const roomSpilled = room.area !== currentAreaId;
        const planarTargets = Object.entries(room.exits ?? {})
            .filter(([d]) => PLANAR.has(d))
            .map(([, t]) => t);
        const targetIds = [...planarTargets, ...Object.values(room.specialExits ?? {})];
        for (const targetId of targetIds) {
            const tpos = visited.get(targetId);
            if (!tpos) continue;
            const target = mapReader.getRoom(targetId);
            if (!target || target.z !== currentZ || !isVisible(target)) continue;
            if (!roomSpilled && target.area === currentAreaId) continue; // both current-area
            if (customLineBetween(room, target) || customLineBetween(target, room)) continue;
            const key = id < targetId ? `${id}-${targetId}` : `${targetId}-${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ax: pos.x, ay: pos.y, bx: tpos.x, by: tpos.y});
        }
    }

    return {rooms, edges};
}

/**
 * Wraps an {@link IMapReader} so that spilled neighbouring-area rooms appear to
 * live in the current area at their projected positions. {@link getRoom}
 * returns a clone of a spilled room with `x`/`y` swapped for the projected
 * coordinates, `area`/`z` rewritten to the current area+plane, and custom-line
 * points shifted by the same delta so they follow the room; every other room and
 * method passes straight through to the base reader.
 *
 * This lets the overlay code (highlights, paths) treat spilled rooms exactly
 * like current-area rooms: existing area/visibility checks pass for them and
 * all coordinate maths lands on the projected positions, with no special cases.
 */
export class ProjectedMapReader implements IMapReader {
    constructor(
        private readonly base: IMapReader,
        private readonly currentArea: number,
        private readonly currentZ: number,
        private readonly projected: Map<number, {x: number; y: number}>,
    ) {}

    getRoom(roomId: number): MapData.Room {
        const room = this.base.getRoom(roomId);
        const p = room ? this.projected.get(roomId) : undefined;
        if (!p) return room;
        return projectRoom(room, p.x, p.y, this.currentArea, this.currentZ);
    }

    getArea(areaId: number): IArea {
        return this.base.getArea(areaId);
    }

    getAreas(): IArea[] {
        return this.base.getAreas();
    }

    getRooms(): MapData.Room[] {
        return this.base.getRooms();
    }

    getColorValue(envId: number): string {
        return this.base.getColorValue(envId);
    }

    getSymbolColor(envId: number, opacity?: number): string {
        return this.base.getSymbolColor(envId, opacity);
    }
}

/** Build a roomId → projected-position map from a {@link NeighborSpill}. */
export function spillPositionMap(spill: NeighborSpill): Map<number, {x: number; y: number}> {
    return new Map(spill.rooms.map(r => [r.room.id, {x: r.x, y: r.y}]));
}
