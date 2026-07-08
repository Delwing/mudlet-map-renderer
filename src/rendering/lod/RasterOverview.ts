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
    /**
     * `settings.roomSize` at the time of painting — how large a room's own
     * footprint is relative to the ~1-map-unit spacing between room centres.
     * Only ever GROWS the box beyond the gap-free minimum (when > 1, rooms
     * overlap their neighbours in vector mode too); values ≤ 1 leave the box
     * at the gap-free minimum, since shrinking to match a smaller footprint
     * would reintroduce visible gaps/erosion in the overview raster is meant
     * to avoid. Omit (or 1) for the previous gap-free-only behaviour.
     */
    roomSize?: number;
}

/**
 * Room box side in pixels for a given camera scale. Must always cover the
 * inter-room spacing (= `scale` px, fractional): `round(scale)` under-covers
 * at some zooms and the sub-pixel gaps read as a flickering grid, so
 * `ceil(scale)+1` guarantees overlap → consistently solid regions. This is
 * the FLOOR — `roomSize` above 1 (rooms configured larger than the spacing
 * between them) grows the box further so the raster overview's density
 * roughly matches how much vector mode's rooms overlap their neighbours;
 * `roomSize` at or below 1 never shrinks the box below that floor.
 */
export function rasterBoxSize(scale: number, roomSize = 1): number {
    const gapFree = Math.ceil(scale) + 1;
    const sized = Math.ceil(scale * roomSize) + 1;
    return Math.max(1, Math.min(48, Math.max(gapFree, sized)));
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
    const s = rasterBoxSize(p.scale, p.roomSize);
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
