/**
 * Shared Canvas2D fill resolver — turns a {@link FillStyle} (string or
 * gradient) into something assignable to `ctx.fillStyle`.
 *
 * Used by both {@link RecordingLayerNode} (interactive Konva replay) and
 * {@link renderToCanvas} (PNG export) so gradient semantics stay identical
 * across pipelines.
 */

import type {FillStyle} from "../scene/Shape";

export function resolveFill(
    ctx: CanvasRenderingContext2D,
    fill: FillStyle,
): string | CanvasGradient {
    if (typeof fill === "string") return fill;
    if (fill.type === "linear") {
        const g = ctx.createLinearGradient(fill.x0, fill.y0, fill.x1, fill.y1);
        for (const s of fill.stops) g.addColorStop(s.offset, s.color);
        return g;
    }
    const fx = fill.fx ?? fill.cx;
    const fy = fill.fy ?? fill.cy;
    const fr = fill.fr ?? 0;
    const g = ctx.createRadialGradient(fx, fy, fr, fill.cx, fill.cy, fill.r);
    for (const s of fill.stops) g.addColorStop(s.offset, s.color);
    return g;
}
