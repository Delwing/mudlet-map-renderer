/// <reference lib="webworker" />
import {parseMudletMap} from "@src/binary";
import type {LoadedMudletMap, LoadMode} from "@src/binary";

// Thin Worker wrapper around the core src/binary/loadMudletMap.ts dispatcher:
// peeks the header to learn the total room count, then either streams the
// .dat into a MapSkeleton (huge maps) or does a normal full parse (small
// maps — see LoadMudletMapOptions.threshold). This file only handles the
// Worker/File/postMessage plumbing; all the actual parsing lives in core so
// any consumer (not just this demo) gets it.

export type {LoadMode};
export interface LoadRequest {file: File; mode: LoadMode; threshold: number}

export type StreamProgress = {type: "progress"; rooms: number; total: number};
export type StreamFinalizing = {type: "finalizing"};
export type StreamError = {type: "error"; message: string};
export type StreamDone = {type: "done"; loaded: LoadedMudletMap; elapsedMs: number};
export type StreamMsg = StreamProgress | StreamFinalizing | StreamError | StreamDone;

self.onmessage = async (e: MessageEvent<LoadRequest>) => {
    try {
        const {file, mode, threshold} = e.data;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const t0 = performance.now();
        const loaded = parseMudletMap(bytes, {
            mode, threshold,
            onProgress: (rooms, total) => self.postMessage({type: "progress", rooms, total} satisfies StreamProgress),
        });
        const elapsedMs = performance.now() - t0;
        // Rooms are all parsed at this point — what's left is handing the
        // result to the main thread. For a huge map (millions of room names/
        // labels not covered by the typed-array transfer list) the browser's
        // own structured-clone of that object graph can itself take a real
        // moment, entirely before the main thread's onmessage even fires —
        // there's no JS hook inside that gap. Send this cheap marker first so
        // at least there's no silent pause with no explanation.
        self.postMessage({type: "finalizing"} satisfies StreamFinalizing);
        const transfer = loaded.kind === "skeleton"
            ? [
                loaded.skeleton.x.buffer, loaded.skeleton.y.buffer, loaded.skeleton.z.buffer,
                loaded.skeleton.area.buffer, loaded.skeleton.env.buffer, loaded.skeleton.id.buffer,
                loaded.skeleton.exits.buffer,
            ]
            : [];
        self.postMessage({type: "done", loaded, elapsedMs} satisfies StreamDone, transfer);
    } catch (err) {
        self.postMessage({
            type: "error",
            message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
        } satisfies StreamError);
    }
};
