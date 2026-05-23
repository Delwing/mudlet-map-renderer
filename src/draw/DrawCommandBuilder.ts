/**
 * {@link buildDrawCommands} — single source of truth for camera transform math.
 *
 * Walks a {@link SceneIR}-shaped tree (already passed through styles) and
 * produces a flat {@link DrawCommand} list per logical layer. Coordinates
 * arrive in world space; commands leave in render space (camera scale and
 * pan applied), with stroke widths and corner radii already scaled.
 *
 * `noScale` group shapes are emitted as `pushTransform`/`popTransform`
 * pairs: the group origin is placed at its world-mapped screen position,
 * but the children render at fixed pixel size regardless of zoom — the
 * legacy `RecordingLayerNode.canScaleNoScalingGroups` invariant.
 */

import type {
    DrawCommand,
    DrawCommandBatch,
    LineCommand,
    PolygonCommand,
    RectCommand,
    TextCommand,
} from "./DrawCommand";
import {
    transformFill,
    type GroupShape,
    type LayerId,
    type Shape,
} from "../scene/Shape";

/** Camera state needed to project world coordinates into render space. */
export interface CameraTransform {
    /** Pixels per world unit. */
    scale: number;
    /** Render-space origin in pixels. */
    offsetX: number;
    offsetY: number;
}

const DEFAULT_LAYER: LayerId = "room";

/**
 * Build per-layer {@link DrawCommandBatch}es from a list of world-space shapes
 * and an active camera transform.
 *
 * Layer order in the result follows first-appearance order; renderers iterate
 * the array as-is (z-order is the caller's responsibility — typically scene
 * layout uses the LayerId taxonomy to pre-sort).
 */
