import "konva/canvas-backend";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { SvgExporter } from "../src/export/SvgExporter";
import { CanvasExporter } from "../src/export/CanvasExporter";
import { MapRenderer } from "../src/rendering/MapRenderer";
import type { MapState } from "../src/MapState";
import { createSettings, type Settings } from "../src/types/Settings";
import { createTestMapReader } from "../tests/helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REVIEW_DIR = join(ROOT, "snapshot-review");

const SVG_SNAP = join(ROOT, "tests/__snapshots__/svg-export.test.ts.snap");
const HEADLESS_SNAP = join(ROOT, "tests/__snapshots__/headless.test.ts.snap");
const CANVAS_SNAP = join(ROOT, "tests/__snapshots__/canvas-export.test.ts.snap");

const WIDTH = 400;
const HEIGHT = 300;

// === Renderers (mirror tests/{svg-export,headless,canvas-export}.test.ts) ===

function svgExport(overrides?: Partial<Settings>): string {
    const renderer = new MapRenderer(createTestMapReader(), { ...createSettings(), ...overrides });
    renderer.drawArea(1, 0);
    return renderer.export(new SvgExporter()) ?? "";
}

function svgExportWithState(setup: (s: MapState) => void, options?: any): string {
    const renderer = new MapRenderer(createTestMapReader(), createSettings());
    setup(renderer.state);
    return renderer.export(new SvgExporter(options)) ?? "";
}

function headlessSvg(setup: (r: MapRenderer) => void): string {
    const renderer = new MapRenderer(createTestMapReader(), createSettings());
    renderer.drawArea(1, 0);
    setup(renderer);
    return renderer.export(new SvgExporter()) ?? "";
}

function toBuffer(c: unknown): Buffer {
    return (c as import('canvas').Canvas).toBuffer("image/png");
}

function canvasExport(overrides?: Partial<Settings>): Buffer {
    const renderer = new MapRenderer(createTestMapReader(), { ...createSettings(), ...overrides });
    renderer.drawArea(1, 0);
    return toBuffer(renderer.export(new CanvasExporter({ width: WIDTH, height: HEIGHT })));
}

function canvasWithOverlays(overlays: any): Buffer {
    const renderer = new MapRenderer(createTestMapReader(), createSettings());
    renderer.drawArea(1, 0);
    return toBuffer(renderer.export(new CanvasExporter({ width: WIDTH, height: HEIGHT, overlays })));
}

function canvasArea(areaId: number, z: number, opts?: any): Buffer {
    const renderer = new MapRenderer(createTestMapReader(), createSettings());
    renderer.drawArea(areaId, z);
    return toBuffer(renderer.export(new CanvasExporter({ width: WIDTH, height: HEIGHT, ...opts })));
}

// === Scenarios ===

type Scenario = {
    key: string;
    name: string;
    ext: "svg" | "png";
    snapFile: string;
    render: () => string | Buffer;
};

