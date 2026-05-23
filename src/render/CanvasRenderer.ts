/**
 * CanvasRenderer — replays {@link DrawCommandBatch}es onto a Canvas2D
 * context.
 *
 * Coordinates in commands are already in render space (camera transform
 * applied), so the renderer issues calls directly without applying any extra
 * scale or translation. Stack commands push/pop matching `ctx.save()` /
 * `ctx.restore()` pairs and apply the transform/clip on the way in.
 *
 * Used by {@link CanvasExporter} (and {@link PngBytesExporter}) so headless
 * exports rasterize through the shared {@link buildDrawCommands} pipeline
 * instead of grabbing the live Konva stage.
 */

import type {
    DrawCommand,
    DrawCommandBatch,
    PrimitiveDrawCommand,
} from "../draw/DrawCommand";
import {resolveFill} from "./canvasGradient";

/**
 * Image loader hook. Canvas2D's `drawImage` needs an `HTMLImageElement` (or
 * compatible). Browsers create one via `new Image()`; Node-canvas provides
 * its own `Image` constructor. The default tries both — callers can override
 * for tests or unusual targets.
 */
export type ImageFactory = (src: string) => unknown;

const defaultImageFactory: ImageFactory = (src) => {
    if (typeof Image !== "undefined") {
        const img = new Image();
        img.src = src;
        return img;
    }
    return null;
};

export interface CanvasRenderOptions {
    imageFactory?: ImageFactory;
}

/**
 * Replay every batch onto `ctx`, in order. Each batch's commands are flushed
 * sequentially; transform / clip stacks are independent per batch so a stray
 * push in one layer cannot leak into the next.
 */
export function renderToCanvas(
    ctx: CanvasRenderingContext2D,
    batches: DrawCommandBatch[],
    options: CanvasRenderOptions = {},
): void {
    const imageFactory = options.imageFactory ?? defaultImageFactory;
    for (const batch of batches) {
        replayCommands(ctx, batch.commands, imageFactory);
    }
}

function replayCommands(
    ctx: CanvasRenderingContext2D,
    commands: DrawCommand[],
    imageFactory: ImageFactory,
): void {
    let stackDepth = 0;

    for (const cmd of commands) {
        switch (cmd.type) {
            case "pushTransform": {
                ctx.save();
                stackDepth++;
                ctx.transform(...cmd.matrix);
                break;
            }
            case "pushClip": {
                ctx.save();
                stackDepth++;
                ctx.beginPath();
                ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
                ctx.clip();
                break;
            }
            case "popTransform":
            case "popClip": {
                if (stackDepth > 0) {
                    ctx.restore();
                    stackDepth--;
                }
                break;
            }
            default:
                replayPrimitive(ctx, cmd, imageFactory);
                break;
        }
    }

    while (stackDepth > 0) {
        ctx.restore();
        stackDepth--;
    }
}

