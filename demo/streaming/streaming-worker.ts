/// <reference lib="webworker" />
import {streamRooms, convertRoom} from "mudlet-map-binary-reader";
import type {RendererRoom} from "mudlet-map-binary-reader";

// Streams a Mudlet .dat into the pieces of a MapSkeleton (src/bigmap/Skeleton),
// then transfers the typed-array buffers zero-copy to the main thread, where
// they are assembled and handed to the core SkeletonMapReader. Everything is
// RAW map space — the reader owns the renderer-space conversion.
//
// This worker is the only part of the streaming demo still bound to the
// sibling reader repo (vite.streaming.config.ts aliases mudlet-map-binary-reader
// to its source): streamRooms/convertRoom are not yet published. Once they
// are, this file works against the npm package unchanged.

class GrowInt32 {
    buf: Int32Array;
    len = 0;
    constructor(cap = 1 << 16) {
        this.buf = new Int32Array(cap);
    }
    push(v: number) {
        if (this.len === this.buf.length) {
            const n = new Int32Array(this.buf.length * 2);
            n.set(this.buf);
            this.buf = n;
        }
        this.buf[this.len++] = v;
    }
    trimmed(): Int32Array {
        return this.buf.slice(0, this.len);
    }
}

// Cardinal exit fields on MudletRoom, in the order packed into the skeleton
// (12 slots per room; -1 = no exit).
const DIRS = [
    "north", "northeast", "east", "southeast", "south", "southwest",
    "west", "northwest", "up", "down", "in", "out",
] as const;

interface ColorOut {alpha: number; r: number; g: number; b: number}
export interface LabelOut {
    labelId: number; areaId: number;
    X: number; Y: number; Z: number; Width: number; Height: number;
    Text: string; FgColor: ColorOut; BgColor: ColorOut;
    noScaling?: boolean; showOnTop?: boolean; pixMap?: string;
}

export type StreamReady = {
    type: "ready";
    count: number;
    elapsedMs: number;
    areaNames: Record<number, string>;
    areaGridMode: Record<number, boolean>;
    customEnvColors: Record<number, {r: number; g: number; b: number}>;
    x: Int32Array;
    y: Int32Array;
    z: Int32Array;
    area: Int32Array;
    env: Int32Array;
    id: Int32Array;
    exits: Int32Array; // 12 per room, row-major (room i → exits[i*12 + d])
    /** Fully-converted rooms that carry visual detail (symbol/customLines/specialExits/doors/stubs). */
    heavyRooms: RendererRoom[];
    labels: LabelOut[];
    /** Per-room name, indexed in stream order (parallel to the skeleton arrays). */
    names: string[];
    /** userData only for rooms that have any (sparse). */
    userData: {id: number; data: Record<string, string>}[];
};

const hasKeys = (o: Record<string, unknown> | undefined | null): boolean =>
    !!o && Object.keys(o).length > 0;

function pixToBase64(pm: Uint8Array | string | undefined): string {
    if (!pm) return "";
    if (typeof pm === "string") return pm;
    let s = "";
    for (let i = 0; i < pm.length; i++) s += String.fromCharCode(pm[i]);
    return btoa(s);
}
export type StreamTotal = {type: "total"; total: number};
export type StreamProgress = {type: "progress"; rooms: number};
export type StreamError = {type: "error"; message: string};
export type StreamMsg = StreamReady | StreamTotal | StreamProgress | StreamError;

self.onmessage = async (e: MessageEvent<{file: File}>) => {
    try {
        const bytes = new Uint8Array(await e.data.file.arrayBuffer());
        const X = new GrowInt32(), Y = new GrowInt32(), Z = new GrowInt32();
        const AREA = new GrowInt32(), ENV = new GrowInt32(), ID = new GrowInt32();
        const EXITS = new GrowInt32(1 << 20);
        const heavyRooms: RendererRoom[] = [];
        const names: string[] = [];
        const userData: {id: number; data: Record<string, string>}[] = [];

        let n = 0;
        const t0 = performance.now();
        const header = streamRooms(bytes, (id, room) => {
            X.push(room.x);
            Y.push(room.y); // RAW map space — SkeletonMapReader converts to renderer space
            Z.push(room.z);
            AREA.push(room.area);
            ENV.push(room.environment);
            ID.push(id);
            for (const d of DIRS) EXITS.push(room[d] as number);

            // Name + userData for EVERY room (compact columns), so any room — drawn
            // or looked up by id — is complete, without promoting it to a heavy object.
            names.push(room.name ?? "");
            if (hasKeys(room.userData)) userData.push({id, data: room.userData});

            // Keep full data only for rooms with actual visual detail; the bulk
            // (plain terrain) is fully described by the skeleton + exits array.
            if (room.symbol || hasKeys(room.customLines) || hasKeys(room.mSpecialExits) ||
                room.stubs?.length || hasKeys(room.doors) || room.exitLocks?.length) {
                heavyRooms.push(convertRoom(id, room));
            }
            if (++n % 200000 === 0) self.postMessage({type: "progress", rooms: n} satisfies StreamProgress);
        }, (hdr) => {
            // Header is decoded before the rooms: total = Σ area.rooms.length.
            let total = 0;
            for (const k in hdr.areas ?? {}) total += hdr.areas[k as unknown as number].rooms.length;
            self.postMessage({type: "total", total} satisfies StreamTotal);
        });

        const x = X.trimmed(), y = Y.trimmed(), z = Z.trimmed();
        const area = AREA.trimmed(), env = ENV.trimmed(), id = ID.trimmed();
        const exits = EXITS.trimmed();
        const custom: Record<number, {r: number; g: number; b: number}> = {};
        for (const k in header.mCustomEnvColors ?? {}) {
            const c = header.mCustomEnvColors[k as unknown as number];
            custom[k as unknown as number] = {r: c.r, g: c.g, b: c.b};
        }
        const areaGridMode: Record<number, boolean> = {};
        for (const k in header.areas ?? {}) {
            areaGridMode[k as unknown as number] = header.areas[k as unknown as number].gridMode;
        }

        const labels: LabelOut[] = [];
        for (const k in header.labels ?? {}) {
            const areaId = Number(k);
            for (const lb of header.labels[areaId]) {
                labels.push({
                    labelId: lb.id, areaId,
                    X: lb.pos[0], Y: lb.pos[1], Z: lb.pos[2],
                    Width: lb.size[0], Height: lb.size[1],
                    Text: lb.text,
                    FgColor: {alpha: lb.fgColor.alpha, r: lb.fgColor.r, g: lb.fgColor.g, b: lb.fgColor.b},
                    BgColor: {alpha: lb.bgColor.alpha, r: lb.bgColor.r, g: lb.bgColor.g, b: lb.bgColor.b},
                    noScaling: lb.noScaling, showOnTop: lb.showOnTop,
                    pixMap: pixToBase64(lb.pixMap),
                });
            }
        }

        self.postMessage(
            {
                type: "ready",
                count: n,
                elapsedMs: performance.now() - t0,
                areaNames: header.areaNames ?? {},
                areaGridMode,
                customEnvColors: custom,
                x, y, z, area, env, id, exits,
                heavyRooms, labels, names, userData,
            } satisfies StreamReady,
            [x.buffer, y.buffer, z.buffer, area.buffer, env.buffer, id.buffer, exits.buffer],
        );
    } catch (err) {
        self.postMessage({
            type: "error",
            message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
        } satisfies StreamError);
    }
};
