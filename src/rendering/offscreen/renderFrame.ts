/**
 * renderFrame — the worker's pure render heart, decoupled from `self.onmessage`.
 *
 * Replays the latest scene + overlays onto a 2D context for the current camera,
 * using the SAME pipeline (`layoutGrid` → cull → `buildDrawCommands` →
 * `renderToCanvas`) and the SAME draw order as the headless {@link CanvasExporter}
 * (background → grid → link → room → overlays → topLabel). Keeping this a plain
 * function — no worker globals — makes it unit-testable against a recording
 * mock context, with no `OffscreenCanvas`/`Worker` required.
 *
 * Imports only worker-safe modules (no Konva, no `document`). Image shapes are
 * skipped in a worker because {@link renderToCanvas}'s default image factory
 * needs `new Image()` (absent in workers) — a documented v1 limitation.
 */

import type {Settings, ViewportBounds} from "../../types/Settings";
import type {Shape} from "../../scene/Shape";
import {layoutGrid} from "../../scene/elements/GridLayout";
import {buildDrawCommands} from "../../draw/DrawCommandBuilder";
import {renderToCanvas, type ImageFactory} from "../../render/CanvasRenderer";
import type {LayerPayload, RenderCamera, SerializableTransform} from "./protocol";
import {forwardFn, inverseFn} from "./serializeTransform";

export interface FrameScene {
    link: LayerPayload;
    room: LayerPayload;
    topLabel: Shape[];
    transform: SerializableTransform;
}

export interface FrameInput {
    scene: FrameScene | null;
    overlays: Shape[];
    camera: RenderCamera;
    viewport: ViewportBounds;
    settings: Settings;
    /** Logical (CSS) pixel dimensions; HiDPI scaling is applied by the caller. */
    width: number;
    height: number;
    /**
     * Resolves an image shape's `src` to a drawable source. In the worker this
     * returns a cached {@link ImageBitmap} (or `null` while it decodes), so
     * data-URL labels and the ambient-light vignette render off-thread.
     */
    imageFactory?: ImageFactory;
}

type TransformFn = (x: number, y: number) => {x: number; y: number};

function transformedBbox(
    minX: number, minY: number, maxX: number, maxY: number,
    fn: TransformFn,
): {minX: number; minY: number; maxX: number; maxY: number} {
    const c1 = fn(minX, minY);
    const c2 = fn(maxX, minY);
    const c3 = fn(maxX, maxY);
    const c4 = fn(minX, maxY);
    return {
        minX: Math.min(c1.x, c2.x, c3.x, c4.x),
        minY: Math.min(c1.y, c2.y, c3.y, c4.y),
        maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
        maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
    };
}

/**
 * Filter a layer's shapes to those intersecting the viewport. Mirrors
 * {@link buildCullingVisibilityMap}: `null` bounds are unmanaged pass-throughs
 * (always drawn), and the forward transform projects world bounds into scene
 * space before the intersection test.
 */
function cullLayer(
    layer: LayerPayload,
    viewport: ViewportBounds,
    fwd: TransformFn | undefined,
): Shape[] {
    const {minX, maxX, minY, maxY} = viewport;
    const out: Shape[] = [];
    for (let i = 0; i < layer.shapes.length; i++) {
        const b = layer.bounds[i];
        if (!b) {
            out.push(layer.shapes[i]);
            continue;
        }
        let bMinX = b.x, bMinY = b.y, bMaxX = b.x + b.width, bMaxY = b.y + b.height;
        if (fwd) {
            const t = transformedBbox(bMinX, bMinY, bMaxX, bMaxY, fwd);
            bMinX = t.minX; bMinY = t.minY; bMaxX = t.maxX; bMaxY = t.maxY;
        }
        if (bMaxX >= minX && bMinX <= maxX && bMaxY >= minY && bMinY <= maxY) {
            out.push(layer.shapes[i]);
        }
    }
    return out;
}

/** Render one frame of the scene + overlays onto `ctx`. */
export function renderFrame(ctx: CanvasRenderingContext2D, input: FrameInput): void {
    const {scene, overlays, camera, viewport, settings, width, height, imageFactory} = input;
    const opts = imageFactory ? {imageFactory} : undefined;

    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (!scene) return;

    const fwd = forwardFn(scene.transform);
    const inv = inverseFn(scene.transform);

    const grid = layoutGrid(viewport, settings, {inverseTransform: inv});
    if (grid.length > 0) renderToCanvas(ctx, buildDrawCommands(grid, camera), opts);

    const link = settings.cullingEnabled ? cullLayer(scene.link, viewport, fwd) : scene.link.shapes;
    if (link.length > 0) renderToCanvas(ctx, buildDrawCommands(link, camera), opts);

    const room = settings.cullingEnabled ? cullLayer(scene.room, viewport, fwd) : scene.room.shapes;
    if (room.length > 0) renderToCanvas(ctx, buildDrawCommands(room, camera), opts);

    if (overlays.length > 0) renderToCanvas(ctx, buildDrawCommands(overlays, camera), opts);

    if (scene.topLabel.length > 0) renderToCanvas(ctx, buildDrawCommands(scene.topLabel, camera), opts);
}
