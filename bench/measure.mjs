// Headless A/B measurement of the two backends. Assumes the bench dev server
// is running on http://localhost:5175. Run: node bench/measure.mjs [size]
import {chromium} from 'playwright';

const SIZE = process.argv[2] ?? '70';
const WARMUP_MS = 2500;
const SAMPLE_MS = 3500;

async function measure(page, backend) {
    await page.goto(`http://localhost:5175/?backend=${backend}&size=${SIZE}`);
    await page.waitForFunction(() => typeof window.__benchMetrics === 'function', null, {timeout: 15000});
    await page.waitForTimeout(WARMUP_MS); // let it settle + fill the stall window
    // Reset the window by sampling fresh over SAMPLE_MS.
    await page.waitForTimeout(SAMPLE_MS);
    return await page.evaluate(() => window.__benchMetrics());
}

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 800}});

const konva = await measure(page, 'konva');
const offscreen = await measure(page, 'offscreen');

await browser.close();

const fmt = (n) => n.toFixed(1).padStart(7);
console.log(`\nGrid: ${konva.roomCount.toLocaleString()} rooms (size ${SIZE}×${SIZE}), continuous pan\n`);
console.log(`                     Konva    Offscreen`);
console.log(`render FPS         ${String(konva.fps).padStart(7)}    ${String(offscreen.fps).padStart(7)}`);
console.log(`max stall (ms)     ${fmt(konva.maxStall)}    ${fmt(offscreen.maxStall)}`);
console.log(`p95 stall (ms)     ${fmt(konva.p95Stall)}    ${fmt(offscreen.p95Stall)}`);
console.log(`avg stall (ms)     ${fmt(konva.avgStall)}    ${fmt(offscreen.avgStall)}`);
const improvement = konva.p95Stall > 0 ? (konva.p95Stall / Math.max(0.01, offscreen.p95Stall)) : 0;
console.log(`\nMain-thread p95 stall improvement: ${improvement.toFixed(1)}× lower with the worker\n`);
