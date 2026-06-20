import {MapRenderer, createSettings} from "@src";
import type {Settings} from "@src";
import {StreamingMapReader, type Skeleton, type Viewport, type PlaneIndex} from "./StreamingMap";
import type {StreamMsg, StreamReady} from "./streaming-worker";

// Above this many rooms in view, Konva nodes give way to a filled raster overview.
const RASTER_THRESHOLD = 16000;

// The renderer's own background colour (settings default), used to paint the
// raster backdrop so the transparent Konva container reads identically to core.
let coreBg = "#000000";
let coreBgPacked = 0xff000000;

function cssToPacked(css: string): number {
    const c = css.trim();
    let r = 0, g = 0, b = 0;
    if (c[0] === "#") {
        if (c.length === 4) {
            r = parseInt(c[1] + c[1], 16); g = parseInt(c[2] + c[2], 16); b = parseInt(c[3] + c[3], 16);
        } else {
            r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16);
        }
    } else {
        const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (m) {r = +m[1]; g = +m[2]; b = +m[3];}
    }
    return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const stage = document.getElementById("stage") as HTMLDivElement;
const raster = document.getElementById("raster") as HTMLCanvasElement;
const rctx = raster.getContext("2d", {alpha: false})!;
const drop = document.getElementById("drop") as HTMLDivElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const status = document.getElementById("status") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const areaSel = document.getElementById("area") as HTMLSelectElement;
const zSel = document.getElementById("z") as HTMLSelectElement;
const lookup = document.getElementById("lookup") as HTMLInputElement;
const controls = document.getElementById("controls") as HTMLDivElement;

const fmtN = (n: number) => n.toLocaleString("en-US");

let renderer: MapRenderer | undefined;
let reader: StreamingMapReader | undefined;
// Live viewport in renderer space; StreamingMapReader reads this each refresh.
let viewport: Viewport = {minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9};
interface AreaInfo {id: number; name: string; count: number; zLevels: number[]; grid: boolean;}
let areaInfos: AreaInfo[] = [];

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
    const sk: Skeleton = {
        count: m.count, x: m.x, y: m.y, z: m.z, area: m.area, env: m.env, id: m.id,
        exits: m.exits, areaNames: m.areaNames, areaGridMode: m.areaGridMode,
        customEnvColors: m.customEnvColors,
    };
    drop.style.display = "none";
    controls.style.display = "flex";
    status.textContent =
        `${fmtN(m.count)} rooms (${fmtN(m.heavyRooms.length)} detailed, ${fmtN(m.labels.length)} labels) ` +
        `in ${(m.elapsedMs / 1000).toFixed(1)}s`;

    // Per-area aggregate for the selectors.
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

    // Core renderer defaults verbatim, so detail zoom is identical to the real
    // renderer (room gaps from roomSize 0.6, borders, area name, …). Only the
    // container background is made transparent so the raster overview shows
    // through; the raster paints the renderer's own background colour behind it.
    const settings: Settings = createSettings();
    coreBg = settings.backgroundColor;
    coreBgPacked = cssToPacked(coreBg);
    settings.backgroundColor = "transparent";
    reader = new StreamingMapReader(
        sk, () => viewport,
        m.heavyRooms as unknown as MapData.Room[],
        m.labels as unknown as MapData.Label[],
        m.names,
        m.userData,
    );

    renderer?.destroy();
    renderer = new MapRenderer(reader, settings, stage);
    sizeRaster();

    // Redraw the visible window whenever the camera moves (RAF-coalesced).
    let pending = false;
    renderer.on("pan", () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {pending = false; redraw();});
    });

    show(areaInfos[0]);
}

/**
 * One render pass: pick raster vs Konva by how many rooms are in view. Below the
 * threshold, Konva draws every room at full detail; above it, the plane reports
 * no rooms and we paint a filled pixel overview instead — so the zoomed-out view
 * never erodes the way capped Konva nodes do.
 */
