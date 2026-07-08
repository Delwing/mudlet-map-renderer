import {describe, expect, it} from 'vitest';
import {shouldUseRaster} from '../src/rendering/lod/lodDecision';

const base = {stageWidth: 800, stageHeight: 600, roomBudget: 16000};

describe('shouldUseRaster', () => {
    it('never rasters a plane that fits the budget, at any zoom', () => {
        for (const scale of [0.001, 0.1, 1, 10, 100]) {
            expect(shouldUseRaster({...base, planeRoomCount: 16000, scale})).toBe(false);
            expect(shouldUseRaster({...base, planeRoomCount: 500, scale})).toBe(false);
        }
    });

    it('rasters a huge plane when zoomed out and not when zoomed in', () => {
        const huge = {...base, planeRoomCount: 1_000_000};
        // Threshold scale: sqrt(W*H/budget) = sqrt(480000/16000) ≈ 5.48
        expect(shouldUseRaster({...huge, scale: 0.5})).toBe(true);
        expect(shouldUseRaster({...huge, scale: 5})).toBe(true);
        expect(shouldUseRaster({...huge, scale: 6})).toBe(false);
        expect(shouldUseRaster({...huge, scale: 50})).toBe(false);
    });

    it('is monotonic in scale (single flip, no oscillation across zoom)', () => {
        const huge = {...base, planeRoomCount: 1_000_000};
        let seenVector = false;
        for (let scale = 0.1; scale < 20; scale += 0.1) {
            const raster = shouldUseRaster({...huge, scale});
            if (!raster) seenVector = true;
            // Once vector, increasing scale must never flip back to raster.
            if (seenVector) expect(raster).toBe(false);
        }
    });

    it('is pan-invariant: depends only on scale/stage/budget, not any viewport position', () => {
        // The input carries no position — this documents the contract: panning
        // cannot change the decision because none of its inputs change.
        const input = {...base, planeRoomCount: 100000, scale: 2};
        expect(shouldUseRaster(input)).toBe(shouldUseRaster({...input}));
    });

    it('scales the flip point with the stage area and budget', () => {
        const plane = {planeRoomCount: 1_000_000, scale: 5.6};
        expect(shouldUseRaster({...plane, stageWidth: 800, stageHeight: 600, roomBudget: 16000})).toBe(false);
        // 4× the pixels → same zoom now holds 4× the rooms → raster again.
        expect(shouldUseRaster({...plane, stageWidth: 1600, stageHeight: 1200, roomBudget: 16000})).toBe(true);
        // …compensated by 4× the budget.
        expect(shouldUseRaster({...plane, stageWidth: 1600, stageHeight: 1200, roomBudget: 64000})).toBe(false);
    });
});
