import {MapRenderer, createSettings} from "@src";
import type {LodEventDetail} from "@src";
import SkeletonMapReader from "@src/bigmap/SkeletonMapReader";
import type {MapSkeleton} from "@src/bigmap/Skeleton";
import type {StreamMsg, StreamReady} from "./streaming-worker";

// A worker streams the .dat into a MapSkeleton; the core SkeletonMapReader +
// settings.lodEnabled do the rest (viewport-virtualized scene, raster LOD
// overview when zoomed out, rebuild-on-pan). This file is UI glue only.

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

const fmtN = (n: number) => n.toLocaleString("en-US");

let renderer: MapRenderer | undefined;
let reader: SkeletonMapReader | undefined;
interface AreaInfo {id: number; name: string; count: number; zLevels: number[]; grid: boolean;}
let areaInfos: AreaInfo[] = [];
let lastLod: LodEventDetail | undefined;

function run(file: File) {
    status.textContent = `Streaming ${file.name}…`;
    let total = 0; // known up front from the header (Σ area room-id lists)
    const worker = new Worker(new URL("./streaming-worker.ts", import.meta.url), {type: "module"});
    worker.onmessage = (e: MessageEvent<StreamMsg>) => {
        const m = e.data;
        if (m.type === "total") total = m.total;
        else if (m.type === "progress") {
            const pct = total ? ` (${Math.round((m.rooms / total) * 100)}%)` : "";
            const of = total ? ` / ${fmtN(total)}` : "";
            status.textContent = `Streaming ${fmtN(m.rooms)}${of} rooms…${pct}`;
        } else if (m.type === "error") status.textContent = `Error: ${m.message}`;
        else if (m.type === "ready") {
            onReady(m);
            worker.terminate();
        }
    };
    worker.postMessage({file});
}

function onReady(m: StreamReady) {
    const sk: MapSkeleton = {
        count: m.count, x: m.x, y: m.y, z: m.z, area: m.area, env: m.env, id: m.id,
        exits: m.exits, areaNames: m.areaNames, areaGridMode: m.areaGridMode,
        customEnvColors: m.customEnvColors,
        names: m.names, userData: m.userData,
        detailRooms: m.heavyRooms as unknown as MapData.Room[],
        labels: m.labels as unknown as MapData.Label[],
    };
    drop.style.display = "none";
    controls.style.display = "flex";
    status.textContent =
        `${fmtN(m.count)} rooms (${fmtN(m.heavyRooms.length)} detailed, ${fmtN(m.labels.length)} labels) ` +
        `in ${(m.elapsedMs / 1000).toFixed(1)}s`;

    // Per-area aggregate for the selectors (from the columns, pre-reader).
    const byArea = new Map<number, {count: number; zs: Set<number>}>();
    for (let i = 0; i < m.count; i++) {
        let a = byArea.get(m.area[i]);
        if (!a) {a = {count: 0, zs: new Set()}; byArea.set(m.area[i], a);}
        a.count++;
        a.zs.add(m.z[i]);
    }
    areaInfos = [...byArea.entries()]
        .map(([id, v]) => ({
            id, name: m.areaNames[id] ?? `#${id}`, count: v.count,
            zLevels: [...v.zs].sort((p, q) => p - q), grid: !!m.areaGridMode[id],
        }))
        .sort((p, q) => q.count - p.count);
    areaSel.innerHTML = areaInfos
        .map(a => `<option value="${a.id}">${a.name}${a.grid ? " (grid)" : ""} — ${fmtN(a.count)}</option>`)
        .join("");

    reader = new SkeletonMapReader(sk);
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

    show(areaInfos[0]);
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
