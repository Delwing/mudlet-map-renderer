import type {IMapReader} from "@src/reader/MapReader";
import Area, {type IArea} from "@src/reader/Area";
import type {IPlane} from "@src/reader/Plane";
import type IExit from "@src/reader/Exit";

// Cardinal exit slots per room, in the order the worker packed them.
const DIRS: MapData.direction[] = [
    "north", "northeast", "east", "southeast", "south", "southwest",
    "west", "northwest", "up", "down", "in", "out",
];

/**
 * Compact, fully-resident skeleton of an entire map: one slot per room across
 * parallel typed arrays. This is what lets a 2.3M-room map stay in memory —
 * positions/env/area/id only, no per-room object graph. Heavy per-room visual
 * data (custom lines, symbols, user data) is intentionally omitted for this
 * first virtualized cut.
 *
 * Coordinates are already in renderer space: `y` is pre-negated at ingest to
 * match what {@link MapReader} produces (`y: -room.y`), so viewport bounds and
 * room coordinates share one space.
 */
export interface Skeleton {
    count: number;
    x: Int32Array;
    y: Int32Array;
    z: Int32Array;
    area: Int32Array;
    env: Int32Array;
    id: Int32Array;
    /** 12 cardinal exit targets per room (row-major: room i → exits[i*12 + d]); -1 = none. */
    exits: Int32Array;
    areaNames: Record<number, string>;
    /** Areas drawn as adjacency grids — exit lines are suppressed for these. */
    areaGridMode: Record<number, boolean>;
    customEnvColors: Record<number, {r: number; g: number; b: number}>;
}