function replayPrimitive(
    ctx: CanvasRenderingContext2D,
    cmd: PrimitiveDrawCommand,
    imageFactory: ImageFactory,
): void {
    switch (cmd.type) {
        case "rect": {
            ctx.beginPath();
            if (cmd.cr > 0 && typeof ctx.roundRect === "function") {
                ctx.roundRect(cmd.x, cmd.y, cmd.w, cmd.h, cmd.cr);
            } else {
                ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
            }
            if (cmd.fill) {
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                ctx.setLineDash(cmd.dash ?? []);
                ctx.stroke();
            }
            break;
        }
        case "circle": {
            ctx.beginPath();
            ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
            if (cmd.fill) {
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                ctx.setLineDash(cmd.dash ?? []);
                ctx.stroke();
            }
            break;
        }
        case "line": {
            if (cmd.points.length < 4) break;
            const savedAlpha = ctx.globalAlpha;
            if (cmd.alpha !== undefined) ctx.globalAlpha = cmd.alpha;
            ctx.beginPath();
            ctx.moveTo(cmd.points[0], cmd.points[1]);
            for (let i = 2; i < cmd.points.length; i += 2) {
                ctx.lineTo(cmd.points[i], cmd.points[i + 1]);
            }
            if (cmd.stroke) ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = cmd.sw;
            ctx.setLineDash(cmd.dash ?? []);
            if (cmd.lineCap) ctx.lineCap = cmd.lineCap;
            if (cmd.lineJoin) ctx.lineJoin = cmd.lineJoin;
            ctx.stroke();
            if (cmd.alpha !== undefined) ctx.globalAlpha = savedAlpha;
            break;
        }
        case "polygon": {
            if (cmd.vertices.length < 4) break;
            ctx.beginPath();
            ctx.moveTo(cmd.vertices[0], cmd.vertices[1]);
            for (let i = 2; i < cmd.vertices.length; i += 2) {
                ctx.lineTo(cmd.vertices[i], cmd.vertices[i + 1]);
            }
            ctx.closePath();
            if (cmd.fill) {
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                ctx.setLineDash([]);
                ctx.stroke();
            }
            break;
        }
        case "text": {
            // Sub-pixel font sizes break Canvas2D text metrics on some
            // engines (notably node-canvas). Render at TEXT_SCALE × the
            // requested size and counter-scale the matrix so output stays
            // pixel-correct.
            const TEXT_SCALE = 100;
            const scaledSize = cmd.fontSize * TEXT_SCALE;
            const font = `${cmd.fontStyle} ${scaledSize}px ${cmd.fontFamily}`;
            ctx.save();
            ctx.font = font;
            ctx.fillStyle = cmd.fill;
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw * TEXT_SCALE;
                ctx.lineJoin = "round";
            }
            const hasBaselineRatio = cmd.baselineRatio !== undefined;
            if (cmd.transform) {
                ctx.transform(...cmd.transform);
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                ctx.textAlign = "center";
                if (hasBaselineRatio) {
                    ctx.textBaseline = "alphabetic";
                    const by = (cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize) * TEXT_SCALE;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, cmd.w * TEXT_SCALE / 2, by);
                    ctx.fillText(cmd.text, cmd.w * TEXT_SCALE / 2, by);
                } else {
                    ctx.textBaseline = "middle";
                    const mx = cmd.w * TEXT_SCALE / 2;
                    const my = cmd.h * TEXT_SCALE / 2;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, mx, my);
                    ctx.fillText(cmd.text, mx, my);
                }
            } else if (cmd.w > 0 && cmd.h > 0) {
                ctx.textAlign = (cmd.align || "left");
                const tx = cmd.align === "center"
                    ? cmd.x + cmd.w / 2
                    : cmd.align === "right"
                        ? cmd.x + cmd.w
                        : cmd.x;
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                if (cmd.vAlign === "middle" && hasBaselineRatio) {
                    ctx.textBaseline = "alphabetic";
                    const ty = cmd.y + cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                } else {
                    ctx.textBaseline = cmd.vAlign === "middle" ? "middle" : "top";
                    const ty = cmd.vAlign === "middle" ? cmd.y + cmd.h / 2 : cmd.y;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                }
            } else {
                ctx.textAlign = "left";
                ctx.textBaseline = "top";
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, cmd.x * TEXT_SCALE, cmd.y * TEXT_SCALE);
                ctx.fillText(cmd.text, cmd.x * TEXT_SCALE, cmd.y * TEXT_SCALE);
            }
            ctx.restore();
            break;
        }
        case "image": {
            const image = imageFactory(cmd.src) as CanvasImageSource | null;
            if (!image) break;
            if (cmd.transform) {
                ctx.save();
                ctx.transform(...cmd.transform);
                ctx.drawImage(image, 0, 0, cmd.w, cmd.h);
                ctx.restore();
            } else {
                ctx.drawImage(image, cmd.x, cmd.y, cmd.w, cmd.h);
            }
            break;
        }
    }
}
