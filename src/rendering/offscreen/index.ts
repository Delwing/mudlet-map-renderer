/**
 * Opt-in OffscreenCanvas backend entry point.
 *
 * Renders the map in a Web Worker via `OffscreenCanvas`, moving the per-frame
 * rasterisation off the main thread. The default Konva backend is untouched —
 * you only get this when you wire it in explicitly:
 *
 * ```ts
 * import { MapRenderer } from "mudlet-map-renderer";
 * import { createOffscreenBackend } from "mudlet-map-renderer/offscreen";
 *
 * const renderer = new MapRenderer(reader, settings, container, createOffscreenBackend(container));
 * ```
 *
 * Note the `container` is passed twice: `MapRenderer`'s `backendFactory` hook
 * receives only the `MapState`, so the container is closed over by the factory.
 *
 * Supports image labels, the ambient-light overlay, and live effects (the last
 * via a main-thread Konva overlay stage; the map still rasterises off-thread).
 * The one limitation: `renderer.exportCanvas()` returns `undefined` (the live
 * canvas lives in the worker) — use the headless `CanvasExporter` /
 * `PngBytesExporter` exporters, or `backend.captureViewport()`.
 */

import type {MapState} from "../../MapState";
import type {InteractiveBackend} from "../MapRenderer";
import {OffscreenCanvasBackend, type OffscreenBackendOptions, type WorkerTransport} from "./OffscreenCanvasBackend";
import OffscreenWorker from "./worker?worker&inline";

export {OffscreenCanvasBackend} from "./OffscreenCanvasBackend";
export type {OffscreenBackendOptions, WorkerTransport} from "./OffscreenCanvasBackend";
export type {MainToWorkerMessage, WorkerToMainMessage, SerializableTransform} from "./protocol";

/**
 * Build a backend factory for {@link MapRenderer}'s `backendFactory` parameter.
 * Pass the same `container` you give `MapRenderer`.
 */
export function createOffscreenBackend(
    container?: HTMLDivElement,
    options: OffscreenBackendOptions = {},
): (state: MapState) => InteractiveBackend {
    return (state: MapState) =>
        new OffscreenCanvasBackend(state, container, {
            ...options,
            createTransport: options.createTransport ?? (() => new OffscreenWorker() as unknown as WorkerTransport),
        });
}
