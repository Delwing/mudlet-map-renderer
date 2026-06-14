/**
 * OffscreenCanvas vs Konva benchmark.
 *
 * Loads a large single-area grid map, runs a continuous camera oscillation so
 * the scene re-rasterises every frame, and measures how available the MAIN
 * thread stays — the thing the worker backend is supposed to buy you.
 *
 * Main-thread stall is measured with a MessageChannel ping-pong loop (no
 * 4 ms `setTimeout` clamp): when the main thread is busy rasterising, the loop
 * can't run and the gap between pings spikes. Konva rasterises on the main
 * thread (big stalls); the worker backend rasterises off-thread (small stalls).
 */

import {MapRenderer, createSettings} from "@src";
import {createOffscreenBackend} from "@src/rendering/offscreen";
import MapReader from "@src/reader/MapReader";
import {generateGridMap} from "./generateMap";

const params = new URLSearchParams(location.search);
const backend = params.get("backend") === "offscreen" ? "offscreen" : "konva";
const size = Math.max(10, Math.min(160, parseInt(params.get("size") ?? "70")));
let coalesce = params.get("coalesce") === "1";

const stage = document.getElementById("stage") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const {map, envs, roomCount} = generateGridMap(size);
const mapReader = new MapReader(map, envs);

const settings = createSettings();
settings.areaName = false;
settings.coalesceRooms = coalesce;

const renderer = backend === "offscreen"
    ? new MapRenderer(mapReader, settings, stage, createOffscreenBackend(stage))
    : new MapRenderer(mapReader, settings, stage);

renderer.drawArea(1, 0);
renderer.fitArea();

// --- Main-thread stall meter (MessageChannel ping-pong) ---
const stalls: number[] = [];
let last = performance.now();
const channel = new MessageChannel();
channel.port1.onmessage = () => {
    const now = performance.now();
    stalls.push(now - last);
    if (stalls.length > 240) stalls.shift();
    last = now;
    channel.port2.postMessage(0);
};
channel.port2.postMessage(0);

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// --- Continuous pan to force per-frame rasterisation ---
const cam = renderer.camera;
const baseX = cam.getViewportBounds();
const centerX = (baseX.minX + baseX.maxX) / 2;
const centerY = (baseX.minY + baseX.maxY) / 2;
const amplitude = size * 0.15;

let frames = 0;
let fps = 0;
let fpsWindowStart = performance.now();
let panning = true;

function animate() {
    if (panning) {
        const t = performance.now() / 1000;
        cam.panToMapPoint(centerX + Math.sin(t * 1.5) * amplitude, centerY + Math.cos(t * 1.1) * amplitude);
    }
    frames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 500) {
        fps = Math.round((frames * 1000) / (now - fpsWindowStart));
        frames = 0;
        fpsWindowStart = now;
    }
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// --- HUD ---
// Built once; only the value cells and button labels are mutated per tick so
// the buttons stay live (rebuilding innerHTML each tick made clicks feel janky).
function fmt(n: number) {
    return n.toFixed(1);
}

const cz = (c: boolean) => (c ? 1 : 0);
hud.innerHTML = `
    <div class="row title">${backend === "offscreen" ? "OffscreenCanvas (worker)" : "Konva (main thread)"}</div>
    <div class="row"><span>Rooms</span><b>${roomCount.toLocaleString()}</b></div>
    <div class="row"><span>Coalesce rooms</span><b id="m-coalesce"></b></div>
    <div class="row"><span>Render FPS</span><b id="m-fps"></b></div>
    <div class="row hl"><span>Main-thread max stall</span><b id="m-max"></b></div>
    <div class="row hl"><span>Main-thread p95 stall</span><b id="m-p95"></b></div>
    <div class="row"><span>Main-thread avg stall</span><b id="m-avg"></b></div>
    <div class="hint">Lower stall = main thread freer. The worker backend should
    show far smaller stalls than Konva at the same room count. Coalescing batches
    same-style room bodies and exit lines into one fill/stroke each.</div>
    <div class="links">
        <a href="?backend=konva&size=${size}&coalesce=${cz(coalesce)}">Konva</a> ·
        <a href="?backend=offscreen&size=${size}&coalesce=${cz(coalesce)}">Offscreen</a> ·
        <a href="?backend=${backend}&size=${Math.max(10, size - 20)}&coalesce=${cz(coalesce)}">smaller</a> ·
        <a href="?backend=${backend}&size=${Math.min(160, size + 20)}&coalesce=${cz(coalesce)}">bigger</a>
    </div>
    <button id="coalesce-toggle"></button>
    <button id="pan-toggle"></button>
`;

const el = (id: string) => document.getElementById(id)!;
const mCoalesce = el("m-coalesce"), mFps = el("m-fps");
const mMax = el("m-max"), mP95 = el("m-p95"), mAvg = el("m-avg");
const coalesceBtn = el("coalesce-toggle"), panBtn = el("pan-toggle");

coalesceBtn.onclick = () => {
    coalesce = !coalesce;
    settings.coalesceRooms = coalesce;
    stalls.length = 0; // reset stall window so the new mode measures cleanly
    renderer.refresh();
    syncControls();
};
panBtn.onclick = () => { panning = !panning; syncControls(); };

function syncControls() {
    mCoalesce.textContent = coalesce ? "ON" : "OFF";
    coalesceBtn.textContent = `${coalesce ? "Disable" : "Enable"} coalescing`;
    panBtn.textContent = panning ? "Pause pan" : "Resume pan";
}

function updateHud() {
    mFps.textContent = String(fps);
    mMax.textContent = `${fmt(stalls.length ? Math.max(...stalls) : 0)} ms`;
    mP95.textContent = `${fmt(percentile(stalls, 95))} ms`;
    mAvg.textContent = `${fmt(stalls.length ? stalls.reduce((a, b) => a + b, 0) / stalls.length : 0)} ms`;
}
syncControls();
updateHud();
setInterval(updateHud, 250);

// Exposed for automated measurement (bench/measure.mjs).
(window as unknown as {__benchMetrics: () => unknown}).__benchMetrics = () => ({
    backend,
    coalesce,
    roomCount,
    fps,
    maxStall: stalls.length ? Math.max(...stalls) : 0,
    p95Stall: percentile(stalls, 95),
    avgStall: stalls.length ? stalls.reduce((a, b) => a + b, 0) / stalls.length : 0,
});
