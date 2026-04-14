/**
 * Pixel-accurate vertical centering helper.
 *
 * The canvas TextMetrics API (actualBoundingBoxAscent / Descent) is unreliable
 * across browsers and fonts.  Instead we draw the glyph on an offscreen canvas
 * with a known baseline position, scan the actual rendered pixels to find the
 * true visual top and bottom, and derive the offset we need.
 *
 * We use textBaseline='alphabetic' so that the result is consistent with the
 * original rendering code (which used alphabetic + a hard-coded 0.35em offset).
 * For a typical uppercase letter the function returns ~0.35 (same as the old
 * magic number), but for glyphs that extend below the baseline (e.g. "[]") it
 * returns a smaller value, shifting them up to their true visual centre.
 *
 * Return value: multiply by fontSize and add to room.y; use with
 *   ctx.textBaseline = 'alphabetic'
 *   ctx.fillText(text, room.x, room.y + result * fontSize)
 */

const MEASURE_PX = 72;       // large enough for sub-pixel accuracy
const CANVAS_PX  = 200;
const BASELINE_Y = 120;      // baseline well below mid so ascenders always fit

import Konva from "konva";

const cache = new Map<string, number>();

let _canvas: any = null;

function getCanvas(): any {
    if (!_canvas) {
        _canvas = Konva.Util.createCanvasElement();
        _canvas.width  = CANVAS_PX;
        _canvas.height = CANVAS_PX;
    }
    return _canvas;
}

/**
 * Returns the Y offset from room-centre to alphabetic baseline, as a ratio of
 * fontSize, so that the glyph appears visually centred.
 *
 * For a standard uppercase letter (no descenders) this is close to
 * capHeight/2 ≈ 0.35.  For characters that extend below the baseline the
 * returned value is smaller, which moves the rendered text upward.
 */
export function measureTextBaselineOffset(text: string, fontFamily: string): number {
    const cacheKey = `${text}::${fontFamily}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const canvas = getCanvas();
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    ctx.font          = `bold ${MEASURE_PX}px ${fontFamily}`;
    ctx.textBaseline  = 'alphabetic';
    ctx.textAlign     = 'center';
    ctx.fillStyle     = '#ffffff';
    ctx.fillText(text, CANVAS_PX / 2, BASELINE_Y);

    const { data } = ctx.getImageData(0, 0, CANVAS_PX, CANVAS_PX);

    let top    = CANVAS_PX;
    let bottom = -1;
    for (let y = 0; y < CANVAS_PX; y++) {
        for (let x = 0; x < CANVAS_PX; x++) {
            if (data[(y * CANVAS_PX + x) * 4 + 3] > 16) {
                if (y < top)    top    = y;
                if (y > bottom) bottom = y;
            }
        }
    }

    if (bottom === -1) {
        // Nothing rendered — fall back to the original magic number
        cache.set(cacheKey, 0.35);
        return 0.35;
    }

    // ascent  = pixels above the baseline (always positive)
    // descent = pixels below the baseline (0 for caps, positive for descenders)
    const ascent  = BASELINE_Y - top;
    const descent = Math.max(0, bottom - BASELINE_Y);

    // Offset from room-centre to baseline so that the glyph is visually centred:
    //   visual_centre = baseline - ascent + (ascent + descent) / 2
    //                 = baseline - (ascent - descent) / 2
    //   we want visual_centre == room.y
    //   → baseline = room.y + (ascent - descent) / 2
    const ratio = (ascent - descent) / 2 / MEASURE_PX;
    cache.set(cacheKey, ratio);
    return ratio;
}
