import {streamRooms, convertRoom, convertLabel, readMapFromBuffer, readerExport} from "mudlet-map-binary-reader";
import type {MudletMapHeader} from "mudlet-map-binary-reader";
import MapReader, {type IMapReader} from "../reader/MapReader";
import SkeletonMapReader from "../bigmap/SkeletonMapReader";
import type {MapSkeleton} from "../bigmap/Skeleton";
import {toMapRoom, toMapLabel, hasExtraDetail} from "./convert";

// Cardinal exit fields on MudletRoom, in the order packed into the skeleton
// (12 slots per room; -1 = no exit).
const DIRS = [
    "north", "northeast", "east", "southeast", "south", "southwest",
    "west", "northwest", "up", "down", "in", "out",
] as const;

export type LoadMode = "auto" | "plain" | "streaming";

export interface LoadMudletMapOptions {
    /** 'auto' (default) picks 'plain' or 'streaming' from the header's total room count vs. {@link threshold}. */
    mode?: LoadMode;
    /**
     * Total-room-count cutoff for 'auto' (default 50,000). Below it: a full
     * parse (every field, no skeleton overhead — a `MapSkeleton` has no
     * upside for a map small enough to hold as an object graph). Above it:
     * stream straight into a `MapSkeleton` — the full parsed map and the
     * skeleton are never both resident in memory at once.
     */
    threshold?: number;
    /** Invoked periodically (every 200,000 rooms) — the streaming path only; the full parse has no per-room hook. */
    onProgress?: (roomsRead: number, total: number) => void;
}

/**
 * Portable, structured-clone/transfer-safe parse result — no live reader yet
 * (see {@link readerFromLoadedMap}). Splitting parse from materialisation
 * lets a Web Worker run the (potentially expensive) parse and hand back only
 * the result; the skeleton kind's typed arrays should be passed as
 * transferables (`[skeleton.x.buffer, skeleton.y.buffer, ...]`).
 */
export type LoadedMudletMap =
    | {kind: "plain"; map: MapData.Map; envs: MapData.Env[]}
    | {kind: "skeleton"; skeleton: MapSkeleton};

class HeaderAbort extends Error {}

/** Reads only the header (areas/labels/colours), aborting before the — potentially huge — rooms blob. */
function peekHeader(bytes: Uint8Array): {header: MudletMapHeader; total: number} {
    let result: {header: MudletMapHeader; total: number} | undefined;
    try {
        streamRooms(bytes, () => {
            throw new HeaderAbort();
        }, (hdr) => {
            let total = 0;
            for (const k in hdr.areas ?? {}) total += hdr.areas[k as unknown as number].rooms.length;
            result = {header: hdr, total};
            throw new HeaderAbort();
        });
    } catch (e) {
        if (!(e instanceof HeaderAbort)) throw e;
    }
    if (!result) throw new Error("failed to decode map header");
    return result;
}

function buildAreaGridMode(header: MudletMapHeader): Record<number, boolean> {
    const areaGridMode: Record<number, boolean> = {};
    for (const k in header.areas ?? {}) {
        areaGridMode[k as unknown as number] = header.areas[k as unknown as number].gridMode;
    }
    return areaGridMode;
}

const hasKeys = (o: Record<string, unknown> | undefined | null): boolean => !!o && Object.keys(o).length > 0;

function parsePlain(bytes: Uint8Array): {kind: "plain"; map: MapData.Map; envs: MapData.Env[]} {
    const model = readMapFromBuffer(bytes);
    const {mapData, colors} = readerExport(model);
    const map: MapData.Map = mapData.map(a => ({
        areaName: a.areaName,
        areaId: a.areaId,
        // readerExport already resolves each room's hash — pass-through, no reverse lookup needed here.
        rooms: a.rooms.map(r => toMapRoom(r, a.areaId, r.hash)),
        labels: a.labels.map(l => toMapLabel(l, parseInt(a.areaId))),
    }));
    return {kind: "plain", map, envs: colors};
}

