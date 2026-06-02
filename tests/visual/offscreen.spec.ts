import { test, expect, Page } from '@playwright/test';

async function loadHarness(page: Page, params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    await page.goto(qs ? `/?${qs}` : '/');
    await page.waitForFunction(() => (window as any).__HARNESS_READY__ === true, null, { timeout: 10000 });
    // Worker renders asynchronously after the init/scene/camera messages; give
    // it a couple of animation frames to paint the first frame.
    await page.waitForTimeout(500);
}

/**
 * Real-browser smoke + parity check for the OffscreenCanvas worker backend.
 *
 * The transferred canvas can't be read from the main thread, so we compare the
 * compositor screenshots of the Konva and worker renders for the same scene.
 * They won't be byte-identical (different rasterisers), but both must produce
 * substantial, similarly-sized output — a blank/failed worker render would be a
 * tiny near-uniform PNG.
 */
test.describe('OffscreenCanvas backend', () => {
    test('worker renders the map (parity with Konva)', async ({ page }) => {
        const params = { area: '1', z: '0', room: '1' };

        await loadHarness(page, params);
        const konva = await page.locator('#stage').screenshot();

        await loadHarness(page, { ...params, backend: 'offscreen' });
        const worker = await page.locator('#stage').screenshot();

        // Both renders must produce real content (not a blank background).
        expect(konva.length).toBeGreaterThan(2000);
        expect(worker.length).toBeGreaterThan(2000);

        // Same scene → comparable output size across the two rasterisers.
        const ratio = worker.length / konva.length;
        expect(ratio).toBeGreaterThan(0.5);
        expect(ratio).toBeLessThan(2.0);
    });
});