export interface Viewport {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/** A (area, z) plane's room indices bucketed into a uniform grid (counting sort). */
export interface PlaneIndex {
    indices: Int32Array;
    minX: number;
    minY: number;
    cs: number;
    cols: number;
    rows: number;
    cellStart: Int32Array;
    order: Int32Array;
    bounds: {minX: number; maxX: number; minY: number; maxY: number};
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export class StreamingMapReader implements IMapReader {
    private readonly planeCache = new Map<string, PlaneIndex>();
    private readonly areaCache = new Map<number, StreamingArea>();
    private readonly rgbCache = new Map<number, [number, number, number]>();
    private idIndex?: Map<number, number>;
    private readonly packedCache = new Map<number, number>();
    // Per-build cache so getRooms() (Konva) and getLinkExits() (exit pairing)
    // share one synthesized set within a single scene build (same viewport ref).
    private cachedVp?: Viewport;
    private cachedRooms: MapData.Room[] = [];
    /** Set by getRooms() each build so the demo HUD can report it. */
    lastVisibleCount = 0;
    /**
     * When true the Konva plane reports zero rooms — the demo is drawing this
     * viewport via the raster overview instead (it can fill all rooms as pixels,
     * which Konva nodes can't). Toggled by the demo per zoom level.
     */
    rasterMode = false;

    /** Fully-converted rooms with visual detail, keyed by id (overrides the skeleton synth). */
    private readonly heavy = new Map<number, MapData.Room>();
    /** userData for every room that has any (sparse), keyed by id. */
    private readonly userDataMap = new Map<number, Record<string, string>>();
    /** Per-room name in stream order (parallel to the skeleton). */
    private readonly names: string[];

    constructor(
        private readonly sk: Skeleton,
        /** Live viewport (renderer space). The demo updates this before each refresh. */
        private readonly viewportRef: () => Viewport,
        heavyRooms: MapData.Room[] = [],
        private readonly labels: MapData.Label[] = [],
        names: string[] = [],
        userData: {id: number; data: Record<string, string>}[] = [],
    ) {
        this.names = names;
        for (const u of userData) this.userDataMap.set(u.id, u.data);
        for (const r of heavyRooms) {
            r.y = -r.y; // to renderer space, matching the skeleton (and MapReader's y: -room.y)
            if (this.isGrid(r.area)) {
                // gridMode suppresses cardinal exit visuals; keep special exits / lines / symbol.
                r.exits = {} as Record<MapData.direction, number>;
                r.stubs = [];
            }
            this.heavy.set(r.id, r);
        }
    }

    skeleton(): Skeleton {
        return this.sk;
    }

    // --- IMapReader ---

    getArea(areaId: number): IArea {
        let a = this.areaCache.get(areaId);
        if (!a) {
            a = new StreamingArea(areaId, this, this.viewportRef);
            this.areaCache.set(areaId, a);
        }
        return a;
    }

    getAreas(): IArea[] {
        return [...new Set(Array.from(this.sk.area))].map(id => this.getArea(id));
    }

    getRooms(): MapData.Room[] {
        // Never materialise all rooms — nothing in the hot path needs it.
        return [];
    }

    getRoom(roomId: number): MapData.Room {
        const h = this.heavy.get(roomId);
        if (h) return h;
        if (!this.idIndex) {
            this.idIndex = new Map();
            for (let i = 0; i < this.sk.count; i++) this.idIndex.set(this.sk.id[i], i);
        }
        const i = this.idIndex.get(roomId);
        return i === undefined ? (undefined as unknown as MapData.Room) : this.makeRoom(i);
    }

    /** Labels on a given area + z (used by the viewport plane). */
    labelsFor(areaId: number, z: number): MapData.Label[] {
        return this.labels.filter(l => l.areaId === areaId && l.Z === z);
    }

    getColorValue(envId: number): string {
        const [r, g, b] = this.rgb(envId);
        return `rgb(${r},${g},${b})`;
    }

    getSymbolColor(envId: number, opacity?: number): string {
        const [r, g, b] = this.rgb(envId);
        const lum = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
        const c = lum > 0.41 ? '25,25,25' : '225,255,255';
        const o = Math.min(Math.max(opacity ?? 1, 0), 1);
        return o !== 1 ? `rgba(${c},${o})` : `rgba(${c})`;
    }

    // --- internals shared with StreamingArea / StreamingPlane ---

    rgb(envId: number): [number, number, number] {
        let v = this.rgbCache.get(envId);
        if (!v) {
            const c = this.sk.customEnvColors[envId];
            v = c ? [c.r, c.g, c.b] : hslToRgb(((envId * 2654435761) >>> 0) % 360, 0.5, 0.55);
            this.rgbCache.set(envId, v);
        }
        return v;
    }

    /** Env colour packed as little-endian RGBA uint32 for direct ImageData writes. */
    packed(envId: number): number {
        let v = this.packedCache.get(envId);
        if (v === undefined) {
            const [r, g, b] = this.rgb(envId);
            v = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
            this.packedCache.set(envId, v);
        }
        return v;
    }

    /** Total rooms whose cells intersect the viewport (a cheap upper bound). */
    countInViewport(p: PlaneIndex, vp: Viewport): number {
        const r = this.cellRange(p, vp);
        if (!r) return 0;
        let total = 0;
        for (let cy = r.cy0; cy <= r.cy1; cy++) {
            const base = cy * p.cols;
            for (let cx = r.cx0; cx <= r.cx1; cx++) {
                const c = base + cx;
                total += p.cellStart[c + 1] - p.cellStart[c];
            }
        }
        return total;
    }

    /** Visit every room index actually inside `vp` — no cap (used by the raster path). */
    forEachVisible(p: PlaneIndex, vp: Viewport, fn: (i: number) => void): void {
        const r = this.cellRange(p, vp);
        if (!r) return;
        const {cols, cellStart, order} = p;
        for (let cy = r.cy0; cy <= r.cy1; cy++) {
            const base = cy * cols;
            for (let cx = r.cx0; cx <= r.cx1; cx++) {
                const c = base + cx;
                for (let q = cellStart[c]; q < cellStart[c + 1]; q++) {
                    const i = order[q];
                    if (this.sk.x[i] >= vp.minX && this.sk.x[i] <= vp.maxX &&
                        this.sk.y[i] >= vp.minY && this.sk.y[i] <= vp.maxY) fn(i);
                }
            }
        }
    }

    private cellRange(p: PlaneIndex, vp: Viewport):
        {cx0: number; cx1: number; cy0: number; cy1: number} | null {
        const cx0 = Math.max(0, Math.floor((vp.minX - p.minX) / p.cs));
        const cx1 = Math.min(p.cols - 1, Math.floor((vp.maxX - p.minX) / p.cs));
        const cy0 = Math.max(0, Math.floor((vp.minY - p.minY) / p.cs));
        const cy1 = Math.min(p.rows - 1, Math.floor((vp.maxY - p.minY) / p.cs));
        return cx1 < cx0 || cy1 < cy0 ? null : {cx0, cx1, cy0, cy1};
    }

    isGrid(areaId: number): boolean {
        return !!this.sk.areaGridMode[areaId];
    }

    makeRoom(i: number): MapData.Room {
        const sk = this.sk;
        const h = this.heavy.get(sk.id[i]);
        if (h) return h; // full detail (special exits, custom lines, symbol, …)
        // Exits are only meaningful for non-grid areas; grid areas draw rooms as
        // adjacency with no exit lines (and would otherwise emit millions).
        const exits: Record<string, number> = {};
        if (!this.isGrid(sk.area[i])) {
            const base = i * 12;
            for (let d = 0; d < 12; d++) {
                const t = sk.exits[base + d];
                if (t !== -1) exits[DIRS[d]] = t;
            }
        }
        return {
            id: sk.id[i],
            area: sk.area[i],
            x: sk.x[i],
            y: sk.y[i],
            z: sk.z[i],
            areaId: String(sk.area[i]),
            weight: 1,
            roomChar: '',
            name: this.names[i] ?? '',
            userData: this.userDataMap.get(sk.id[i]) ?? {},
            customLines: {},
            stubs: [],
            hash: '',
            env: sk.env[i],
            exits: exits as Record<MapData.direction, number>,
            doors: {},
            specialExits: {},
        };
    }

    planeIndex(areaId: number, z: number): PlaneIndex {
        const key = `${areaId}:${z}`;
        let p = this.planeCache.get(key);
        if (!p) {
            p = this.buildPlaneIndex(areaId, z);
            this.planeCache.set(key, p);
        }
        return p;
    }

    /**
     * Every room actually inside the viewport — no subsampling. The demo only
     * calls this in Konva mode, which the scale-based threshold already bounds
     * to a safe node count; anything denser renders via the raster overview
     * instead. (An earlier cap-based LOD here caused black gaps because its
     * cell-candidate count was inflated by padding + edge cells and tripped even
     * when the real in-view count was fine.)
     */
    visibleRooms(p: PlaneIndex, vp: Viewport): MapData.Room[] {
        const r = this.cellRange(p, vp);
        if (!r) {
            this.lastVisibleCount = 0;
            return [];
        }
        const {cols, cellStart, order} = p;
        const rooms: MapData.Room[] = [];
        for (let cy = r.cy0; cy <= r.cy1; cy++) {
            const base = cy * cols;
            for (let cx = r.cx0; cx <= r.cx1; cx++) {
                const c = base + cx;
                for (let q = cellStart[c]; q < cellStart[c + 1]; q++) {
                    const i = order[q];
                    if (this.sk.x[i] >= vp.minX && this.sk.x[i] <= vp.maxX &&
                        this.sk.y[i] >= vp.minY && this.sk.y[i] <= vp.maxY) {
                        rooms.push(this.makeRoom(i));
                    }
                }
            }
        }
        this.lastVisibleCount = rooms.length;
        return rooms;
    }

    /** {@link visibleRooms} memoised on the viewport reference for one build. */
    visibleRoomsCached(p: PlaneIndex, vp: Viewport): MapData.Room[] {
        if (vp === this.cachedVp) return this.cachedRooms;
        this.cachedRooms = this.visibleRooms(p, vp);
        this.cachedVp = vp;
        return this.cachedRooms;
    }

    private buildPlaneIndex(areaId: number, z: number): PlaneIndex {
        const sk = this.sk;
        const tmp: number[] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < sk.count; i++) {
            if (sk.area[i] !== areaId || sk.z[i] !== z) continue;
            tmp.push(i);
            const x = sk.x[i], y = sk.y[i];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const indices = Int32Array.from(tmp);
        if (indices.length === 0) {
            return {indices, minX: 0, minY: 0, cs: 1, cols: 1, rows: 1,
                cellStart: new Int32Array(2), order: indices,
                bounds: {minX: 0, maxX: 0, minY: 0, maxY: 0}};
        }

        const extent = Math.max(maxX - minX, maxY - minY, 1);
        const cs = Math.max(1, Math.ceil(extent / 128));
        const cols = Math.floor((maxX - minX) / cs) + 1;
        const rows = Math.floor((maxY - minY) / cs) + 1;
        const cellOf = (i: number) =>
            Math.floor((sk.y[i] - minY) / cs) * cols + Math.floor((sk.x[i] - minX) / cs);

        const counts = new Int32Array(cols * rows);
        for (let k = 0; k < indices.length; k++) counts[cellOf(indices[k])]++;
        const cellStart = new Int32Array(cols * rows + 1);
        for (let c = 0; c < cols * rows; c++) cellStart[c + 1] = cellStart[c] + counts[c];
        const cursor = cellStart.slice(0, cols * rows);
        const order = new Int32Array(indices.length);
        for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            const c = cellOf(i);
            order[cursor[c]++] = i;
        }

        return {indices, minX, minY, cs, cols, rows, cellStart, order, bounds: {minX, maxX, minY, maxY}};
    }
}

class StreamingArea implements IArea {
    private readonly planeCache = new Map<number, StreamingPlane>();
    private version = 0;