const scenarios: Scenario[] = [
    // svg-export.test.ts
    { key: "SvgRenderBackend > basic export > snapshot - default settings 1",
      name: "svg-default", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport() },
    { key: "SvgRenderBackend > room shapes > snapshot - circle rooms 1",
      name: "svg-circle", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ roomShape: "circle" }) },
    { key: "SvgRenderBackend > room shapes > snapshot - rounded rectangle rooms 1",
      name: "svg-rounded", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ roomShape: "roundedRectangle" }) },
    { key: "SvgRenderBackend > rendering modes > snapshot - frame mode 1",
      name: "svg-frame", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ frameMode: true }) },
    { key: "SvgRenderBackend > rendering modes > snapshot - colored mode 1",
      name: "svg-colored", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ coloredMode: true }) },
    { key: "SvgRenderBackend > rendering modes > snapshot - emboss mode 1",
      name: "svg-emboss", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ emboss: true }) },
    { key: "SvgRenderBackend > rendering modes > snapshot - frame + circle 1",
      name: "svg-frame-circle", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ frameMode: true, roomShape: "circle" }) },
    { key: "SvgRenderBackend > rendering modes > snapshot - colored + emboss 1",
      name: "svg-colored-emboss", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ coloredMode: true, emboss: true }) },
    { key: "SvgRenderBackend > grid > snapshot - grid enabled 1",
      name: "svg-grid", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ gridEnabled: true }) },
    { key: "SvgRenderBackend > visual options > snapshot - no borders 1",
      name: "svg-no-borders", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ borders: false }) },
    { key: "SvgRenderBackend > visual options > snapshot - area name shown 1",
      name: "svg-area-name", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExport({ areaName: true }) },
    { key: "SvgRenderBackend > overlays > snapshot - position marker 1",
      name: "svg-overlay-position", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExportWithState(s => s.setArea(1, 0), { overlays: { position: { roomId: 1 } } }) },
    { key: "SvgRenderBackend > overlays > snapshot - highlights 1",
      name: "svg-overlay-highlights", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExportWithState(s => s.setArea(1, 0),
          { overlays: { highlights: [{ roomId: 1, color: "#ff0000" }, { roomId: 3, color: "#00ff00" }] } }) },
    { key: "SvgRenderBackend > overlays > snapshot - path overlay 1",
      name: "svg-overlay-path", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExportWithState(s => s.setArea(1, 0),
          { overlays: { paths: [{ locations: [6, 2, 1, 3], color: "#66E64D" }] } }) },
    { key: "SvgRenderBackend > different area > snapshot - area 2 (Dark Forest) 1",
      name: "svg-area-2", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExportWithState(s => s.setArea(2, 0)) },
    { key: "SvgRenderBackend > z-level > snapshot - area 1 z=-1 (underground) 1",
      name: "svg-area-1-z-minus1", ext: "svg", snapFile: SVG_SNAP,
      render: () => svgExportWithState(s => s.setArea(1, -1)) },

    // headless.test.ts
    { key: "HeadlessRenderer > drawArea + exportSvg > snapshot - basic area export 1",
      name: "headless-basic", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(() => {}) },
    { key: "HeadlessRenderer > position > snapshot - with position marker 1",
      name: "headless-position", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => { r.state.positionRoomId = 1; }) },
    { key: "HeadlessRenderer > highlights > snapshot - single highlight 1",
      name: "headless-highlight-single", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => r.renderHighlight(1, "#ff0000")) },
    { key: "HeadlessRenderer > highlights > snapshot - multiple highlights 1",
      name: "headless-highlight-multi", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => { r.renderHighlight(1, "#ff0000"); r.renderHighlight(3, "#00ff00"); }) },
    { key: "HeadlessRenderer > paths > snapshot - path overlay 1",
      name: "headless-path", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => r.renderPath([6, 2, 1, 3])) },
    { key: "HeadlessRenderer > paths > snapshot - path with custom color 1",
      name: "headless-path-color", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => r.renderPath([1, 2, 6], "#ff0000")) },
    { key: "HeadlessRenderer > combined overlays > snapshot - position + highlights + path 1",
      name: "headless-combined", ext: "svg", snapFile: HEADLESS_SNAP,
      render: () => headlessSvg(r => {
          r.state.positionRoomId = 1;
          r.renderHighlight(3, "#ff0000");
          r.renderHighlight(6, "#0000ff");
          r.renderPath([6, 2, 1, 3], "#66E64D");
      }) },

    // canvas-export.test.ts
    { key: "CanvasExporter > basic export > snapshot - default settings 1",
      name: "canvas-default", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport() },
    { key: "CanvasExporter > room shapes > snapshot - circle rooms 1",
      name: "canvas-circle", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ roomShape: "circle" }) },
    { key: "CanvasExporter > room shapes > snapshot - rounded rectangle rooms 1",
      name: "canvas-rounded", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ roomShape: "roundedRectangle" }) },
    { key: "CanvasExporter > rendering modes > snapshot - frame mode 1",
      name: "canvas-frame", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ frameMode: true }) },
    { key: "CanvasExporter > rendering modes > snapshot - colored mode 1",
      name: "canvas-colored", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ coloredMode: true }) },
    { key: "CanvasExporter > rendering modes > snapshot - emboss mode 1",
      name: "canvas-emboss", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ emboss: true }) },
    { key: "CanvasExporter > rendering modes > snapshot - frame + circle 1",
      name: "canvas-frame-circle", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ frameMode: true, roomShape: "circle" }) },
    { key: "CanvasExporter > rendering modes > snapshot - colored + emboss 1",
      name: "canvas-colored-emboss", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ coloredMode: true, emboss: true }) },
    { key: "CanvasExporter > grid > snapshot - grid enabled 1",
      name: "canvas-grid", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ gridEnabled: true }) },
    { key: "CanvasExporter > visual options > snapshot - no borders 1",
      name: "canvas-no-borders", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ borders: false }) },
    { key: "CanvasExporter > visual options > snapshot - area name shown 1",
      name: "canvas-area-name", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasExport({ areaName: true }) },
    { key: "CanvasExporter > overlays > snapshot - position marker 1",
      name: "canvas-overlay-position", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasWithOverlays({ position: { roomId: 1 } }) },
    { key: "CanvasExporter > overlays > snapshot - highlights 1",
      name: "canvas-overlay-highlights", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasWithOverlays({ highlights: [{ roomId: 1, color: "#ff0000" }, { roomId: 3, color: "#00ff00" }] }) },
    { key: "CanvasExporter > overlays > snapshot - path overlay 1",
      name: "canvas-overlay-path", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasWithOverlays({ paths: [{ locations: [6, 2, 1, 3], color: "#66E64D" }] }) },
    { key: "CanvasExporter > different area > snapshot - area 2 (Dark Forest) 1",
      name: "canvas-area-2", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasArea(2, 0) },
    { key: "CanvasExporter > z-level > snapshot - area 1 z=-1 (underground) 1",
      name: "canvas-area-1-z-minus1", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasArea(1, -1) },
    { key: "CanvasExporter > export options > snapshot - centered on room 1",
      name: "canvas-centered", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasArea(1, 0, { roomId: 1, padding: 2 }) },
    { key: "CanvasExporter > export options > snapshot - custom padding 1",
      name: "canvas-padding", ext: "png", snapFile: CANVAS_SNAP,
      render: () => canvasArea(1, 0, { padding: 10 }) },
];

