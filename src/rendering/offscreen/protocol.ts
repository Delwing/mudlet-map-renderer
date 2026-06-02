/**
 * Message protocol for the OffscreenCanvas worker backend.
 *
 * The main thread runs the (DOM-dependent) scene build, styling, hit-testing
 * and overlay assembly, then ships plain serialisable {@link Shape} lists to
 * the worker. The worker holds the latest scene + overlays and, on each camera
 * update, culls → builds draw commands → rasterises onto the transferred
 * `OffscreenCanvas`.
 *
 * Everything here is structured-clone friendly: shapes are pure data, the
 * transform is flattened to `'identity'` or affine matrices, and the only
 * transferable objects are the `OffscreenCanvas` (init) and an `ImageBitmap`
 * (export result).
 */

import type {Shape} from "../../scene/Shape";
import type {Settings, ViewportBounds} from "../../types/Settings";

/** World-space axis-aligned bounds used for culling. */
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Flattened coordinate transform. `Style.worldToScene` / `sceneToWorld` are
 * closures and cannot cross `postMessage`; we sample them into affine matrices
 * on the main thread. `'identity'` is the fast path for every flat style.
 *
 * Affine matrices follow the DOM/Canvas convention `[a, b, c, d, e, f]`:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export type SerializableTransform =
    | {kind: "identity"}
    | {
          kind: "affine";
          /** World → scene (for culling-bounds projection). */
          forward: AffineMatrix;
          /** Scene → world (for grid Cartesian-bounds computation). */
          inverse: AffineMatrix;
      };

export type AffineMatrix = [number, number, number, number, number, number];

/** Camera transform needed to project world coordinates into render space. */
export interface RenderCamera {
    scale: number;
    offsetX: number;
    offsetY: number;
}

/** One scene layer: styled shapes plus per-shape world-space cull bounds. */
export interface LayerPayload {
    /** Already-styled, scene-space shapes (identity style → world-space). */
    shapes: Shape[];
    /**
     * Per-shape world-space cull bounds, index-aligned with {@link shapes}.
     * `null` marks an unmanaged pass-through (area name, noScaling label) that
     * is always drawn. Shapes fanned out by a style share their parent bounds.
     */
    bounds: Array<Bounds | null>;
}

// --- Main thread → worker ---

export interface InitMessage {
    type: "init";
    canvas: OffscreenCanvas;
    width: number;
    height: number;
    /** Device pixel ratio for crisp rendering on HiDPI displays. */
    dpr: number;
    settings: Settings;
}

export interface SettingsMessage {
    type: "settings";
    settings: Settings;
}

export interface SceneMessage {
    type: "scene";
    link: LayerPayload;
    room: LayerPayload;
    topLabel: Shape[];
    transform: SerializableTransform;
}

export interface OverlaysMessage {
    type: "overlays";
    /** Already-styled overlay shapes (current-room overlay + built-in overlays). */
    shapes: Shape[];
}

export interface CameraMessage {
    type: "camera";
    camera: RenderCamera;
    viewport: ViewportBounds;
    width: number;
    height: number;
}

export interface ResizeMessage {
    type: "resize";
    width: number;
    height: number;
    dpr: number;
}

export interface ExportMessage {
    type: "export";
    requestId: number;
    pixelRatio: number;
}

export interface DestroyMessage {
    type: "destroy";
}

export type MainToWorkerMessage =
    | InitMessage
    | SettingsMessage
    | SceneMessage
    | OverlaysMessage
    | CameraMessage
    | ResizeMessage
    | ExportMessage
    | DestroyMessage;

// --- Worker → main thread ---

export interface ReadyMessage {
    type: "ready";
}

export interface ExportResultMessage {
    type: "export";
    requestId: number;
    bitmap: ImageBitmap;
}

export type WorkerToMainMessage = ReadyMessage | ExportResultMessage;
