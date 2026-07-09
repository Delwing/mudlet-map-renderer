/**
 * Compact, fully-resident skeleton of an entire map: one slot per room across
 * parallel typed arrays. This is what lets a multi-million-room map stay in
 * memory — positions/env/area/id as flat columns, no per-room object graph.
 *
 * @public seam — this is the stable contract between skeleton producers and
 * {@link SkeletonMapReader}. Producers include {@link buildSkeleton} (eager,
 * over an already-parsed map) and out-of-process sources such as a Web Worker
 * streaming a Mudlet `.dat` (see `demo/streaming/streaming-worker.ts`). New
 * fields must be optional.
 *
 * Coordinates are RAW Mudlet map space: `y` is stored exactly as it appears in
 * the map data. `SkeletonMapReader` converts to renderer space (negated y)
 * once at construction — producers never need to know renderer conventions.
 *
 * Array ownership transfers to the consumer: `SkeletonMapReader` mutates the
 * arrays in place (the renderer-space conversion). Producers hand over freshly
 * built (or structured-clone-transferred) arrays and must not reuse them.
 */
export interface MapSkeleton {
    count: number;
    x: Int32Array;
    y: Int32Array;
    z: Int32Array;
    area: Int32Array;
    env: Int32Array;
    id: Int32Array;
    /** 12 cardinal exit targets per room (row-major: room i → exits[i*12 + d]); -1 = none. */
    exits: Int32Array;
    areaNames: Record<number, string>;
    /** Areas drawn as adjacency grids — cardinal exit lines are suppressed for these. */
    areaGridMode: Record<number, boolean>;
    customEnvColors: Record<number, {r: number; g: number; b: number}>;
    /** Per-room name in slot order (parallel to the typed arrays). */
    names?: string[];
    /** userData only for rooms that have any (sparse). */
    userData?: {id: number; data: Record<string, string>}[];
    /**
     * Fully-materialised rooms that carry visual detail (custom lines, symbols,
     * special exits, doors, stubs, exit locks). The bulk of the map stays
     * skeleton-only; these override the synthesised room for their id.
     * Raw map space, like the arrays.
     */
    detailRooms?: MapData.Room[];
    labels?: MapData.Label[];
    /** Content-hash (`MapData.Room.hash`) → room id, for every room that has one. */
    hashToId?: Record<string, number>;
}

/**
 * Cardinal exit slots per room, in packing order: room i's exit in direction
 * `SKELETON_DIRS[d]` lives at `exits[i * 12 + d]`.
 */
export const SKELETON_DIRS: readonly MapData.direction[] = [
    "north", "northeast", "east", "southeast", "south", "southwest",
    "west", "northwest", "up", "down", "in", "out",
];