    constructor(
        private readonly areaId: number,
        private readonly reader: StreamingMapReader,
        private readonly viewportRef: () => Viewport,
    ) {}

    getAreaName(): string {
        return this.reader.skeleton().areaNames[this.areaId] ?? `#${this.areaId}`;
    }
    getAreaId(): number {
        return this.areaId;
    }
    getVersion(): number {
        return this.version;
    }
    getPlane(zIndex: number): IPlane {
        let p = this.planeCache.get(zIndex);
        if (!p) {
            p = new StreamingPlane(this.areaId, zIndex, this.reader, this.viewportRef);
            this.planeCache.set(zIndex, p);
        }
        return p;
    }
    getPlanes(): IPlane[] {
        return this.getZLevels().map(z => this.getPlane(z));
    }
    getZLevels(): number[] {
        const sk = this.reader.skeleton();
        const zs = new Set<number>();
        for (let i = 0; i < sk.count; i++) if (sk.area[i] === this.areaId) zs.add(sk.z[i]);
        return [...zs].sort((a, b) => a - b);
    }
    getRooms(): MapData.Room[] {
        return [];
    }
    getFullBounds(): {minX: number; maxX: number; minY: number; maxY: number} {
        const zs = this.getZLevels();
        let b = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity};
        for (const z of zs) {
            const pb = this.reader.planeIndex(this.areaId, z).bounds;
            b = {
                minX: Math.min(b.minX, pb.minX), maxX: Math.max(b.maxX, pb.maxX),
                minY: Math.min(b.minY, pb.minY), maxY: Math.max(b.maxY, pb.maxY),
            };
        }
        return b;
    }
    getLinkExits(zIndex: number): IExit[] {
        // No exit lines in raster mode (Konva draws nothing) or for grid areas.
        if (this.reader.rasterMode || this.reader.isGrid(this.areaId)) return [];
        const p = this.reader.planeIndex(this.areaId, zIndex);
        const rooms = this.reader.visibleRoomsCached(p, this.viewportRef());
        if (rooms.length === 0) return [];
        // Reuse the renderer's own half-exit pairing over just the visible rooms.
        // Exits to off-screen/other-area rooms become one-way and still draw —
        // the pipeline resolves the far endpoint through reader.getRoom().
        const tmp = new Area({
            areaId: String(this.areaId),
            areaName: this.getAreaName(),
            rooms,
            labels: [],
        });
        return tmp.getLinkExits(zIndex);
    }
}

class StreamingPlane implements IPlane {
    constructor(
        private readonly areaId: number,
        private readonly z: number,
        private readonly reader: StreamingMapReader,
        private readonly viewportRef: () => Viewport,
    ) {}

    getRooms(): MapData.Room[] {
        // In raster mode the demo paints this viewport itself; Konva draws nothing.
        if (this.reader.rasterMode) {
            this.reader.lastVisibleCount = 0;
            return [];
        }
        const p = this.reader.planeIndex(this.areaId, this.z);
        return this.reader.visibleRoomsCached(p, this.viewportRef());
    }
    getLabels(): MapData.Label[] {
        if (this.reader.rasterMode) return [];
        return this.reader.labelsFor(this.areaId, this.z);
    }
    getBounds(): {minX: number; maxX: number; minY: number; maxY: number} {
        // Full plane bounds (NOT the viewport) so fitArea frames the whole map.
        return this.reader.planeIndex(this.areaId, this.z).bounds;
    }
}
