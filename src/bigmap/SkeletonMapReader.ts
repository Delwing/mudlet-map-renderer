import type {IMapReader} from "../reader/MapReader";
import {type IArea, pairLinkExits} from "../reader/Area";
import type {IPlane} from "../reader/Plane";
import type IExit from "../reader/Exit";
import type {ViewportDataSource} from "../reader/ViewportDataSource";
import type {HashLookupCapable} from "../reader/HashLookup";
import type {ViewportBounds} from "../types/Settings";
import type {MapSkeleton} from "./Skeleton";
import {SKELETON_DIRS} from "./Skeleton";
import type {PlaneIndex} from "./PlaneIndex";
import {buildPlaneIndex, countInBounds, forEachInBounds} from "./PlaneIndex";

const INFINITE_VIEWPORT: ViewportBounds = {
    minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity,
};

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

/**
 * {@link IMapReader} over a {@link MapSkeleton}: rooms are synthesised on
 * demand from compact typed-array columns instead of held as an object graph,
 * so maps far too large for the concrete `MapReader` stay renderable.
 *
 * It is also a {@link ViewportDataSource}: planes materialise only the rooms
 * inside the current viewport. The interactive backend detects this and pushes
 * padded camera bounds before every build (rebuild-on-pan); standalone use
 * (e.g. `SvgExporter`) works too — the default viewport is infinite, so
 * everything materialises unless {@link setViewport} narrows it.
 *
 * Construction takes ownership of the skeleton: coordinates are converted to
 * renderer space (y negated, matching `MapReader`) in place.
 */
export default class SkeletonMapReader implements IMapReader, ViewportDataSource, HashLookupCapable {
    readonly viewportAware = true as const;
    readonly hashLookupCapable = true as const;

    private readonly sk: MapSkeleton;
    private viewport: ViewportBounds = INFINITE_VIEWPORT;
    private version = 0;

    private readonly planeCache = new Map<string, PlaneIndex>();
    private readonly areaCache = new Map<number, SkeletonArea>();
    private readonly rgbCache = new Map<number, [number, number, number]>();
    private idIndex?: Map<number, number>;
    private idToHashIndex?: Map<number, string>;
    // Per-viewport materialisation cache so getRooms() and getLinkExits()
    // share one synthesized set within a single scene build.
    private readonly visibleCache = new Map<string, MapData.Room[]>();

    /** Fully-converted rooms with visual detail, keyed by id (override the skeleton synth). */
    private readonly detail = new Map<number, MapData.Room>();
    private readonly userDataMap = new Map<number, Record<string, string>>();

    constructor(skeleton: MapSkeleton) {
        this.sk = skeleton;
        // To renderer space, once: MapReader stores rooms as y = -room.y.
        const y = skeleton.y;
        for (let i = 0; i < skeleton.count; i++) y[i] = -y[i];
        for (const u of skeleton.userData ?? []) this.userDataMap.set(u.id, u.data);
        for (const r of skeleton.detailRooms ?? []) {
            r.y = -r.y;
            if (this.isGrid(r.area)) {
                // gridMode suppresses cardinal exit visuals; keep special exits / lines / symbol.
                r.exits = {} as Record<MapData.direction, number>;
                r.stubs = [];
            }
            this.detail.set(r.id, r);
        }
    }

    skeleton(): MapSkeleton {
        return this.sk;
    }

    // --- HashLookupCapable ---

    getRoomIdByHash(hash: string): number | undefined {
        return this.sk.hashToId?.[hash];
    }

    // --- ViewportDataSource ---

    setViewport(bounds: ViewportBounds): void {
        const v = this.viewport;
        if (bounds.minX === v.minX && bounds.maxX === v.maxX &&
            bounds.minY === v.minY && bounds.maxY === v.maxY) return;
        this.viewport = {...bounds};
        this.visibleCache.clear();
        this.version++;
    }

    getViewport(): ViewportBounds {
        return this.viewport;
    }

    getPlaneRoomCount(areaId: number, z: number): number {
        return this.planeIndex(areaId, z).indices.length;
    }

    estimateVisibleCount(areaId: number, z: number, bounds: ViewportBounds): number {
        return countInBounds(this.planeIndex(areaId, z), bounds);
    }

    forEachInBounds(
        areaId: number, z: number, bounds: ViewportBounds,
        fn: (x: number, y: number, envId: number) => void,
    ): void {
        const sk = this.sk;
        forEachInBounds(sk, this.planeIndex(areaId, z), bounds,
            i => fn(sk.x[i], sk.y[i], sk.env[i]));
    }

    // --- IMapReader ---

