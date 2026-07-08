/**
 * Pure pixel painter for the raster LOD overview: each room becomes a small
 * filled box in an `ImageData`, written directly as packed 32-bit pixels.
 * Fast enough to repaint a million-room viewport in a few milliseconds —
 * which is exactly the regime where Konva nodes are not an option.
 */

export interface RasterPaintParams {
    /** Camera scale — screen = map * scale + offset. */
    scale: number;
    offsetX: number;
    offsetY: number;
    /** Packed little-endian RGBA (see {@link cssToPackedRGBA}) for an env id. */
    colorOf: (envId: number) => number;
}

/**
 * Room box side in pixels for a given camera scale. Must always cover the
 * inter-room spacing (= `scale` px, fractional): `round(scale)` under-covers
 * at some zooms and the sub-pixel gaps read as a flickering grid, so
 * `ceil(scale)+1` guarantees overlap → consistently solid regions.
 */
export function rasterBoxSize(scale: number): number {
    return Math.max(1, Math.min(48, Math.ceil(scale) + 1));
}

/**
 * Paint every room `visit` yields into `img`. Pixels not covered by a room
 * are left untouched (alpha 0 on a fresh ImageData), so the layer composites
 * over the stage background — no background fill here.
 *
 * `visit` is typically `ViewportDataSource.forEachInBounds` curried with the
 * painted region's map-space bounds.
 */
export function paintRasterOverview(
    img: ImageData,
    visit: (fn: (x: number, y: number, envId: number) => void) => void,
    p: RasterPaintParams,
): void {
    const W = img.width, H = img.height;
    const data = new Uint32Array(img.data.buffer);
    const s = rasterBoxSize(p.scale);
    const half = s >> 1;
    visit((x, y, envId) => {
        const sx = Math.round(x * p.scale + p.offsetX) - half;
        const sy = Math.round(y * p.scale + p.offsetY) - half;
        const packed = p.colorOf(envId);
        for (let dy = 0; dy < s; dy++) {
            const py = sy + dy;
            if (py < 0 || py >= H) continue;
            const row = py * W;
            for (let dx = 0; dx < s; dx++) {
                const px = sx + dx;
                if (px >= 0 && px < W) data[row + px] = packed;
            }
        }
    });
}

/** `#rgb` / `#rrggbb` / `rgb(a)(r,g,b[,a])` → packed little-endian RGBA uint32 (alpha 255). */
export function cssToPackedRGBA(css: string): number {
    const c = css.trim();
    let r = 0, g = 0, b = 0;
    if (c[0] === "#") {
        if (c.length === 4) {
            r = parseInt(c[1] + c[1], 16);
            g = parseInt(c[2] + c[2], 16);
            b = parseInt(c[3] + c[3], 16);
        } else {
            r = parseInt(c.slice(1, 3), 16);
            g = parseInt(c.slice(3, 5), 16);
            b = parseInt(c.slice(5, 7), 16);
        }
    } else {
        const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (m) {
            r = +m[1];
            g = +m[2];
            b = +m[3];
        }
    }
    return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
