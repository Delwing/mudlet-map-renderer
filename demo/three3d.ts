/**
 * Standalone WebGL 3D view of a Mudlet map area.
 *
 * Each room becomes an extruded box; exits become line segments between room
 * centres. Because rooms carry a real z-level, `up`/`down` exits render as
 * genuine vertical connectors between stacked floors — the thing the faux-iso
 * Style can't do. Pure three.js; shares the demo's map data + colour tables.
 */
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import MapReader from "@src/reader/MapReader";
import type IExit from "@src/reader/Exit";
import {regularExits, longToShort} from "@src/reader/Exit";
import {movePoint} from "@src/directions";

const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

const ROOM_FOOTPRINT = 0.6; // matches the renderer's default roomSize

// --- DOM ---------------------------------------------------------------
const stage = document.getElementById("stage") as HTMLDivElement;
const areaSelect = document.getElementById("area-select") as HTMLSelectElement;
const gapSlider = document.getElementById("gap") as HTMLInputElement;
const gapVal = document.getElementById("gap-val") as HTMLSpanElement;
const heightSlider = document.getElementById("height") as HTMLInputElement;
const heightVal = document.getElementById("height-val") as HTMLSpanElement;
const singleFloorToggle = document.getElementById("single-floor") as HTMLInputElement;
const floorSelect = document.getElementById("floor-select") as HTMLSelectElement;
const outlineToggle = document.getElementById("outline") as HTMLInputElement;
const spinToggle = document.getElementById("spin") as HTMLInputElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const roomInfoEl = document.getElementById("room-info") as HTMLDivElement;

// --- three.js scaffolding ---------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 0.8;

// Lighting — directional key + soft ambient so the box faces actually shade.
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1, 2, 1.5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x88bbff, 0.35);
rim.position.set(-1.5, 0.5, -1);
scene.add(rim);

// Group that holds everything for the current area (cleared on rebuild).
let areaGroup: THREE.Group | null = null;
// Area the camera was last framed to; framing only re-runs when this changes.
let framedAreaId: number | null = null;

// --- room selection / picking -----------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pickMesh: THREE.InstancedMesh | null = null; // current area's room boxes
let pickRooms: MapData.Room[] = [];              // instanceId → room
let placeRoom: ((r: MapData.Room) => THREE.Vector3) | null = null; // → box centre
let boxDims = {w: ROOM_FOOTPRINT, h: 0.4};
let selectionOutline: THREE.LineSegments | null = null;
let selectedRoomId: number | null = null;

function selectRoom(id: number | null) {
    if (selectionOutline) {
        scene.remove(selectionOutline);
        selectionOutline.geometry.dispose();
        (selectionOutline.material as THREE.Material).dispose();
        selectionOutline = null;
    }
    selectedRoomId = id;
    const room = id != null ? pickRooms.find(r => r.id === id) : undefined;
    if (!room || !placeRoom) {
        selectedRoomId = null;
        roomInfoEl.hidden = true;
        return;
    }
    // Bright outline box around the picked room.
    const m = 0.12;
    const box = new THREE.BoxGeometry(boxDims.w + m, boxDims.h + m, boxDims.w + m);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    selectionOutline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color: 0x00e5ff}));
    selectionOutline.position.copy(placeRoom(room));
    scene.add(selectionOutline);
    showRoomInfo(room);
}

function showRoomInfo(room: MapData.Room) {
    const swatch = mapReader.getColorValue(room.env);
    const exits = Object.entries(room.exits ?? {});
    const special = Object.keys(room.specialExits ?? {}).length;
    const stubs = (room.stubs ?? []).length;
    const exitList = exits.map(([dir, id]) => `${dir}→${id}`).join(", ") || "none";
    roomInfoEl.innerHTML =
        `<div><span class="ri-id">Room #${room.id}</span></div>` +
        (room.name ? `<div class="ri-row">${escapeHtml(room.name)}</div>` : "") +
        `<div class="ri-row"><span class="ri-key">level</span> z=${room.z}` +
        `<span class="ri-key" style="margin-left:8px">env</span> ${room.env}` +
        `<span class="swatch" style="background:${swatch}"></span></div>` +
        `<div class="ri-exits"><span class="ri-key">exits:</span> ${exitList}` +
        (special ? ` · +${special} special` : "") +
        (stubs ? ` · ${stubs} stub${stubs > 1 ? "s" : ""}` : "") +
        `</div>`;
    roomInfoEl.hidden = false;
}