function parseStreaming(
    bytes: Uint8Array, header: MudletMapHeader, total: number,
    onProgress?: (roomsRead: number, total: number) => void,
): {kind: "skeleton"; skeleton: MapSkeleton} {
    const x = new Int32Array(total), y = new Int32Array(total), z = new Int32Array(total);
    const area = new Int32Array(total), env = new Int32Array(total), id = new Int32Array(total);
    const exits = new Int32Array(total * 12).fill(-1);
    const names: string[] = new Array(total);
    const userData: {id: number; data: Record<string, string>}[] = [];
    const detailRooms: MapData.Room[] = [];

    const roomIdToHash: Record<number, string> = {};
    for (const hash in header.mpRoomDbHashToRoomId) {
        roomIdToHash[header.mpRoomDbHashToRoomId[hash]] = hash;
    }

    // Time-based throttle (not every-N-rooms): gives smooth, frequent updates
    // regardless of map size or per-room cost, instead of a handful of big
    // jumps on a huge map or none at all on a small one.
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    let lastReport = now();
    let i = 0;
    streamRooms(bytes, (roomId, room) => {
        x[i] = room.x;
        y[i] = room.y; // RAW map space — SkeletonMapReader converts to renderer space
        z[i] = room.z;
        area[i] = room.area;
        env[i] = room.environment;
        id[i] = roomId;
        const base = i * 12;
        for (let d = 0; d < 12; d++) exits[base + d] = room[DIRS[d]] as number;

        // Name + userData for EVERY room (compact columns), so any room — drawn
        // or looked up by id — is complete, without promoting it to a heavy object.
        names[i] = room.name ?? "";
        if (hasKeys(room.userData)) userData.push({id: roomId, data: room.userData});

        if (hasExtraDetail(room)) {
            const rr = convertRoom(roomId, room, roomIdToHash[roomId]);
            detailRooms.push(toMapRoom(rr, String(room.area), roomIdToHash[roomId]));
        }
        i++;
        if (onProgress) {
            const t = now();
            if (t - lastReport >= 80) {
                lastReport = t;
                onProgress(i, total);
            }
        }
    });
    onProgress?.(i, total); // final tick — guarantees a 100% callback even on a fast/small stream

    const customEnvColors: Record<number, {r: number; g: number; b: number}> = {};
    for (const k in header.mCustomEnvColors ?? {}) {
        const c = header.mCustomEnvColors[k as unknown as number];
        customEnvColors[k as unknown as number] = {r: c.r, g: c.g, b: c.b};
    }

    const labels: MapData.Label[] = [];
    for (const k in header.labels ?? {}) {
        const areaId = Number(k);
        for (const lb of header.labels[areaId]) {
            labels.push(toMapLabel(convertLabel(lb), areaId));
        }
    }

    return {
        kind: "skeleton",
        skeleton: {
            count: i, x, y, z, area, env, id, exits,
            areaNames: header.areaNames ?? {}, areaGridMode: buildAreaGridMode(header), customEnvColors,
            names, userData, detailRooms, labels,
        },
    };
}

/**
 * Parse a Mudlet binary `.dat` buffer, picking the loading strategy from its
 * total room count (see {@link LoadMudletMapOptions}). Returns portable data
 * only — call {@link readerFromLoadedMap} to get a live `IMapReader`, or use
 * {@link loadMudletMap} to do both in one call.
 */
export function parseMudletMap(bytes: Uint8Array, options: LoadMudletMapOptions = {}): LoadedMudletMap {
    const {mode = "auto", threshold = 50_000, onProgress} = options;
    const {header, total} = peekHeader(bytes);
    const effectiveMode = mode === "auto" ? (total > threshold ? "streaming" : "plain") : mode;
    return effectiveMode === "plain" ? parsePlain(bytes) : parseStreaming(bytes, header, total, onProgress);
}

/** Build the live {@link IMapReader} for data produced by {@link parseMudletMap}. */
export function readerFromLoadedMap(loaded: LoadedMudletMap): IMapReader {
    return loaded.kind === "plain" ? new MapReader(loaded.map, loaded.envs) : new SkeletonMapReader(loaded.skeleton);
}

/**
 * Convenience: parse and materialise in one call, on the current thread.
 * `mudlet-map-binary-reader` is a peer dependency; consumers who don't call
 * this never pay the bundle cost. For very large maps, prefer running
 * {@link parseMudletMap} in a Web Worker and calling {@link readerFromLoadedMap}
 * with its result on the main thread.
 */
export function loadMudletMap(bytes: Uint8Array, options?: LoadMudletMapOptions): IMapReader {
    return readerFromLoadedMap(parseMudletMap(bytes, options));
}
