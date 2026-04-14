import { test, expect, Page } from '@playwright/test';

async function loadHarness(page: Page, params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = qs ? `/?${qs}` : '/';
    await page.goto(url);
    // Wait for the harness to signal rendering is done
    await page.waitForFunction(() => (window as any).__HARNESS_READY__ === true, null, { timeout: 10000 });
    // Extra frame for Konva to flush batch draws
    await page.waitForTimeout(300);
}

test.describe('default rendering', () => {
    test('area 1 z=0', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('default-area1-z0.png');
    });

    test('area 2 z=0', async ({ page }) => {
        await loadHarness(page, { area: '2', z: '0', room: '20' });
        await expect(page.locator('#stage')).toHaveScreenshot('default-area2-z0.png');
    });

    test('area 1 z=-1 underground', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '-1', room: '9' });
        await expect(page.locator('#stage')).toHaveScreenshot('default-area1-z-1.png');
    });
});

test.describe('room shapes', () => {
    test('circle', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', roomShape: 'circle' });
        await expect(page.locator('#stage')).toHaveScreenshot('circle-rooms.png');
    });

    test('rounded rectangle', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', roomShape: 'roundedRectangle' });
        await expect(page.locator('#stage')).toHaveScreenshot('rounded-rect-rooms.png');
    });
});

test.describe('rendering modes', () => {
    test('frame mode', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', frameMode: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('frame-mode.png');
    });

    test('colored mode', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', coloredMode: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('colored-mode.png');
    });

    test('emboss mode', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', emboss: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('emboss-mode.png');
    });

    test('frame + circle', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', frameMode: '1', roomShape: 'circle' });
        await expect(page.locator('#stage')).toHaveScreenshot('frame-circle.png');
    });

    test('colored + emboss', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', coloredMode: '1', emboss: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('colored-emboss.png');
    });
});

test.describe('visual options', () => {
    test('grid enabled', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', grid: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('grid-enabled.png');
    });

    test('no borders', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', borders: '0' });
        await expect(page.locator('#stage')).toHaveScreenshot('no-borders.png');
    });

    test('area name shown', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', areaName: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('area-name.png');
    });
});

test.describe('overlays', () => {
    test('position marker', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', position: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('position-marker.png');
    });

    test('highlights', async ({ page }) => {
        await loadHarness(page, {
            area: '1', z: '0', room: '1',
            highlights: '1:#ff0000,3:#00ff00,6:#0000ff',
        });
        await expect(page.locator('#stage')).toHaveScreenshot('highlights.png');
    });

    test('path overlay', async ({ page }) => {
        await loadHarness(page, {
            area: '1', z: '0', room: '1',
            path: '6,2,1,3',
            pathColor: '#66E64D',
        });
        await expect(page.locator('#stage')).toHaveScreenshot('path-overlay.png');
    });

    test('combined overlays', async ({ page }) => {
        await loadHarness(page, {
            area: '1', z: '0', room: '1',
            position: '1',
            highlights: '3:#ff0000,6:#0000ff',
            path: '6,2,1,3',
            pathColor: '#66E64D',
        });
        await expect(page.locator('#stage')).toHaveScreenshot('combined-overlays.png');
    });
});

test.describe('viewport', () => {
    test('fit area', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', fitArea: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('fit-area.png');
    });

    test('zoom in', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', zoom: '2' });
        await expect(page.locator('#stage')).toHaveScreenshot('zoom-in.png');
    });

    test('zoom out', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', zoom: '0.4' });
        await expect(page.locator('#stage')).toHaveScreenshot('zoom-out.png');
    });

    test('center on different room', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', room: '1', centerOn: '7' });
        await expect(page.locator('#stage')).toHaveScreenshot('center-on-room7.png');
    });

    test('fit area with area name', async ({ page }) => {
        await loadHarness(page, { area: '1', z: '0', fitArea: '1', areaName: '1' });
        await expect(page.locator('#stage')).toHaveScreenshot('fit-area-with-name.png');
    });
});
