import {describe, expect, it} from 'vitest';
import {cssToPackedRGBA, paintRasterOverview, rasterBoxSize} from '../src/rendering/lod/RasterOverview';

/** Environment-independent stand-in — the painter only touches width/height/data. */
function makeImage(width: number, height: number): ImageData {
    return {width, height, data: new Uint8ClampedArray(width * height * 4)} as ImageData;
}

function pixel(img: ImageData, x: number, y: number): number {
    return new Uint32Array(img.data.buffer)[y * img.width + x];
}

const RED = cssToPackedRGBA('#ff0000');
const GREEN = cssToPackedRGBA('rgb(0,255,0)');

describe('cssToPackedRGBA', () => {
    it('parses #rgb, #rrggbb and rgb() with full alpha', () => {
        expect(cssToPackedRGBA('#f00')).toBe(0xff0000ff);
        expect(cssToPackedRGBA('#ff0000')).toBe(0xff0000ff);
        expect(cssToPackedRGBA('rgb(255, 0, 0)')).toBe(0xff0000ff);
        expect(cssToPackedRGBA('rgb(0,0,255)')).toBe(0xffff0000);
        expect(cssToPackedRGBA('#000000')).toBe(0xff000000);
    });
});

describe('rasterBoxSize', () => {
    it('always covers the inter-room spacing and clamps to 1..48', () => {
        expect(rasterBoxSize(0.01)).toBe(2);   // ceil(0.01)+1
        expect(rasterBoxSize(1)).toBe(2);
        expect(rasterBoxSize(2.4)).toBe(4);    // ceil+1 > scale, gap-free
        expect(rasterBoxSize(1000)).toBe(48);  // clamp
        for (let s = 0.1; s < 47; s += 0.7) {
            expect(rasterBoxSize(s)).toBeGreaterThan(s); // overlap guarantee
        }
    });

    it('roomSize <= 1 never shrinks below the gap-free floor', () => {
        for (const scale of [0.5, 1, 5, 10, 20]) {
            const floor = rasterBoxSize(scale); // roomSize omitted == 1
            for (const roomSize of [0.2, 0.6, 1]) {
                expect(rasterBoxSize(scale, roomSize)).toBe(floor);
            }
        }
    });

    it('roomSize > 1 grows the box beyond the gap-free floor', () => {
        const scale = 10;
        const floor = rasterBoxSize(scale);
        expect(rasterBoxSize(scale, 1.5)).toBeGreaterThan(floor);
        expect(rasterBoxSize(scale, 2)).toBeGreaterThan(rasterBoxSize(scale, 1.5));
        // Still clamped at 48 for extreme combinations.
        expect(rasterBoxSize(30, 3)).toBe(48);
    });
});

describe('paintRasterOverview', () => {
    it('paints a room box at its screen position with its env color', () => {
        const img = makeImage(40, 40);
        // Room at map (2, 3), scale 4, offset (0, 0) → screen (8, 12); box 5px.
        paintRasterOverview(img, fn => fn(2, 3, 7), {
            scale: 4, offsetX: 0, offsetY: 0,
            colorOf: env => (env === 7 ? RED : 0),
        });
        expect(pixel(img, 8, 12)).toBe(RED);
        // Box extends half=2 either side.
        expect(pixel(img, 6, 10)).toBe(RED);
        expect(pixel(img, 10, 14)).toBe(RED);
        // Outside the box: untouched.
        expect(pixel(img, 3, 12)).toBe(0);
        expect(pixel(img, 8, 17)).toBe(0);
    });

    it('leaves non-room pixels at alpha 0 (no background fill)', () => {
        const img = makeImage(10, 10);
        paintRasterOverview(img, fn => fn(1, 1, 1), {
            scale: 1, offsetX: 0, offsetY: 0, colorOf: () => GREEN,
        });
        let painted = 0, cleared = 0;
        const px = new Uint32Array(img.data.buffer);
        for (const v of px) (v === 0 ? cleared++ : painted++);
        expect(painted).toBeGreaterThan(0);
        expect(cleared).toBe(100 - painted);
    });

    it('clips boxes at the image edges without wrapping', () => {
        const img = makeImage(10, 10);
        // Room at screen (0,0) — box spills left/top and must not wrap rows.
        paintRasterOverview(img, fn => fn(0, 0, 1), {
            scale: 6, offsetX: 0, offsetY: 0, colorOf: () => RED,
        });
        expect(pixel(img, 0, 0)).toBe(RED);
        // Nothing on the far right of any row (would indicate wrapping).
        for (let y = 0; y < 10; y++) expect(pixel(img, 9, y)).toBe(0);

        // Fully off-canvas room paints nothing.
        const img2 = makeImage(10, 10);
        paintRasterOverview(img2, fn => fn(100, 100, 1), {
            scale: 1, offsetX: 0, offsetY: 0, colorOf: () => RED,
        });
        expect(new Uint32Array(img2.data.buffer).every(v => v === 0)).toBe(true);
    });

    it('applies offsets (screen = map*scale + offset)', () => {
        const img = makeImage(20, 20);
        paintRasterOverview(img, fn => fn(0, 0, 1), {
            scale: 2, offsetX: 10, offsetY: 5, colorOf: () => GREEN,
        });
        expect(pixel(img, 10, 5)).toBe(GREEN);
        expect(pixel(img, 0, 0)).toBe(0);
    });

    it('roomSize > 1 widens the painted box; roomSize <= 1 matches the default', () => {
        const paintWith = (roomSize?: number) => {
            const img = makeImage(30, 30);
            paintRasterOverview(img, fn => fn(0, 0, 1), {
                scale: 6, offsetX: 15, offsetY: 15, colorOf: () => RED, roomSize,
            });
            return img;
        };
        const countPainted = (img: ImageData) =>
            Array.from(new Uint32Array(img.data.buffer)).filter(v => v !== 0).length;

        const base = countPainted(paintWith(undefined));
        expect(countPainted(paintWith(1))).toBe(base); // roomSize 1 == omitted
        expect(countPainted(paintWith(0.5))).toBe(base); // <=1 never shrinks below the floor
        expect(countPainted(paintWith(2))).toBeGreaterThan(base); // >1 grows it
    });

    it('later rooms overwrite earlier ones (last write wins)', () => {
        const img = makeImage(10, 10);
        paintRasterOverview(img, fn => {
            fn(2, 2, 1);
            fn(2, 2, 2);
        }, {scale: 1, offsetX: 0, offsetY: 0, colorOf: env => (env === 1 ? RED : GREEN)});
        expect(pixel(img, 2, 2)).toBe(GREEN);
    });
});
