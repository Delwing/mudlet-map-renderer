import {MapRenderer, createSettings, MapReader} from "@src";
import type {LodEventDetail, IMapReader} from "@src";
import SkeletonMapReader from "@src/bigmap/SkeletonMapReader";
import type {LoadedMudletMap} from "@src/binary";
import type {LoadMode, LoadRequest, StreamMsg} from "./streaming-worker";

// A worker runs the core parseMudletMap() dispatcher (src/binary/loadMudletMap.ts):
// it peeks the map header (cheap: aborts before the rooms blob) to learn the
// total room count, then either streams the .dat into a MapSkeleton (huge
// maps — never holds the full object graph and the columns in memory at
// once) or does a normal full parse (small maps — a real MapReader, every
// field preserved, no skeleton overhead). This file only builds the live
// reader from the worker's result and wires up the demo UI.

const stage = document.getElementById("stage") as HTMLDivElement;
const drop = document.getElementById("drop") as HTMLDivElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const status = document.getElementById("status") as HTMLDivElement;
const hudLine = document.getElementById("hud-line") as HTMLDivElement;
const hudMetrics = document.getElementById("hud-metrics") as HTMLDivElement;
const areaSel = document.getElementById("area") as HTMLSelectElement;
const zSel = document.getElementById("z") as HTMLSelectElement;
const lookup = document.getElementById("lookup") as HTMLInputElement;
const controls = document.getElementById("controls") as HTMLDivElement;
const modeSel = document.getElementById("mode") as HTMLSelectElement;
const thresholdInput = document.getElementById("threshold") as HTMLInputElement;
const progressBar = document.getElementById("load-progress") as HTMLDivElement;
const progressFill = progressBar.querySelector(".fill") as HTMLDivElement;