function redraw() {
    if (!renderer || !reader) return;
    const areaId = Number(areaSel.value), z = Number(zSel.value);
    // Pad the selection viewport: a room whose centre is just off-screen can
    // still have half its body in view (rooms are filtered by centre), so
    // without a margin those edge rooms pop in/out as you pan. The padding also
    // lets the renderer's own cull reveal margin rooms between rebuilds.
    const vp = renderer.getViewportBounds();
    const padX = (vp.maxX - vp.minX) * 0.06 + 1;
    const padY = (vp.maxY - vp.minY) * 0.06 + 1;
    viewport = {minX: vp.minX - padX, maxX: vp.maxX + padX, minY: vp.minY - padY, maxY: vp.maxY + padY};
    const p = reader.planeIndex(areaId, z);
    const count = reader.countInViewport(p, viewport); // for the HUD only
    // If the WHOLE plane fits the Konva budget, always draw it with Konva — a
    // 1k-room area never needs the raster overview. Only genuinely large planes
    // switch to raster, and they switch by ZOOM (not by room count, which varies
    // with local density and would flip modes mid-pan); `scale` is constant
    // while panning. Bound: worst case (fully packed) the viewport holds
    // ~W*H/scale² rooms, so Konva is safe once that ≤ the budget.
    let useRaster = false;
    if (p.indices.length > RASTER_THRESHOLD) {
        const scale = renderer.camera.getScale();
        useRaster = scale * scale < (stage.clientWidth * stage.clientHeight) / RASTER_THRESHOLD;
    }
    reader.rasterMode = useRaster;
    renderer.refresh();
    if (useRaster) drawRaster(p, viewport); else clearRaster();
    updateHud(count, useRaster);
}

function drawRaster(p: PlaneIndex, vp: Viewport) {
    if (!renderer || !reader) return;
    const cam = renderer.camera;
    const scale = cam.getScale();
    const pos = cam.position;
    const W = raster.width, H = raster.height;
    const img = rctx.createImageData(W, H);
    const data = new Uint32Array(img.data.buffer);
    data.fill(coreBgPacked);

    // Box must always cover the inter-room spacing (= `scale` px, fractional).
    // round(scale) under-covers at some zooms → sub-pixel gaps read as a
    // flickering grid; ceil(scale)+1 guarantees overlap → consistently solid.
    const s = Math.max(1, Math.min(48, Math.ceil(scale) + 1));
    const half = s >> 1;
    const sk = reader.skeleton();
    reader.forEachVisible(p, vp, (i) => {
        const sx = Math.round(sk.x[i] * scale + pos.x) - half;
        const sy = Math.round(sk.y[i] * scale + pos.y) - half;
        const packed = reader!.packed(sk.env[i]);
        for (let dy = 0; dy < s; dy++) {
            const py = sy + dy;
            if (py < 0 || py >= H) continue;
            const row = py * W;
            for (let dx = 0; dx < s; dx++) {
                const px = sx + dx;
                if (px >= 0 && px < W) data[row + px] = packed;
            }
        }
    });
    rctx.putImageData(img, 0, 0);
}

function clearRaster() {
    // The backdrop behind the transparent Konva container in detail mode — must
    // match the renderer's background so room gaps/borders read like core.
    rctx.fillStyle = coreBg;
    rctx.fillRect(0, 0, raster.width, raster.height);
}

function sizeRaster() {
    raster.width = stage.clientWidth;
    raster.height = stage.clientHeight;
}

window.addEventListener("resize", () => {
    if (!renderer) return;
    renderer.camera.setSize(stage.clientWidth, stage.clientHeight);
    sizeRaster();
    redraw();
});

function show(info: AreaInfo) {
    if (!renderer) return;
    areaSel.value = String(info.id);
    zSel.innerHTML = info.zLevels.map(z => `<option value="${z}">z = ${z}</option>`).join("");
    zSel.value = String(info.zLevels[0]);
    frameView(info.id, info.zLevels[0], info.count);
}

function frameView(areaId: number, z: number, count: number) {
    if (!renderer || !reader) return;
    // The full-area seed is always the raster regime — flag it so drawArea's
    // build does no work; redraw() below settles the final mode.
    reader.rasterMode = true;
    // Seed viewport with the full area bounds so the first build (and fit) frame it.
    viewport = {...reader.getArea(areaId).getFullBounds()};
    renderer.drawArea(areaId, z);
    renderer.fitArea();

    // Fit frames the *whole* area — for a million-room plane that's the sparse
    // raster regime. Floor the zoom at fit, then open zoomed in to ~TARGET_VISIBLE
    // rooms so the first thing you see is real, dense Konva rooms.
    const fitZoom = renderer.getZoom();
    renderer.minZoom = fitZoom;
    const TARGET_VISIBLE = 6000;
    const factor = Math.max(1, Math.sqrt(count / TARGET_VISIBLE));
    renderer.zoomToCenter(fitZoom * factor);
    redraw();
}

function updateHud(count?: number, useRaster?: boolean) {
    if (!reader || !renderer) return;
    const a = areaInfos.find(x => String(x.id) === areaSel.value);
    const drawn = useRaster
        ? `raster ${fmtN(count ?? 0)}`
        : `konva ${fmtN(reader.lastVisibleCount)}`;
    hud.textContent =
        `${a?.name ?? ""} · ${drawn} · ${fmtN(a?.count ?? 0)} in plane · zoom ${renderer.getZoom().toFixed(3)}`;
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