// === Snapshot file parser ===

const snapCache = new Map<string, Map<string, string>>();

function loadSnap(path: string): Map<string, string> {
    let cached = snapCache.get(path);
    if (cached) return cached;
    const content = readFileSync(path, "utf-8");
    cached = new Map<string, string>();
    // exports[`KEY`] = `VALUE`;  (VALUE may span lines)
    const re = /exports\[`([^`]+)`\]\s*=\s*`([\s\S]*?)`;\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) cached.set(m[1], m[2]);
    snapCache.set(path, cached);
    return cached;
}

// SVG snapshots are stored as `\n"<svg ...>...\n</svg>"\n` — strip the outer "..."
function unwrapSvg(s: string): string {
    const t = s.replace(/^\n+/, "").replace(/\n+$/, "");
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
    return t;
}

// Canvas snapshots: `\n{\n  "data": [...],\n  "type": "Buffer",\n}\n`
function parseBuffer(s: string): Buffer {
    const cleaned = s.trim().replace(/,(\s*[\]}])/g, "$1");
    const obj = JSON.parse(cleaned) as { data: number[]; type: string };
    return Buffer.from(obj.data);
}

// === Run ===

if (existsSync(REVIEW_DIR)) rmSync(REVIEW_DIR, { recursive: true });
mkdirSync(join(REVIEW_DIR, "before"), { recursive: true });
mkdirSync(join(REVIEW_DIR, "after"), { recursive: true });

type Result = {
    name: string;
    ext: "svg" | "png";
    suite: string;
    hasBefore: boolean;
    beforeSize: number;
    afterSize: number;
    beforeDataUri: string;
    afterDataUri: string;
};

function dataUri(ext: "svg" | "png", content: Buffer | string): string {
    if (ext === "svg") {
        const raw = typeof content === "string" ? content : content.toString("utf-8");
        // SVGs only declare viewBox — inject pixel width/height so <img> can size them.
        const sized = ensureSvgSize(raw);
        return `data:image/svg+xml;base64,${Buffer.from(sized, "utf-8").toString("base64")}`;
    }
    const buf = typeof content === "string" ? Buffer.from(content) : content;
    return `data:image/png;base64,${buf.toString("base64")}`;
}

// Add width/height attrs to the root <svg> based on its viewBox aspect ratio.
// Used so <img src="..."> can resolve a non-zero naturalWidth.
function ensureSvgSize(svg: string): string {
    const tagMatch = svg.match(/<svg\b([^>]*)>/);
    if (!tagMatch) return svg;
    const attrs = tagMatch[1];
    if (/\bwidth\s*=/.test(attrs) && /\bheight\s*=/.test(attrs)) return svg;
    const vbMatch = attrs.match(/\bviewBox\s*=\s*"([^"]+)"/);
    if (!vbMatch) return svg;
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return svg;
    const [, , vbW, vbH] = parts;
    if (vbW <= 0 || vbH <= 0) return svg;
    const targetW = 800;
    const targetH = Math.round(targetW * (vbH / vbW));
    const newAttrs = `${attrs} width="${targetW}" height="${targetH}"`;
    return svg.replace(tagMatch[0], `<svg${newAttrs}>`);
}

const results: Result[] = [];
let ok = 0, missingSnap = 0, errors = 0;

function suiteOf(key: string): string {
    return key.split(" > ")[0];
}

for (const s of scenarios) {
    try {
        let beforeSize = 0;
        let beforeDataUri = "";
        const snapMap = loadSnap(s.snapFile);
        const raw = snapMap.get(s.key);
        const hasBefore = raw !== undefined;
        if (!hasBefore) {
            console.warn(`  [no-snap] ${s.name}`);
            missingSnap++;
        } else {
            const before = s.ext === "svg" ? unwrapSvg(raw) : parseBuffer(raw);
            writeFileSync(join(REVIEW_DIR, "before", `${s.name}.${s.ext}`), before as any);
            beforeSize = typeof before === "string" ? Buffer.byteLength(before) : before.length;
            beforeDataUri = dataUri(s.ext, before);
        }
        const after = s.render();
        writeFileSync(join(REVIEW_DIR, "after", `${s.name}.${s.ext}`), after as any);
        const afterSize = typeof after === "string" ? Buffer.byteLength(after) : after.length;
        const afterDataUri = dataUri(s.ext, after);
        results.push({
            name: s.name, ext: s.ext, suite: suiteOf(s.key),
            hasBefore, beforeSize, afterSize, beforeDataUri, afterDataUri,
        });
        ok++;
    } catch (e) {
        console.error(`  [error] ${s.name}: ${(e as Error).message}`);
        errors++;
    }
}

writeFileSync(join(REVIEW_DIR, "index.html"), buildIndexHtml(results));

console.log(`\n${ok} pairs written, ${missingSnap} missing snapshots, ${errors} errors`);
console.log(`Open: ${join(REVIEW_DIR, "index.html")}`);

// === Side-by-side viewer ===

function buildIndexHtml(items: Result[]): string {
    const bySuite = new Map<string, Result[]>();
    for (const r of items) {
        if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
        bySuite.get(r.suite)!.push(r);
    }

    const sectionHtml: string[] = [];
    for (const [suite, rows] of bySuite) {
        const cards = rows.map(r => renderCard(r)).join("\n");
        sectionHtml.push(`<section><h2>${escapeHtml(suite)} <span class="count">${rows.length}</span></h2>${cards}</section>`);
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Snapshot Review</title>
<style>
:root {
    --bg: #0f1115;
    --panel: #1a1d24;
    --border: #2a2f3a;
    --text: #e6e8eb;
    --muted: #888c95;
    --accent: #66E64D;
    --warn: #f0a020;
    --ok: #4d9eff;
    --diff: #ff3344;
}
* { box-sizing: border-box; }
body {
    margin: 0; padding: 24px;
    background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, system-ui, sans-serif;
}
h1 { margin: 0 0 8px; font-size: 24px; }
.summary { color: var(--muted); margin-bottom: 24px; }
.summary b { color: var(--text); }
.controls { margin-bottom: 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.controls input[type="search"] {
    padding: 6px 10px; background: var(--panel); border: 1px solid var(--border);
    color: var(--text); border-radius: 4px; min-width: 240px;
}
.controls label { color: var(--muted); display: flex; gap: 6px; align-items: center; cursor: pointer; }
.controls .pill {
    padding: 4px 10px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 12px; font-size: 12px; color: var(--muted);
}
section { margin-bottom: 32px; }
section h2 {
    margin: 0 0 12px; font-size: 16px; font-weight: 600;
    border-bottom: 1px solid var(--border); padding-bottom: 8px;
}
.count {
    color: var(--muted); font-size: 12px; font-weight: 400; margin-left: 6px;
}
.card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
    margin-bottom: 12px; overflow: hidden;
}
.card-header {
    padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid var(--border); cursor: pointer; user-select: none;
}
.card-header:hover { background: rgba(255,255,255,0.02); }
.card-name { font-family: ui-monospace, monospace; font-size: 13px; }
.card-meta { color: var(--muted); font-size: 12px; display: flex; gap: 12px; align-items: center; }
.card-meta .delta { color: var(--ok); }
.card-meta .delta.warn { color: var(--warn); }
.card-meta .pixdiff { color: var(--muted); font-family: ui-monospace, monospace; }
.card-meta .pixdiff.has-diff { color: var(--diff); }
.card-body { display: none; grid-template-columns: 1fr 1fr; gap: 0; }
.card.open .card-body { display: grid; }
body.show-diff .card.open .card-body { grid-template-columns: 1fr 1fr 1fr; }
.pane { padding: 12px; min-width: 0; }
.pane + .pane { border-left: 1px solid var(--border); }
.pane h3 {
    margin: 0 0 8px; font-size: 11px; text-transform: uppercase; color: var(--muted);
    letter-spacing: 0.05em; display: flex; justify-content: space-between;
}
.pane h3 .stat { color: var(--diff); font-weight: normal; text-transform: none; letter-spacing: 0; }
.pane-frame {
    background: #000; border-radius: 4px; min-height: 200px;
    text-align: center; overflow: hidden; padding: 8px;
    position: relative;
}
.img-wrap {
    position: relative; display: inline-block; line-height: 0;
    vertical-align: middle;
    max-width: 100%;
}
.img-wrap > img {
    max-width: 100%; max-height: 600px; display: block;
}
.bbox-overlay {
    position: absolute; pointer-events: none;
    border: 2px solid var(--accent);
    background: rgba(102, 230, 77, 0.1);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5);
    display: none;
}
body.show-bbox .img-wrap .bbox-overlay.has-box { display: block; }
.zoom-lens {
    position: absolute; pointer-events: none;
    width: 180px; height: 180px;
    border: 2px solid var(--text); border-radius: 50%;
    background-repeat: no-repeat; background-color: #000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    display: none; z-index: 10;
}
.zoom-lens.pixelated { image-rendering: pixelated; }
body.show-zoom .img-wrap.zoom-active .zoom-lens { display: block; }
.checker {
    background-image:
        linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
        linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
        linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-color: #2a2a2a;
}
.pane-diff { display: none; }
body.show-diff .pane-diff { display: block; }
.missing {
    color: var(--warn); font-style: italic; padding: 40px;
}
</style>
</head>
<body>
<h1>Snapshot Review</h1>
<div class="summary">
    <b>${items.length}</b> pairs · <b>${items.filter(r => !r.hasBefore).length}</b> missing snapshots ·
    Click a card to expand · <code>before/</code> = expected, <code>after/</code> = current code output
</div>
<div class="controls">
    <input type="search" placeholder="Filter by name…" id="filter">
    <label><input type="checkbox" id="expand-all"> Expand all</label>
    <label><input type="checkbox" id="show-diff"> Diff pane</label>
    <label><input type="checkbox" id="show-bbox" checked> Bounding box</label>
    <label><input type="checkbox" id="show-zoom" checked> Hover zoom</label>
    <label><input type="checkbox" id="diffs-only"> Only differing</label>
    <span class="pill" id="diff-status">Diff: off</span>
</div>
${sectionHtml.join("\n")}

<script>
const cards = document.querySelectorAll('.card');

cards.forEach(c => {
    c.querySelector('.card-header').addEventListener('click', () => {
        c.classList.toggle('open');
        if (c.classList.contains('open') && document.body.classList.contains('show-diff')) {
            renderDiff(c);
        }
    });
});

document.getElementById('expand-all').addEventListener('change', e => {
    const open = e.target.checked;
    cards.forEach(c => {
        c.classList.toggle('open', open);
        if (open && document.body.classList.contains('show-diff')) renderDiff(c);
    });
});

document.getElementById('show-diff').addEventListener('change', e => {
    document.body.classList.toggle('show-diff', e.target.checked);
    if (e.target.checked) {
        cards.forEach(c => { if (c.classList.contains('open')) renderDiff(c); });
    }
});

document.getElementById('show-bbox').addEventListener('change', e => {
    document.body.classList.toggle('show-bbox', e.target.checked);
    if (e.target.checked) computeAllDiffs();
});

document.getElementById('show-zoom').addEventListener('change', e => {
    document.body.classList.toggle('show-zoom', e.target.checked);
});

document.getElementById('diffs-only').addEventListener('change', e => {
    if (e.target.checked) computeAllDiffs().then(updateDiffsOnlyFilter);
    else updateDiffsOnlyFilter();
});
document.getElementById('filter').addEventListener('input', applyFilter);

document.body.classList.add('show-bbox', 'show-zoom');
document.getElementById('show-bbox').checked = true;
document.getElementById('show-zoom').checked = true;

function computeAllDiffs() {
    document.getElementById('diff-status').textContent = 'Diff: computing…';
    const all = [...cards];
    const open = all.filter(c => c.classList.contains('open'));
    const closed = all.filter(c => !c.classList.contains('open'));
    return Promise.all([...open, ...closed].map(ensureDiff)).then(() => {
        document.getElementById('diff-status').textContent = 'Diff: ' + cards.length + ' computed';
    });
}

function applyFilter() {
    const q = document.getElementById('filter').value.toLowerCase();
    const diffsOnly = document.getElementById('diffs-only').checked;
    cards.forEach(c => {
        const name = c.dataset.name || '';
        const matchesText = name.includes(q);
        const matchesDiff = !diffsOnly || (parseInt(c.dataset.diffCount || '-1') > 0);
        c.style.display = (matchesText && matchesDiff) ? '' : 'none';
    });
    document.querySelectorAll('section').forEach(sec => {
        const visible = [...sec.querySelectorAll('.card')].some(c => c.style.display !== 'none');
        sec.style.display = visible ? '' : 'none';
    });
}

function updateDiffsOnlyFilter() { applyFilter(); }

const diffCache = new Map();

async function ensureDiff(card) {
    const beforeSrc = card.dataset.before;
    const afterSrc = card.dataset.after;
    const headerStat = card.querySelector('.pixdiff');
    if (!beforeSrc) return null;

    const key = card.dataset.name;
    let result = diffCache.get(key);
    if (!result) {
        try {
            result = await computeDiff(beforeSrc, afterSrc);
            diffCache.set(key, result);
        } catch (err) {
            console.error(card.dataset.name, err);
            return null;
        }
    }

    card.dataset.diffCount = String(result.changed);
    const pct = (result.changed / result.total * 100).toFixed(2);
    if (headerStat) {
        headerStat.textContent = result.changed > 0 ? '⏷ ' + pct + '%' : '✓';
        headerStat.classList.toggle('has-diff', result.changed > 0);
    }

    applyBboxToCard(card, result);
    return result;
}

async function renderDiff(card) {
    const diffPane = card.querySelector('.pane-diff .pane-frame');
    const stat = card.querySelector('.pane-diff .stat');
    const beforeSrc = card.dataset.before;

    if (!beforeSrc) {
        diffPane.innerHTML = '<div class="missing">no before snapshot</div>';
        stat.textContent = '';
        return;
    }

    const result = await ensureDiff(card);
    if (!result) {
        diffPane.innerHTML = '<div class="missing">diff failed</div>';
        return;
    }

    diffPane.innerHTML = '';
    diffPane.classList.add('checker');
    const img = document.createElement('img');
    img.src = result.dataUrl;
    diffPane.appendChild(img);

    const pct = (result.changed / result.total * 100).toFixed(2);
    stat.textContent = result.changed > 0
        ? result.changed.toLocaleString() + ' px (' + pct + '%)'
        : 'identical';
}

function applyBboxToCard(card, result) {
    const wraps = card.querySelectorAll('.pane:not(.pane-diff) .img-wrap');
    wraps.forEach(wrap => {
        const overlay = wrap.querySelector('.bbox-overlay');
        if (!overlay) return;
        if (result.changed === 0 || result.box.maxX < 0) {
            overlay.classList.remove('has-box');
            return;
        }
        const w = result.imgW;
        const h = result.imgH;
        const x = result.box.minX, y = result.box.minY;
        const bw = result.box.maxX - result.box.minX + 1;
        const bh = result.box.maxY - result.box.minY + 1;
        overlay.style.left = (x / w * 100) + '%';
        overlay.style.top = (y / h * 100) + '%';
        overlay.style.width = (bw / w * 100) + '%';
        overlay.style.height = (bh / h * 100) + '%';
        overlay.classList.add('has-box');
    });
}

async function computeDiff(beforeSrc, afterSrc) {
    const [a, b] = await Promise.all([loadImage(beforeSrc), loadImage(afterSrc)]);
    const w = Math.max(a.naturalWidth, b.naturalWidth) || 400;
    const h = Math.max(a.naturalHeight, b.naturalHeight) || 300;

    const cnvA = drawToCanvas(a, w, h);
    const cnvB = drawToCanvas(b, w, h);
    const dataA = cnvA.getContext('2d').getImageData(0, 0, w, h).data;
    const dataB = cnvB.getContext('2d').getImageData(0, 0, w, h).data;

    const diffCnv = document.createElement('canvas');
    diffCnv.width = w; diffCnv.height = h;
    const diffCtx = diffCnv.getContext('2d');
    const out = diffCtx.createImageData(w, h);

    let minX = w, minY = h, maxX = -1, maxY = -1, changed = 0;
    const TOL = 8;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const dr = Math.abs(dataA[i] - dataB[i]);
            const dg = Math.abs(dataA[i+1] - dataB[i+1]);
            const dbl = Math.abs(dataA[i+2] - dataB[i+2]);
            const da = Math.abs(dataA[i+3] - dataB[i+3]);
            if (dr + dg + dbl + da > TOL) {
                out.data[i] = 255;
                out.data[i+1] = 51;
                out.data[i+2] = 68;
                out.data[i+3] = 220;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                changed++;
            } else {
                out.data[i] = dataB[i];
                out.data[i+1] = dataB[i+1];
                out.data[i+2] = dataB[i+2];
                out.data[i+3] = Math.round(dataB[i+3] * 0.18);
            }
        }
    }
    diffCtx.putImageData(out, 0, 0);

    if (maxX >= 0) {
        diffCtx.strokeStyle = '#66E64D';
        diffCtx.lineWidth = Math.max(1, Math.round(Math.min(w, h) / 200));
        diffCtx.strokeRect(minX - 0.5, minY - 0.5, maxX - minX + 1, maxY - minY + 1);
    }

    return {
        dataUrl: diffCnv.toDataURL('image/png'),
        changed,
        total: w * h,
        box: { minX, minY, maxX, maxY },
        imgW: w,
        imgH: h,
    };
}

function drawToCanvas(img, w, h) {
    const cnv = document.createElement('canvas');
    cnv.width = w; cnv.height = h;
    const ctx = cnv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // For SVGs, scale up to canvas; for PNGs, draw at natural size pinned top-left.
    ctx.drawImage(img, 0, 0, img.naturalWidth || w, img.naturalHeight || h, 0, 0, w, h);
    return cnv;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('failed to load image'));
        img.src = src;
    });
}

// === Synchronized zoom lens ===
// Hovering any image in a card shows a magnifier on every image in that card,
// at the corresponding pixel coordinate (image-natural-coords aligned).

const LENS_SIZE = 180;
// PNGs: zoom by 6× to make pixel grid visible.
// SVGs: re-rasterize at this width for crisp vector zoom.
const PNG_ZOOM = 6;
const SVG_RENDER_WIDTH = 2000;

cards.forEach(card => {
    const wraps = card.querySelectorAll('.pane:not(.pane-diff) .img-wrap');
    wraps.forEach(wrap => {
        const lens = wrap.querySelector('.zoom-lens');
        const img = wrap.querySelector('img');
        const isSvg = img.src.startsWith('data:image/svg+xml');
        if (!isSvg) lens.classList.add('pixelated');
        lens.style.backgroundImage = "url('" + img.src + "')";

        wrap.addEventListener('mousemove', e => {
            if (!document.body.classList.contains('show-zoom')) return;
            const rect = wrap.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const u = Math.max(0, Math.min(1, x / rect.width));
            const v = Math.max(0, Math.min(1, y / rect.height));
            updateLensesInCard(card, u, v);
        });
        wrap.addEventListener('mouseleave', () => {
            wraps.forEach(w => w.classList.remove('zoom-active'));
        });
    });
});

function updateLensesInCard(activeCard, u, v) {
    const wraps = activeCard.querySelectorAll('.pane:not(.pane-diff) .img-wrap');
    wraps.forEach(wrap => {
        const img = wrap.querySelector('img');
        const lens = wrap.querySelector('.zoom-lens');
        if (!img.naturalWidth) return;
        wrap.classList.add('zoom-active');

        const wRect = wrap.getBoundingClientRect();
        lens.style.left = (u * wRect.width - LENS_SIZE / 2) + 'px';
        lens.style.top = (v * wRect.height - LENS_SIZE / 2) + 'px';

        const aspect = img.naturalHeight / img.naturalWidth;
        const isSvg = img.src.startsWith('data:image/svg+xml');
        const bgW = isSvg ? SVG_RENDER_WIDTH : img.naturalWidth * PNG_ZOOM;
        const bgH = bgW * aspect;
        lens.style.backgroundSize = bgW + 'px ' + bgH + 'px';
        lens.style.backgroundPosition =
            (-(u * bgW) + LENS_SIZE / 2) + 'px ' +
            (-(v * bgH) + LENS_SIZE / 2) + 'px';
    });
}

// Kick off diff computation now that everything's defined
computeAllDiffs();
</script>
</body>
</html>`;
}

