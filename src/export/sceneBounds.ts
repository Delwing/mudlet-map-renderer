import type {Style} from "../style/Style";

export interface ExportBounds {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/**
 * Convert world-space export bounds into the scene-space AABB an exporter
 * (SVG, canvas) should target.
 *
 * Coordinate-warping styles (e.g. Isometric) project world coords into a
 * different render space, so the SVG viewBox / canvas fit must be sized to
 * the projected region — otherwise the rendered scene drifts outside the
 * background rect and is partially clipped.
 *
 * For non-warping styles (identity, parchment, sketchy, …) `worldToScene`
 * is undefined and the bounds pass through unchanged.
 *
 * `scenePad` adds a uniform buffer in scene space — used to absorb
 * decorations the projection itself doesn't account for (cube depth in
 * Isometric, neon glow, …).
 */
export function projectExportBoundsToScene(
    bounds: ExportBounds,
    style: Style,
    scenePad = 0,
): ExportBounds {
    if (!style.worldToScene) return bounds;
    const corners = [
        style.worldToScene(bounds.x, bounds.y),
        style.worldToScene(bounds.x + bounds.w, bounds.y),
        style.worldToScene(bounds.x, bounds.y + bounds.h),
        style.worldToScene(bounds.x + bounds.w, bounds.y + bounds.h),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return {
        x: minX - scenePad,
        y: minY - scenePad,
        w: maxX - minX + scenePad * 2,
        h: maxY - minY + scenePad * 2,
    };
}
