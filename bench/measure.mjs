// Headless A/B measurement. Assumes the bench dev server is running on
// http://localhost:5175.
//   node bench/measure.mjs [size]            → Konva vs Offscreen backend
//   node bench/measure.mjs [size] coalesce   → coalesce OFF vs ON (Konva)
import {chromium} from 'playwright';

const SIZE = process.argv[2] ?? '70';
const MODE = process.argv[3] === 'coalesce' ? 'coalesce' : 'backend';
const PORT = process.env.BENCH_PORT ?? '5175';
const WARMUP_MS = 2500;
const SAMPLE_MS = 3500;

async function measure(page, query) {
    await page.goto(`http://localhost:${PORT}/?${query}`);
    await page.waitForFunction(() => typeof window.__benchMetrics === 'function', null, {timeout: 15000});
    await page.waitForTimeout(WARMUP_MS); // let it settle + fill the stall window
    // Reset the window by sampling fresh over SAMPLE_MS.
    await page.waitForTimeout(SAMPLE_MS);
    return await page.evaluate(() => window.__benchMetrics());
}

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 800}});

const fmt = (n) => n.toFixed(1).padStart(7);

if (MODE === 'coalesce') {
    const off = await measure(page, `backend=konva&size=${SIZE}&coalesce=0`);
    const on = await measure(page, `backend=konva&size=${SIZE}&coalesce=1`);
    await browser.close();

    console.log(`\nGrid: ${off.roomCount.toLocaleString()} rooms (size ${SIZE}×${SIZE}), continuous pan, Konva\n`);
    console.log(`                   coalesce OFF   coalesce ON`);
    console.log(`render FPS         ${String(off.fps).padStart(7)}        ${String(on.fps).padStart(7)}`);
    console.log(`max stall (ms)     ${fmt(off.maxStall)}        ${fmt(on.maxStall)}`);
    console.log(`p95 stall (ms)     ${fmt(off.p95Stall)}        ${fmt(on.p95Stall)}`);
    console.log(`avg stall (ms)     ${fmt(off.avgStall)}        ${fmt(on.avgStall)}`);
    const speedup = on.p95Stall > 0 ? off.p95Stall / Math.max(0.01, on.p95Stall) : 0;
    console.log(`\nMain-thread p95 stall: ${speedup.toFixed(2)}× lower with coalescing\n`);
} else {
    const konva = await measure(page, `backend=konva&size=${SIZE}`);
    const offscreen = await measure(page, `backend=offscreen&size=${SIZE}`);
    await browser.close();

    console.log(`\nGrid: ${konva.roomCount.toLocaleString()} rooms (size ${SIZE}×${SIZE}), continuous pan\n`);
    console.log(`                     Konva    Offscreen`);
    console.log(`render FPS         ${String(konva.fps).padStart(7)}    ${String(offscreen.fps).padStart(7)}`);
    console.log(`max stall (ms)     ${fmt(konva.maxStall)}    ${fmt(offscreen.maxStall)}`);
    console.log(`p95 stall (ms)     ${fmt(konva.p95Stall)}    ${fmt(offscreen.p95Stall)}`);
    console.log(`avg stall (ms)     ${fmt(konva.avgStall)}    ${fmt(offscreen.avgStall)}`);
    const improvement = konva.p95Stall > 0 ? (konva.p95Stall / Math.max(0.01, offscreen.p95Stall)) : 0;
    console.log(`\nMain-thread p95 stall improvement: ${improvement.toFixed(1)}× lower with the worker\n`);
}