function escapeHtml(s: string) {
    return s.replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]!));
}

// Re-apply the current selection after a rebuild (reposition, or drop if gone).
function refreshSelection() {
    if (selectedRoomId != null && pickRooms.some(r => r.id === selectedRoomId)) {
        selectRoom(selectedRoomId);
    } else {
        selectRoom(null);
    }
}

// Pointer: treat a near-stationary left click as a pick (drags orbit the camera).
let downX = 0, downY = 0, downBtn = 0;
renderer.domElement.addEventListener("pointerdown", e => {
    downX = e.clientX; downY = e.clientY; downBtn = e.button;
});
renderer.domElement.addEventListener("pointerup", e => {
    if (downBtn !== 0 || e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // it was a drag
    if (!pickMesh) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(pickMesh)[0];
    selectRoom(hit && hit.instanceId != null ? pickRooms[hit.instanceId].id : null);
});

// --- helpers -----------------------------------------------------------
const VERTICAL_DIRS = new Set(["up", "down", "in", "out"]);
const REGULAR_DIRS = new Set<string>(regularExits);
// Mudlet stub direction indices (see StubStyle.ts).
const DIR_NUMBERS: Record<number, MapData.direction> = {
    1: "north", 2: "northeast", 3: "northwest", 4: "east", 5: "west",
    6: "south", 7: "southeast", 8: "southwest", 9: "up", 10: "down",
    11: "in", 12: "out",
};
const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();

/** True if the room draws this direction as a custom-line polyline (short or long key). */
function hasCustomLine(room: MapData.Room, dir: MapData.direction): boolean {
    const lines = room.customLines;
    if (!lines) return false;
    return lines[dir] !== undefined || lines[longToShort[dir]] !== undefined;
}

/** Push two barb segments forming an arrowhead at `to`, pointing along from→to. */
function pushArrow(bucket: number[], from: THREE.Vector3, to: THREE.Vector3, size = 0.22) {
    const d = to.clone().sub(from);
    const len = d.length();
    if (len < 1e-6) return;
    d.divideScalar(len);
    const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(d, ref).normalize();
    const back = d.clone().negate();
    const b1 = to.clone().add(back.clone().add(perp).normalize().multiplyScalar(size));
    const b2 = to.clone().add(back.clone().sub(perp).normalize().multiplyScalar(size));
    bucket.push(to.x, to.y, to.z, b1.x, b1.y, b1.z, to.x, to.y, to.z, b2.x, b2.y, b2.z);
}

/** Mudlet custom-line dash style → three.js [dashSize, gapSize], or null for solid. */
function dashForStyle(style: string): [number, number] | null {
    switch (style) {
        case "dot line": return [0.05, 0.05];
        case "dash line": return [0.4, 0.2];
        case "dash dot line":
        case "dash dot dot line": return [0.4, 0.15];
        default: return null;
    }
}

function disposeGroup(g: THREE.Group) {
    g.traverse(obj => {
        const mesh = obj as THREE.Mesh & THREE.LineSegments;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
    });
}

interface BuildOptions {
    gap: number;
    roomHeight: number;
    floorFilter: number | null; // raw z-level to isolate, or null for all
    outline: boolean;           // draw box edges around each room
}

function buildArea(mapReader: MapReader, areaId: number, opts: BuildOptions) {
    if (areaGroup) {
        scene.remove(areaGroup);
        disposeGroup(areaGroup);
        areaGroup = null;
    }

    const area = mapReader.getArea(areaId);
    if (!area) return;

    const zLevels = area.getZLevels();
    // Even floor spacing regardless of the raw z values: rank z-levels 0..n.
    const zRank = new Map<number, number>();
    zLevels.forEach((z, i) => zRank.set(z, i));

    const rooms = area.getRooms().filter(r => opts.floorFilter === null || r.z === opts.floorFilter);

    // Centre the model on the origin so orbit feels natural.
    const bounds = area.getFullBounds();
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);

    // World position for a room: X=x, Z=y (already negated by reader), Y=floor.
    const pos = (r: {x: number; y: number; z: number}) =>
        new THREE.Vector3(r.x - cx, (zRank.get(r.z) ?? 0) * opts.gap, r.y - cy);

    const group = new THREE.Group();

    // --- rooms as instanced boxes -------------------------------------
    const geo = new THREE.BoxGeometry(ROOM_FOOTPRINT, opts.roomHeight, ROOM_FOOTPRINT);
    const mat = new THREE.MeshLambertMaterial();
    const boxes = new THREE.InstancedMesh(geo, mat, rooms.length);
    rooms.forEach((room, i) => {
        const p = pos(room);
        tmpMatrix.makeTranslation(p.x, p.y + opts.roomHeight / 2, p.z);
        boxes.setMatrixAt(i, tmpMatrix);
        tmpColor.setStyle(mapReader.getColorValue(room.env));
        boxes.setColorAt(i, tmpColor);
    });
    boxes.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    group.add(boxes);

    // Register pick targets: instanceId i ↔ rooms[i].
    pickMesh = boxes;
    pickRooms = rooms;
    boxDims = {w: ROOM_FOOTPRINT, h: opts.roomHeight};
    placeRoom = (r: MapData.Room) => {
        const p = pos(r);
        return new THREE.Vector3(p.x, p.y + opts.roomHeight / 2, p.z);
    };

    // Optional room outlines: all box edges batched into one LineSegments.
    if (opts.outline) {
        const corners = [
            [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
            [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
        ];
        const edgeIdx = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        const hw = ROOM_FOOTPRINT / 2, hh = opts.roomHeight / 2;
        const edgePts: number[] = [];
        for (const room of rooms) {
            const p = pos(room);
            const ox = p.x, oy = p.y + hh, oz = p.z;
            for (const [a, b] of edgeIdx) {
                const ca = corners[a], cb = corners[b];
                edgePts.push(ox + ca[0] * hw, oy + ca[1] * hh, oz + ca[2] * hw);
                edgePts.push(ox + cb[0] * hw, oy + cb[1] * hh, oz + cb[2] * hw);
            }
        }
        const eg = new THREE.BufferGeometry();
        eg.setAttribute("position", new THREE.Float32BufferAttribute(edgePts, 3));
        group.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.6})));
    }

    // --- exits, following the same rules as the 2D renderer -----------
    // Centre of a room at link height; edge point along a planar direction.
    const half = ROOM_FOOTPRINT / 2;
    const linkY = (z: number) => (zRank.get(z) ?? 0) * opts.gap + opts.roomHeight / 2;
    const center = (r: MapData.Room) => new THREE.Vector3(r.x - cx, linkY(r.z), r.y - cy);
    const edge = (r: MapData.Room, dir: MapData.direction) => {
        const e = movePoint(r.x, r.y, dir, half);
        return new THREE.Vector3(e.x - cx, linkY(r.z), e.y - cy);
    };

    const roomById = new Map(rooms.map(r => [r.id, r]));

    // Geometry buckets (flat xyz triples, two verts per segment).
    const twoWayPts: number[] = [];   // regular bidirectional → plain line
    const oneWayPts: number[] = [];   // regular one-way → dashed line
    const oneWayArrows: number[] = []; // arrowheads for one-way
    const vertPts: number[] = [];     // up/down/in/out → vertical stair link (3D extra)
    const vertArrows: number[] = [];  // arrowheads for one-way verticals
    const stubPts: number[] = [];     // stubs → "no link" nubs

    // IExit records already merge A→B / B→A and encode one-way via missing aDir/bDir.
    // A vertical exit's record appears under both its z-levels, so dedupe by reference.
    const exitSet = new Set<IExit>();
    for (const z of zLevels) for (const e of area.getLinkExits(z)) exitSet.add(e);

    for (const e of exitSet) {
        const ra = roomById.get(e.a);
        const rb = roomById.get(e.b);
        if (!ra || !rb) continue; // endpoint filtered out (isolated floor) or cross-area

        // A custom line on either endpoint stands in for the straight link (matches 2D).
        if ((e.aDir && hasCustomLine(ra, e.aDir)) || (e.bDir && hasCustomLine(rb, e.bDir))) continue;

        const aReg = !!e.aDir && REGULAR_DIRS.has(e.aDir);
        const bReg = !!e.bDir && REGULAR_DIRS.has(e.bDir);
        const isVertical = (!!e.aDir && VERTICAL_DIRS.has(e.aDir)) || (!!e.bDir && VERTICAL_DIRS.has(e.bDir));
        const twoWay = !!e.aDir && !!e.bDir;

        if (isVertical) {
            // An up/down exit whose endpoints sit on the same z-level isn't a real
            // floor change — skip it rather than draw a flat "stair" connector.
            if (ra.z === rb.z) continue;
            const ca = center(ra), cb = center(rb);
            vertPts.push(ca.x, ca.y, ca.z, cb.x, cb.y, cb.z);
            if (!twoWay) {
                const from = e.aDir ? ca : cb;
                const to = e.aDir ? cb : ca;
                pushArrow(vertArrows, from, to);
            }
        } else if (aReg && bReg) {
            const va = edge(ra, e.aDir!), vb = edge(rb, e.bDir!);
            twoWayPts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        } else if (aReg || bReg) {
            const src = aReg ? ra : rb;
            const dst = aReg ? rb : ra;
            const from = edge(src, (aReg ? e.aDir : e.bDir)!);
            const to = center(dst);
            oneWayPts.push(from.x, from.y, from.z, to.x, to.y, to.z);
            pushArrow(oneWayArrows, from, to);
        }
        // neither regular nor vertical → special exit; drawn via custom lines below.
    }

    // Stubs — one-way indicators with no target room ("no link").
    for (const room of rooms) {
        for (const stub of room.stubs ?? []) {
            const dir = DIR_NUMBERS[stub];
            if (!dir) continue;
            if (VERTICAL_DIRS.has(dir)) {
                const base = center(room);
                const sign = dir === "up" || dir === "in" ? 1 : -1;
                stubPts.push(base.x, base.y, base.z, base.x, base.y + sign * 0.5, base.z);
            } else {
                const s = movePoint(room.x, room.y, dir, half);
                const t = movePoint(room.x, room.y, dir, half + 0.5);
                const y = linkY(room.z);
                stubPts.push(s.x - cx, y, s.y - cy, t.x - cx, y, t.y - cy);
            }
        }
    }

    // Custom lines (special exits) — polylines that follow their own points.
    for (const room of rooms) {
        for (const [, line] of Object.entries(room.customLines ?? {})) {
            const verts: number[] = [];
            const start = center(room);
            verts.push(start.x, start.y, start.z);
            let prev = start, tip = start;
            for (const pt of line.points) {
                // Custom-line points are absolute map coords with un-negated Y.
                const v = new THREE.Vector3(pt.x - cx, linkY(room.z), -pt.y - cy);
                verts.push(v.x, v.y, v.z);
                prev = tip;
                tip = v;
            }
            const c = line.attributes.color;
            const col = new THREE.Color(`rgb(${c.r}, ${c.g}, ${c.b})`);
            const dash = dashForStyle(line.attributes.style);
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
            const mat = dash
                ? new THREE.LineDashedMaterial({color: col, dashSize: dash[0], gapSize: dash[1]})
                : new THREE.LineBasicMaterial({color: col});
            const poly = new THREE.Line(g, mat);
            if (dash) poly.computeLineDistances();
            group.add(poly);

            if (line.attributes.arrow && line.points.length >= 1) {
                const ab: number[] = [];
                pushArrow(ab, prev, tip);
                const ag = new THREE.BufferGeometry();
                ag.setAttribute("position", new THREE.Float32BufferAttribute(ab, 3));
                group.add(new THREE.LineSegments(ag, new THREE.LineBasicMaterial({color: col})));
            }
        }
    }

    // Commit batched buckets.
    const addSegments = (pts: number[], mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
        if (!pts.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const seg = new THREE.LineSegments(g, mat);
        if ((mat as THREE.LineDashedMaterial).isLineDashedMaterial) seg.computeLineDistances();
        group.add(seg);
    };
    addSegments(twoWayPts, new THREE.LineBasicMaterial({color: 0x6b86b3, transparent: true, opacity: 0.55}));
    addSegments(oneWayPts, new THREE.LineDashedMaterial({color: 0xe2643c, dashSize: 0.12, gapSize: 0.08}));
    addSegments(oneWayArrows, new THREE.LineBasicMaterial({color: 0xff6a44}));
    addSegments(vertPts, new THREE.LineBasicMaterial({color: 0xffd166, transparent: true, opacity: 0.9}));
    addSegments(vertArrows, new THREE.LineBasicMaterial({color: 0xffd166}));
    addSegments(stubPts, new THREE.LineBasicMaterial({color: 0x8aa0bd, transparent: true, opacity: 0.7}));

    const exitCount = (twoWayPts.length + oneWayPts.length + vertPts.length) / 6;

    // Ground grid for spatial reference.
    const grid = new THREE.GridHelper(span * 1.4, 24, 0x1c2740, 0x141c2e);
    grid.position.y = -0.01;
    group.add(grid);

    scene.add(group);
    areaGroup = group;

    // Frame the camera only when the area changes (or on first build) — slider/floor
    // tweaks rebuild geometry but should leave the user's viewpoint untouched.
    if (framedAreaId !== areaId) {
        const radius = span * 0.75 + zLevels.length * opts.gap;
        camera.position.set(radius * 0.7, radius * 0.6, radius * 0.7);
        controls.target.set(0, (zLevels.length * opts.gap) / 2, 0);
        controls.update();
        framedAreaId = areaId;
    }

    statsEl.textContent =
        `${area.getAreaName()} · ${rooms.length} rooms · ${zLevels.length} floors · ${exitCount} exits`;

    // Populate floor isolation dropdown.
    floorSelect.innerHTML = "";
    zLevels.forEach(z => {
        const opt = document.createElement("option");
        opt.value = String(z);
        opt.textContent = `Floor z=${z}`;
        floorSelect.appendChild(opt);
    });

    refreshSelection();
}

