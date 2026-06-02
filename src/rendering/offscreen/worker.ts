/**
 * OffscreenCanvas worker entry.
 *
 * Thin dispatcher around {@link renderFrame}: owns the transferred
 * `OffscreenCanvas`, stores the latest scene / overlays / camera / settings,
 * and coalesces redraws onto one animation frame (only the latest camera
 * matters, so queued messages are harmless). Resizing a transferred canvas can
 * only happen here, so size/DPR changes are applied worker-side.
 *
 * This module is bundled standalone (see vite.config.ts). It must import ONLY
 * worker-safe code — never Konva, `textMeasure`, or anything touching
 * `document`. A stray such import would surface as a runtime error in the
 * worker and a Konva chunk in the build.
 */

import type {MainToWorkerMessage, RenderCamera, WorkerToMainMessage} from "./protocol";
import {renderFrame, type FrameScene} from "./renderFrame";
import type {Settings, ViewportBounds} from "../../types/Settings";
import type {Shape} from "../../scene/Shape";

/**
 * Minimal dedicated-worker surface. We cast `globalThis` to this instead of
 * using `DedicatedWorkerGlobalScope` so the worker compiles under the project's
 * DOM lib without pulling in (and conflicting with) the WebWorker lib.
 */
interface WorkerScope {
    onmessage: ((ev: MessageEvent<MainToWorkerMessage>) => void) | null;
    postMessage(message: WorkerToMainMessage, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let dpr = 1;
let cssWidth = 1;
let cssHeight = 1;
let settings: Settings | null = null;
let scene: FrameScene | null = null;
let overlays: Shape[] = [];
let camera: RenderCamera = {scale: 1, offsetX: 0, offsetY: 0};
let viewport: ViewportBounds = {minX: 0, maxX: 0, minY: 0, maxY: 0};

let dirty = false;
let rafScheduled = false;

/**
 * src → decoded bitmap cache. `null` means "decoding in flight or failed" so we
 * don't kick off the async decode twice. Workers have no `new Image()`, but
 * `fetch` + `createImageBitmap` decode data URLs (labels, ambient-light
 * vignette) and CORS-permitted URLs into a drawable bitmap.
 */
const images = new Map<string, ImageBitmap | null>();
const MAX_IMAGES = 64;

function requestImage(src: string): CanvasImageSource | null {
    const hit = images.get(src);
    if (hit !== undefined) return hit;
    images.set(src, null);
    fetch(src)
        .then((r) => r.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => {
            // Evict oldest if the cache grows (e.g. the ambient-light vignette
            // src changes as its settings change).
            if (images.size > MAX_IMAGES) {
                const oldest = images.keys().next().value;
                if (oldest !== undefined && oldest !== src) {
                    const stale = images.get(oldest);
                    if (stale) stale.close();
                    images.delete(oldest);
                }
            }
            images.set(src, bmp);
            scheduleDraw();
        })
        .catch(() => {/* leave null — don't retry a broken src */});
    return null;
}

const raf: (cb: (t: number) => void) => void =
    typeof requestAnimationFrame !== "undefined"
        ? (cb) => { requestAnimationFrame(cb); }
        : (cb) => { setTimeout(() => cb(0), 16); };

function scheduleDraw(): void {
    dirty = true;
    if (rafScheduled) return;
    rafScheduled = true;
    raf(() => {
        rafScheduled = false;
        if (dirty) draw();
    });
}

function applyCanvasSize(): void {
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    ctx = canvas.getContext("2d");
}

function draw(): void {
    dirty = false;
    if (!ctx || !settings) return;
    // Map logical (CSS) coordinates to device pixels; renderFrame draws in CSS
    // space and renderToCanvas balances its own save/restore, so this base
    // transform persists across the frame.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFrame(ctx as unknown as CanvasRenderingContext2D, {
        scene,
        overlays,
        camera,
        viewport,
        settings,
        width: cssWidth,
        height: cssHeight,
        imageFactory: requestImage,
    });
}

async function handleExport(requestId: number): Promise<void> {
    if (!canvas) return;
    // Draw synchronously so the snapshot reflects the latest state.
    if (dirty) draw();
    const bitmap = await createImageBitmap(canvas);
    scope.postMessage({type: "export", requestId, bitmap}, [bitmap]);
}

scope.onmessage = (ev: MessageEvent<MainToWorkerMessage>) => {
    const msg = ev.data;
    switch (msg.type) {
        case "init": {
            canvas = msg.canvas;
            dpr = msg.dpr;
            cssWidth = msg.width;
            cssHeight = msg.height;
            settings = msg.settings;
            applyCanvasSize();
            scope.postMessage({type: "ready"}, []);
            scheduleDraw();
            break;
        }
        case "settings": {
            settings = msg.settings;
            scheduleDraw();
            break;
        }
        case "scene": {
            scene = {link: msg.link, room: msg.room, topLabel: msg.topLabel, transform: msg.transform};
            scheduleDraw();
            break;
        }
        case "overlays": {
            overlays = msg.shapes;
            scheduleDraw();
            break;
        }
        case "camera": {
            camera = msg.camera;
            viewport = msg.viewport;
            if (msg.width !== cssWidth || msg.height !== cssHeight) {
                cssWidth = msg.width;
                cssHeight = msg.height;
                applyCanvasSize();
            }
            scheduleDraw();
            break;
        }
        case "resize": {
            cssWidth = msg.width;
            cssHeight = msg.height;
            dpr = msg.dpr;
            applyCanvasSize();
            scheduleDraw();
            break;
        }
        case "export": {
            void handleExport(msg.requestId);
            break;
        }
        case "destroy": {
            canvas = null;
            ctx = null;
            scene = null;
            overlays = [];
            settings = null;
            for (const bmp of images.values()) bmp?.close();
            images.clear();
            break;
        }
    }
};