export function buildDrawCommands(
    shapes: Shape[],
    camera: CameraTransform,
): DrawCommandBatch[] {
    const batches = new Map<LayerId, DrawCommand[]>();

    function commandsFor(layer: LayerId): DrawCommand[] {
        let bucket = batches.get(layer);
        if (!bucket) {
            bucket = [];
            batches.set(layer, bucket);
        }
        return bucket;
    }

    function emitShape(
        shape: Shape,
        worldX: number,
        worldY: number,
        scale: number,
        offsetX: number,
        offsetY: number,
        layerOverride: LayerId | undefined,
    ) {
        const layer = shape.layer ?? layerOverride ?? DEFAULT_LAYER;

        switch (shape.type) {
            case "rect": {
                const x = (worldX + shape.x) * scale + offsetX;
                const y = (worldY + shape.y) * scale + offsetY;
                const w = shape.width * scale;
                const h = shape.height * scale;
                const cmd: RectCommand = {
                    type: "rect",
                    x, y, w, h,
                    fill: transformFill(shape.paint.fill, worldX, worldY, scale, offsetX, offsetY),
                    stroke: shape.paint.stroke,
                    sw: (shape.paint.strokeWidth ?? 0) * scale,
                    cr: (shape.cornerRadius ?? 0) * scale,
                    dash: scaleDash(shape.paint.dash, scale, shape.paint.dashEnabled),
                };
                commandsFor(layer).push(cmd);
                return;
            }
            case "circle": {
                commandsFor(layer).push({
                    type: "circle",
                    cx: (worldX + shape.cx) * scale + offsetX,
                    cy: (worldY + shape.cy) * scale + offsetY,
                    r: shape.radius * scale,
                    fill: transformFill(shape.paint.fill, worldX, worldY, scale, offsetX, offsetY),
                    stroke: shape.paint.stroke,
                    sw: (shape.paint.strokeWidth ?? 0) * scale,
                    dash: scaleDash(shape.paint.dash, scale, shape.paint.dashEnabled),
                });
                return;
            }
            case "line": {
                const cmd: LineCommand = {
                    type: "line",
                    points: scalePoints(shape.points, worldX, worldY, scale, offsetX, offsetY),
                    stroke: shape.paint.stroke,
                    sw: (shape.paint.strokeWidth ?? 0) * scale,
                    dash: scaleDash(shape.paint.dash, scale, shape.paint.dashEnabled),
                    lineCap: shape.lineCap,
                    lineJoin: shape.lineJoin,
                    alpha: shape.paint.alpha,
                };
                commandsFor(layer).push(cmd);
                return;
            }
            case "polygon": {
                const cmd: PolygonCommand = {
                    type: "polygon",
                    vertices: scalePoints(shape.vertices, worldX, worldY, scale, offsetX, offsetY),
                    fill: transformFill(shape.paint.fill, worldX, worldY, scale, offsetX, offsetY),
                    stroke: shape.paint.stroke,
                    sw: (shape.paint.strokeWidth ?? 0) * scale,
                };
                commandsFor(layer).push(cmd);
                return;
            }
            case "text": {
                const t = scaleTransform(shape.transform, worldX, worldY, scale, offsetX, offsetY);
                // When a transform is set the matrix carries position; the
                // command's x/y is zero so renderers don't double-translate.
                const x = t ? 0 : (worldX + shape.x) * scale + offsetX;
                const y = t ? 0 : (worldY + shape.y) * scale + offsetY;
                const cmd: TextCommand = {
                    type: "text",
                    x, y,
                    text: shape.text,
                    fontSize: shape.fontSize * scale,
                    fontFamily: shape.fontFamily ?? "sans-serif",
                    fontStyle: shape.fontStyle ?? "normal",
                    fill: shape.fill ?? "black",
                    stroke: shape.stroke,
                    sw: (shape.strokeWidth ?? 0) * scale,
                    align: shape.align ?? "left",
                    vAlign: shape.verticalAlign ?? "top",
                    w: (shape.width ?? 0) * scale,
                    h: (shape.height ?? 0) * scale,
                    baselineRatio: shape.baselineRatio,
                    konvaCorrectionRatio: shape.konvaCorrectionRatio,
                    transform: t,
                };
                commandsFor(layer).push(cmd);
                return;
            }
            case "image": {
                const t = scaleTransform(shape.transform, worldX, worldY, scale, offsetX, offsetY);
                const x = t ? 0 : (worldX + shape.x) * scale + offsetX;
                const y = t ? 0 : (worldY + shape.y) * scale + offsetY;
                commandsFor(layer).push({
                    type: "image",
                    x, y,
                    w: shape.width * scale,
                    h: shape.height * scale,
                    src: shape.src,
                    transform: t,
                });
                return;
            }
            case "group":
                emitGroup(shape, worldX, worldY, scale, offsetX, offsetY, layer);
                return;
        }
    }

    function emitGroup(
        group: GroupShape,
        worldX: number,
        worldY: number,
        scale: number,
        offsetX: number,
        offsetY: number,
        layerOverride: LayerId | undefined,
    ) {
        const childLayer = group.layer ?? layerOverride;

        if (group.noScale) {
            // Anchor the group at its scaled world position, then render
            // children in pixel space (scale = 1, offset = 0).
            const px = (worldX + group.x) * scale + offsetX;
            const py = (worldY + group.y) * scale + offsetY;

            const pushLayer = childLayer ?? DEFAULT_LAYER;
            const bucket = commandsFor(pushLayer);
            bucket.push({type: "pushTransform", matrix: [1, 0, 0, 1, px, py]});
            for (const child of group.children) {
                emitShape(child, 0, 0, 1, 0, 0, childLayer);
            }
            // popTransform must land in the same bucket as its push so
            // renderers can replay them in order. Children whose `layer`
            // diverts them elsewhere are pulled out of this push/pop scope
            // — that's the intended behaviour, since cross-layer children
            // are independent draws (e.g. a noScale label group has a
            // pixmap on the link layer plus a rect on the top layer).
            bucket.push({type: "popTransform"});
            return;
        }

        const nextX = worldX + group.x;
        const nextY = worldY + group.y;
        for (const child of group.children) {
            emitShape(child, nextX, nextY, scale, offsetX, offsetY, childLayer);
        }
    }

    for (const shape of shapes) {
        emitShape(shape, 0, 0, camera.scale, camera.offsetX, camera.offsetY, undefined);
    }

    const out: DrawCommandBatch[] = [];
    for (const [layer, commands] of batches) {
        out.push({layer, commands});
    }
    return out;
}

function scalePoints(
    pts: number[],
    worldX: number,
    worldY: number,
    scale: number,
    offsetX: number,
    offsetY: number,
): number[] {
    const out = new Array<number>(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
        out[i] = (worldX + pts[i]) * scale + offsetX;
        out[i + 1] = (worldY + pts[i + 1]) * scale + offsetY;
    }
    return out;
}

/** Scale dash lengths from world units to render units. `dashEnabled === false` blanks the dash. */
function scaleDash(
    dash: number[] | undefined,
    scale: number,
    dashEnabled: boolean | undefined,
): number[] | undefined {
    if (dashEnabled === false) return undefined;
    if (!dash || dash.length === 0) return dash;
    const out = new Array<number>(dash.length);
    for (let i = 0; i < dash.length; i++) out[i] = dash[i] * scale;
    return out;
}

/**
 * Apply the camera's scale + offset to a 2D affine matrix originally
 * authored in world space. Result composes camera ∘ shape on world points.
 */
function scaleTransform(
    matrix: [number, number, number, number, number, number] | undefined,
    worldX: number,
    worldY: number,
    scale: number,
    offsetX: number,
    offsetY: number,
): [number, number, number, number, number, number] | undefined {
    if (!matrix) return undefined;
    const [a, b, c, d, e, f] = matrix;
    // Camera:  [scale, 0, 0, scale, worldX*scale + offsetX, worldY*scale + offsetY]
    // Composed = Camera * Shape (column-major affine).
    return [
        a * scale,
        b * scale,
        c * scale,
        d * scale,
        e * scale + worldX * scale + offsetX,
        f * scale + worldY * scale + offsetY,
    ];
}