// --- bootstrap ---------------------------------------------------------
let mapReader: MapReader;
let currentAreaId = 0;

function currentOpts(): BuildOptions {
    return {
        gap: parseFloat(gapSlider.value),
        roomHeight: parseFloat(heightSlider.value),
        floorFilter: singleFloorToggle.checked ? parseInt(floorSelect.value, 10) : null,
        outline: outlineToggle.checked,
    };
}

function rebuild() {
    if (mapReader) buildArea(mapReader, currentAreaId, currentOpts());
}

async function init() {
    const [mapData, colorData] = await Promise.all([
        fetch(mapDataUrl).then(r => r.json()),
        fetch(colorDataUrl).then(r => r.json()),
    ]);
    mapReader = new MapReader(mapData, colorData);

    // List areas, richest first (most rooms), so the default view is dense.
    const areas = mapReader.getAreas()
        .map(a => ({id: a.getAreaId(), name: a.getAreaName(), rooms: a.getRooms().length, floors: a.getZLevels().length}))
        .filter(a => a.rooms > 0)
        .sort((a, b) => b.floors - a.floors || b.rooms - a.rooms);

    areas.forEach(a => {
        const opt = document.createElement("option");
        opt.value = String(a.id);
        opt.textContent = `${a.name} (${a.rooms}r · ${a.floors}f)`;
        areaSelect.appendChild(opt);
    });

    currentAreaId = areas[0]?.id ?? 0;
    areaSelect.value = String(currentAreaId);
    rebuild();
}

// --- controls wiring ---------------------------------------------------
areaSelect.addEventListener("change", () => {
    currentAreaId = parseInt(areaSelect.value, 10);
    rebuild();
});
gapSlider.addEventListener("input", () => { gapVal.textContent = gapSlider.value; rebuild(); });
heightSlider.addEventListener("input", () => { heightVal.textContent = heightSlider.value; rebuild(); });
singleFloorToggle.addEventListener("change", () => {
    floorSelect.style.display = singleFloorToggle.checked ? "" : "none";
    rebuild();
});
floorSelect.addEventListener("change", rebuild);
outlineToggle.addEventListener("change", rebuild);
spinToggle.addEventListener("change", () => { controls.autoRotate = spinToggle.checked; });
controls.autoRotate = spinToggle.checked;

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

init();