function renderCard(r: Result): string {
    const bytes = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
    const delta = r.afterSize - r.beforeSize;
    const deltaPct = r.beforeSize ? (delta / r.beforeSize * 100) : 0;
    const deltaStr = r.hasBefore
        ? `${delta >= 0 ? "+" : ""}${bytes(Math.abs(delta))} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%)`
        : "(no snapshot)";
    const deltaClass = Math.abs(deltaPct) > 20 ? "delta warn" : "delta";
    const wrap = (src: string, alt: string) =>
        `<div class="img-wrap"><img src="${src}" alt="${alt}"><div class="bbox-overlay"></div><div class="zoom-lens"></div></div>`;
    const beforePane = r.hasBefore
        ? `<div class="pane-frame">${wrap(r.beforeDataUri, "before")}</div>`
        : `<div class="pane-frame"><div class="missing">no snapshot found</div></div>`;
    return `<article class="card" data-name="${escapeAttr(r.name)}" data-before="${r.hasBefore ? r.beforeDataUri : ""}" data-after="${r.afterDataUri}">
    <div class="card-header">
        <span class="card-name">${escapeHtml(r.name)}.${r.ext}</span>
        <span class="card-meta">
            <span class="pixdiff"></span>
            <span>${r.hasBefore ? `${bytes(r.beforeSize)} → ${bytes(r.afterSize)}` : `${bytes(r.afterSize)}`}</span>
            <span class="${deltaClass}">${deltaStr}</span>
        </span>
    </div>
    <div class="card-body">
        <div class="pane">
            <h3>Before (snapshot)</h3>
            ${beforePane}
        </div>
        <div class="pane">
            <h3>After (current)</h3>
            <div class="pane-frame">${wrap(r.afterDataUri, "after")}</div>
        </div>
        <div class="pane pane-diff">
            <h3>Diff <span class="stat"></span></h3>
            <div class="pane-frame"><div class="missing">computing…</div></div>
        </div>
    </div>
</article>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/"/g, "&quot;");
}