function setProgress(fraction: number | null) {
    if (fraction === null) {
        progressBar.style.display = "none";
        return;
    }
    progressBar.style.display = "block";
    progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

const fmtN = (n: number) => n.toLocaleString("en-US");

/**
 * Wait for an actual paint. A single requestAnimationFrame isn't enough —
 * rAF callbacks run BEFORE that frame's style/layout/paint step, so resuming
 * synchronously inside one and immediately starting heavy work pre-empts the
 * paint entirely. The second rAF only fires once the frame in between (with
 * nothing blocking it) has been painted.
 */
function nextPaint(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

let renderer: MapRenderer | undefined;
let reader: IMapReader | undefined;
interface AreaInfo {id: number; name: string; count: number; zLevels: number[]; grid: boolean;}
let areaInfos: AreaInfo[] = [];
let lastLod: LodEventDetail | undefined;

function run(file: File) {
    status.textContent = `Reading ${file.name}…`;
    const mode = modeSel.value as LoadMode;
    const threshold = Number(thresholdInput.value) || 50_000;
    const worker = new Worker(new URL("./streaming-worker.ts", import.meta.url), {type: "module"});
    worker.onmessage = async (e: MessageEvent<StreamMsg>) => {
        const m = e.data;
        if (m.type === "progress") {
            const pct = m.total ? ` (${Math.round((m.rooms / m.total) * 100)}%)` : "";
            const of = m.total ? ` / ${fmtN(m.total)}` : "";
            status.textContent = `Streaming ${fmtN(m.rooms)}${of} rooms…${pct}`;
            setProgress(m.total ? m.rooms / m.total : null);
        } else if (m.type === "finalizing") {
            status.textContent = "Finalizing… (handing streamed data to the main thread — can take a moment for huge maps)";
            setProgress(null);
        } else if (m.type === "error") {
            status.textContent = `Error: ${m.message}`;
            setProgress(null);
        } else if (m.type === "done") {
            // Building the scene (skeleton construction, first PlaneIndex, initial
            // vector/raster paint) is synchronous main-thread work — can be a real
            // pause on a huge map. Tell the user what's happening and force a paint
            // of that message before the hang, so it doesn't look like a freeze.
            setProgress(null);
            status.textContent = "Building scene…";
            await nextPaint();
            onDone(m.loaded, m.elapsedMs);
            worker.terminate();
        }
    };
    worker.postMessage({file, mode, threshold} satisfies LoadRequest);
}

/** Shared tail: attach the renderer/reader, wire HUD events, frame the first area. */
function attach(newReader: IMapReader, infos: AreaInfo[]) {
    areaInfos = infos;
    areaSel.innerHTML = areaInfos
        .map(a => `<option value="${a.id}">${a.name}${a.grid ? " (grid)" : ""} — ${fmtN(a.count)}</option>`)
        .join("");

    reader = newReader;
    const settings = createSettings();
    settings.lodEnabled = true; // core defaults otherwise — detail zoom is identical to the real renderer

    renderer?.destroy();
    renderer = new MapRenderer(reader, settings, stage);
    renderer.on("lod", e => {
        lastLod = e;
        updateHud();
    });
    renderer.on("zoom", () => updateHud());
    // Debug/test hook.
    (window as unknown as Record<string, unknown>).__renderer = renderer;

    drop.style.display = "none";
    controls.style.display = "flex";
    show(areaInfos[0]);
}

function onDone(loaded: LoadedMudletMap, elapsedMs: number) {
    if (loaded.kind === "skeleton") {
        const sk = loaded.skeleton;
        status.textContent =
            `${fmtN(sk.count)} rooms (${fmtN(sk.detailRooms?.length ?? 0)} detailed, ${fmtN(sk.labels?.length ?? 0)} labels) ` +
            `in ${(elapsedMs / 1000).toFixed(1)}s — streamed`;

        // Per-area aggregate for the selectors (from the columns, pre-reader).
        const byArea = new Map<number, {count: number; zs: Set<number>}>();
        for (let i = 0; i < sk.count; i++) {
            let a = byArea.get(sk.area[i]);
            if (!a) {a = {count: 0, zs: new Set()}; byArea.set(sk.area[i], a);}
            a.count++;
            a.zs.add(sk.z[i]);
        }
        const infos = [...byArea.entries()]
            .map(([id, v]) => ({
                id, name: sk.areaNames[id] ?? `#${id}`, count: v.count,
                zLevels: [...v.zs].sort((p, q) => p - q), grid: !!sk.areaGridMode[id],
            }))
            .sort((p, q) => q.count - p.count);

        attach(new SkeletonMapReader(sk), infos);
    } else {
        const {map, envs} = loaded;
        let count = 0;
        for (const a of map) count += a.rooms.length;
        status.textContent = `${fmtN(count)} rooms in ${(elapsedMs / 1000).toFixed(1)}s — full parse (no data dropped)`;

        const infos = map.map(a => ({
            id: parseInt(a.areaId), name: a.areaName, count: a.rooms.length,
            zLevels: [...new Set(a.rooms.map(r => r.z))].sort((p, q) => p - q),
            grid: false, // grid-mode suppression is a bigmap/skeleton-only concept
        })).sort((p, q) => q.count - p.count);

        attach(new MapReader(map, envs), infos);
    }
}

window.addEventListener("resize", () => {
    renderer?.camera.setSize(stage.clientWidth, stage.clientHeight);
});

function show(info: AreaInfo) {
    areaSel.value = String(info.id);
    zSel.innerHTML = info.zLevels.map(z => `<option value="${z}">z = ${z}</option>`).join("");
    zSel.value = String(info.zLevels[0]);
    frameView(info.id, info.zLevels[0], info.count);
}

/**
 * Demo view policy: fit frames the *whole* area — for a million-room plane
 * that's the sparse raster regime. Floor the zoom at fit, then open zoomed in
 * to ~TARGET_VISIBLE rooms so the first thing you see is real vector rooms.
 */
function frameView(areaId: number, z: number, count: number) {
    if (!renderer) return;
    renderer.drawArea(areaId, z);
    renderer.fitArea();
    const fitZoom = renderer.getZoom();
    renderer.minZoom = fitZoom;
    const TARGET_VISIBLE = 6000;
    const factor = Math.max(1, Math.sqrt(count / TARGET_VISIBLE));
    renderer.zoomToCenter(fitZoom * factor);
}

/** One "label [bar] value/budget" row for the LOD budget metrics. */
function metricRow(label: string, value: number, budget: number, active = true): string {
    const pct = Math.min(100, (value / budget) * 100);
    const over = value > budget;
    return `
      <div class="metric${over ? " over" : ""}${active ? "" : " inactive"}">
        <span class="label">${label}</span>
        <span class="bar"><span class="fill" style="width:${pct.toFixed(0)}%"></span></span>
        <span class="value">${fmtN(value)} / ${fmtN(budget)}${active ? "" : " (off)"}</span>
      </div>`;
}

function updateHud() {
    if (!renderer) return;
    const a = areaInfos.find(x => String(x.id) === areaSel.value);
    const modeLabel = lastLod?.mode === "roomsOnly" ? "rooms-only" : lastLod?.mode;
    const drawn = lastLod ? `${modeLabel} ~${fmtN(lastLod.visibleEstimate)}` : "";
    hudLine.textContent =
        `${a?.name ?? ""} · ${drawn} · ${fmtN(a?.count ?? 0)} in plane · zoom ${renderer.getZoom().toFixed(3)}`;

    if (!lastLod) {
        hudMetrics.innerHTML = "";
        return;
    }
    const {lodRoomBudget, lodExitBudget, lodHitTestBudget} = renderer.settings;
    const exitsActive = lastLod.mode === "vector";
    hudMetrics.innerHTML =
        metricRow("vector", lastLod.visibleEstimate, lodRoomBudget) +
        metricRow("exits", lastLod.visibleEstimate, lodExitBudget, exitsActive) +
        metricRow("hit-test", lastLod.visibleEstimate, lodHitTestBudget, lastLod.hitTestActive);
}

areaSel.addEventListener("change", () => {
    const info = areaInfos.find(a => String(a.id) === areaSel.value);
    if (info) show(info);
});
zSel.addEventListener("change", () => {
    const info = areaInfos.find(a => String(a.id) === areaSel.value);
    if (info) frameView(info.id, Number(zSel.value), info.count);
});

// Look up a room by id → show its name + userData (and centre/highlight it if
// it's on the area/z currently in view). Proves id-search returns full rooms.
lookup.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !reader || !renderer) return;
    const room = reader.getRoom(Number(lookup.value));
    if (!room) {status.textContent = `room ${lookup.value} not found`; return;}
    const keys = Object.keys(room.userData);
    const ud = keys.length ? JSON.stringify(room.userData) : "—";
    status.textContent =
        `#${room.id} "${room.name || "(unnamed)"}" · area ${room.area} z ${room.z} · userData: ${ud}`;
    if (String(room.area) === areaSel.value && String(room.z) === zSel.value) {
        renderer.centerOn(room.id, true);
        renderer.clearHighlights();
        renderer.renderHighlight(room.id, "#ffcc00");
    }
});

drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {if (fileInput.files?.[0]) run(fileInput.files[0]);});
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => {e.preventDefault(); drop.classList.add("hot");}));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {e.preventDefault(); drop.classList.remove("hot");}));
drop.addEventListener("drop", e => {const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) run(f);});