    getArea(areaId: number): IArea {
        let a = this.areaCache.get(areaId);
        if (!a) {
            a = new SkeletonArea(areaId, this);
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
        const d = this.detail.get(roomId);
        if (d) return d;
        if (!this.idIndex) {
            this.idIndex = new Map();
            for (let i = 0; i < this.sk.count; i++) this.idIndex.set(this.sk.id[i], i);
        }
        const i = this.idIndex.get(roomId);
        return i === undefined ? (undefined as unknown as MapData.Room) : this.makeRoom(i);
    }

    getColorValue(envId: number): string {
        const [r, g, b] = this.rgb(envId);
        return `rgb(${r},${g},${b})`;
    }

    getSymbolColor(envId: number, opacity?: number): string {
        const [r, g, b] = this.rgb(envId);
        const lum = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
        // Format matches MapReader.getSymbolColor exactly (incl. the space).
        const c = lum > 0.41 ? '25,25,25' : '225,255,255';
        const o = Math.min(Math.max(opacity ?? 1, 0), 1);
        return o !== 1 ? `rgba(${c}, ${o})` : `rgba(${c})`;
    }

    // --- internals shared with SkeletonArea / SkeletonPlane ---

    getReaderVersion(): number {
        return this.version;
    }

    labelsFor(areaId: number, z: number): MapData.Label[] {
        return (this.sk.labels ?? []).filter(l => l.areaId === areaId && l.Z === z);
    }

    isGrid(areaId: number): boolean {
        return !!this.sk.areaGridMode[areaId];
    }

    private rgb(envId: number): [number, number, number] {
        let v = this.rgbCache.get(envId);
        if (!v) {
            const c = this.sk.customEnvColors[envId];
            v = c ? [c.r, c.g, c.b] : hslToRgb(((envId * 2654435761) >>> 0) % 360, 0.5, 0.55);
            this.rgbCache.set(envId, v);
        }
        return v;
    }

    /** Reverse of `sk.hashToId` (hash -> id), built lazily and once, same pattern as `idIndex`. */
    private hashFor(id: number): string {
        if (!this.sk.hashToId) return '';
        if (!this.idToHashIndex) {
            this.idToHashIndex = new Map();
            for (const hash in this.sk.hashToId) this.idToHashIndex.set(this.sk.hashToId[hash], hash);
        }
        return this.idToHashIndex.get(id) ?? '';
    }

    private makeRoom(i: number): MapData.Room {
        const sk = this.sk;
        const d = this.detail.get(sk.id[i]);
        if (d) return d; // full detail (special exits, custom lines, symbol, …)
        // Exits are only meaningful for non-grid areas; grid areas draw rooms as
        // adjacency with no exit lines (and would otherwise emit millions).
        const exits: Record<string, number> = {};
        if (!this.isGrid(sk.area[i])) {
            const base = i * 12;
            for (let dir = 0; dir < 12; dir++) {
                const t = sk.exits[base + dir];
                if (t !== -1) exits[SKELETON_DIRS[dir]] = t;
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
            name: sk.names?.[i] ?? '',
            userData: this.userDataMap.get(sk.id[i]) ?? {},
            customLines: {},
            stubs: [],
            hash: this.hashFor(sk.id[i]),
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
            p = buildPlaneIndex(this.sk, areaId, z);
            this.planeCache.set(key, p);
        }
        return p;
    }

    /**
     * Every room of the plane inside the current viewport — exact, uncapped
     * (the backend's LOD budget bounds how many this can be in vector mode),
     * memoised until the viewport changes.
     */
    visibleRooms(areaId: number, z: number): MapData.Room[] {
        const key = `${areaId}:${z}`;
        let rooms = this.visibleCache.get(key);
        if (!rooms) {
            const collected: MapData.Room[] = [];
            forEachInBounds(this.sk, this.planeIndex(areaId, z), this.viewport,
                i => collected.push(this.makeRoom(i)));
            rooms = collected;
            this.visibleCache.set(key, rooms);
        }
        return rooms;
    }
}

class SkeletonArea implements IArea {
    private readonly planeCache = new Map<number, SkeletonPlane>();

    constructor(
        private readonly areaId: number,
        private readonly reader: SkeletonMapReader,
    ) {}

    getAreaName(): string {
        return this.reader.skeleton().areaNames[this.areaId] ?? `#${this.areaId}`;
    }
    getAreaId(): number {
        return this.areaId;
    }
    getVersion(): number {
        // Viewport-dependent content: the reader bumps its version on every
        // setViewport() with new bounds, which marks all cached-area state stale.
        return this.reader.getReaderVersion();
    }
    getPlane(zIndex: number): IPlane {
        let p = this.planeCache.get(zIndex);
        if (!p) {
            p = new SkeletonPlane(this.areaId, zIndex, this.reader);
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
        // Grid areas are adjacency grids — Mudlet draws no exit lines for them
        // (and a dense grid would emit millions).
        if (this.reader.isGrid(this.areaId)) return [];
        const rooms = this.reader.visibleRooms(this.areaId, zIndex);
        if (rooms.length === 0) return [];
        // Pair exits directly over the visible rooms (no throwaway Area/Plane —
        // that also grouped-by-z and computed bounds we never use, pure waste
        // since visibleRooms is already single-z). Exits to off-screen/other-area
        // rooms become one-way and still draw — the pipeline resolves the far
        // endpoint through reader.getRoom().
        return Array.from(pairLinkExits(rooms).values())
            .filter(e => e.zIndex.includes(zIndex));
    }
}

class SkeletonPlane implements IPlane {
    constructor(
        private readonly areaId: number,
        private readonly z: number,
        private readonly reader: SkeletonMapReader,
    ) {}

    getRooms(): MapData.Room[] {
        return this.reader.visibleRooms(this.areaId, this.z);
    }
    getLabels(): MapData.Label[] {
        return this.reader.labelsFor(this.areaId, this.z);
    }
    getBounds(): {minX: number; maxX: number; minY: number; maxY: number} {
        // Full plane bounds (NOT the viewport) so fitArea frames the whole map.
        // Labels extend the bounds exactly like the concrete Plane's do.
        const b = {...this.reader.planeIndex(this.areaId, this.z).bounds};
        for (const label of this.reader.labelsFor(this.areaId, this.z)) {
            const lx = label.X;
            const ly = -label.Y;
            b.minX = Math.min(b.minX, lx);
            b.maxX = Math.max(b.maxX, lx + label.Width);
            b.minY = Math.min(b.minY, ly);
            b.maxY = Math.max(b.maxY, ly + label.Height);
        }
        return b;
    }
}
