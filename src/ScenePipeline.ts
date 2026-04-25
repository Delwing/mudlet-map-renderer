import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type Plane from "./reader/Plane";
import type Exit from "./reader/Exit";
import type {Settings, ViewportBounds} from "./types/Settings";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData} from "./ExitRenderer";
import {computeStubs} from "./scene/StubStyle";
import {computeSpecialExits} from "./scene/SpecialExitStyle";
import {layoutRoom} from "./scene/elements/RoomLayout";
import {layoutInnerExits} from "./scene/elements/ExitLayout";
import {layoutLinkExit} from "./scene/elements/ExitLayout";
import {specialExitToShape} from "./scene/elements/SpecialExitLayout";
import {stubToShape} from "./scene/elements/StubLayout";
import {labelToShape} from "./scene/elements/LabelLayout";
import {layoutGrid} from "./scene/elements/GridLayout";
import type {GroupShape, Shape} from "./scene/Shape";
import {colorLightness} from "./utils/color";

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Reference to one room's body shape inside the scene. Keyed by roomId so
 * downstream consumers (cull index, hit-test bookkeeping) can find a room
 * shape by id without re-walking the scene tree.
 */
export type RoomShapeRef = { room: MapData.Room; shape: GroupShape };

/**
 * Reference to one drawn link-exit shape, paired with its world-space bounds
 * and (optional) cross-area target room. Used by the live renderer to hang
 * cull entries on each exit.
 */
export type StandaloneExitShapeRef = { shape: GroupShape; bounds: Bounds; targetRoomId?: number };
export type AreaExitHitZone = {
    bounds: Bounds;
    targetRoomId: number;
    /** Source room center — used to compute arrow direction for labels. Optional for back-compat. */
    from?: { x: number; y: number };
    /** Arrow tip / far endpoint — anchor for placed labels. Optional for back-compat. */
    tip?: { x: number; y: number };
    /** Stroke colour of the rendered arrow — used to colour area-exit labels. */
    arrowColor?: string;
};

/**
 * One drawn two-way or one-way inter-room exit, with stable identity and the
 * exact geometry ExitRenderer produced. Consumers (e.g. an editor's
 * hit-testing layer) can run segment distance checks against
 * `data.lines[].points` / `data.arrows[].points` to match exactly what the
 * user sees — including dash patterns and the renderer's suppression rules
 * (e.g. both-sides-customLine two-ways, one-ways overridden by customLine).
 */
export type DrawnExitEntry = {
    readonly a: number;
    readonly b: number;
    readonly aDir?: MapData.direction;
    readonly bDir?: MapData.direction;
    readonly kind: "exit" | "specialExit";
    readonly zIndex: number[];
    readonly data: ExitDrawData;
};

/**
 * One drawn custom-line (special exit) polyline, as it was rendered for
 * this scene. `points` is the flat [x,y,x,y,...] polyline with the source
 * room's centre prepended (mirroring what the renderer actually drew), in
 * render-space coordinates.
 */
export type DrawnSpecialExitEntry = {
    readonly roomId: number;
    readonly exitName: string;
    readonly points: number[];
    readonly stroke: string;
    readonly strokeWidth: number;
    readonly dash?: number[];
    readonly hasArrow: boolean;
    readonly arrowTip?: { x: number; y: number };
    readonly bounds: Bounds;
};

/**
 * One drawn stub — a room's one-way exit indicator (the short line sticking
 * out of the edge for every entry in `room.stubs`). Rendered directly from
 * these coordinates by {@link ScenePipeline}, so hit-testing against them
 * matches what's on screen. Non-planar stubs (up/down/in/out) are still
 * recorded — x1==x2 and y1==y2 — so consumers can filter them out.
 */
export type DrawnStubEntry = {
    readonly roomId: number;
    readonly direction: MapData.direction;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly stroke: string;
    readonly strokeWidth: number;
};

/**
 * World-space shapes for each logical layer. Same content the backend layer
 * nodes received, but as plain SceneIR data — consumed by exporters that drive
 * {@link buildDrawCommands} → engine renderers without going through a
 * {@link DrawingBackend}.
 *
 * Order within each list mirrors the order in which the corresponding layer
 * node received its `addNode` calls: e.g. `link` is labels → link exits → for
 * each room (special exits, stubs); `room` is rooms → area name → area-exit
 * labels.
 */
export type SceneShapesByLayer = {
    grid: Shape[];
    link: Shape[];
    room: Shape[];
    topLabel: Shape[];
};

export type SceneBuildResult = {
    /** Room body shapes keyed by roomId — for cull-entry construction. */
    roomShapeRefs: Map<number, RoomShapeRef>;
    /** Link-exit shapes paired with bounds and area-target metadata. */
    standaloneExitShapeRefs: StandaloneExitShapeRef[];
    areaExitHitZones: AreaExitHitZone[];
    drawnExits: DrawnExitEntry[];
    drawnSpecialExits: DrawnSpecialExitEntry[];
    drawnStubs: DrawnStubEntry[];
    /** World-space shapes carrying {@link HitInfo} annotations — fed to {@link HitTester}. */
    hitShapes: Shape[];
    /**
     * Engine-agnostic shape lists per logical layer. Drives
     * {@link buildDrawCommands} + a per-engine renderer.
     */
    sceneShapes: SceneShapesByLayer;
};

/** Convert a `rgb(...)`, `rgba(...)`, or `#rrggbb` string to `rgba(r,g,b,alpha)`. */
function colorWithAlpha(color: string, alpha: number): string {
    const rgb = parseRgb(color);
    if (!rgb) return color;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** Parse a `rgb(...)`, `rgba(...)`, or `#rrggbb` string into `{r, g, b}` (0–255). */
function parseRgb(color: string): { r: number; g: number; b: number } | undefined {
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
    }
    if (color.startsWith('#') && color.length >= 7) {
        return {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16),
        };
    }
    return undefined;
}

/** Flatten `fg` at `alpha` over `bg` into an opaque `rgb(...)` string. */
function blendOverBackground(fg: string, bg: string, alpha: number): string {
    const f = parseRgb(fg);
    const b = parseRgb(bg);
    if (!f || !b) return fg;
    const r = Math.round(f.r * alpha + b.r * (1 - alpha));
    const g = Math.round(f.g * alpha + b.g * (1 - alpha));
    const bl = Math.round(f.b * alpha + b.b * (1 - alpha));
    return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Greedy single-link clustering: each point joins the first existing cluster
 * with at least one member within `radius` (via the `tip` field), else starts
 * a new cluster. O(n²) but n is small (dozens of area exits per map).
 */
function clusterByProximity<T extends { tip: { x: number; y: number } }>(
    points: T[],
    radius: number,
): T[][] {
    const r2 = radius * radius;
    const clusters: T[][] = [];
    outer: for (const p of points) {
        for (const c of clusters) {
            for (const q of c) {
                const dx = p.tip.x - q.tip.x;
                const dy = p.tip.y - q.tip.y;
                if (dx * dx + dy * dy <= r2) {
                    c.push(p);
                    continue outer;
                }
            }
        }
        clusters.push([p]);
    }
    return clusters;
}

/**
 * Engine-neutral scene composition pipeline.
 *
 * Walks a {@link MapData} area/plane and emits world-space {@link Shape}s per
 * logical layer (grid / link / room / topLabel) plus the metadata downstream
 * consumers need (cull entries, hit zones, drawn-geometry snapshots).
 *
 * The pipeline knows nothing about Konva, SVG, Canvas, or the
 * {@link DrawCommandBuilder}: callers run the shape lists through whatever
 * renderer fits their target. Both the interactive
 * {@link KonvaRenderBackend} and the exporters consume the same
 * {@link SceneBuildResult} this pipeline produces.
 */
export class ScenePipeline {
    private readonly mapReader: MapReader;
    private readonly settings: Settings;
    readonly exitRenderer: ExitRenderer;

    // Per-layer shape accumulators reset on each buildScene; insertion order
    // mirrors the legacy addNode call order so renderers can replay the scene
    // without re-sorting (e.g. labels → link exits → special exits & stubs on
    // the link layer; rooms → area name → area-exit labels on the room layer).
    private gridShapes: Shape[] = [];
    private linkShapes: Shape[] = [];
    private roomShapes: Shape[] = [];
    private topLabelShapes: Shape[] = [];

    constructor(mapReader: MapReader, settings: Settings) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.exitRenderer = new ExitRenderer(mapReader, settings);
    }

    /**
     * Build the full scene for an area/plane.
     * Clears layers, renders grid → labels → exits → rooms → area name.
     * Returns data for culling and interaction (room nodes, exit data, hit zones).
     */
    buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: ViewportBounds): SceneBuildResult {
        this.gridShapes = [];
        this.linkShapes = [];
        this.roomShapes = [];
        this.topLabelShapes = [];

        // Grid shapes for the requested viewport.
        if (viewportBounds) {
            this.gridShapes.push(...layoutGrid(viewportBounds, this.settings));
        }

        // Labels
        this.renderLabels(plane.getLabels(), area.getAreaId());

        // Link exits (two-way connections)
        const exitResult = this.renderLinkExits(area.getLinkExits(zIndex), zIndex);

        // Rooms (with stubs, special exits, inner exits)
        const roomResult = this.renderRooms(plane.getRooms() ?? [], zIndex);

        // Area name
        this.renderAreaName(area, plane);

        const areaExitHitZones = [...exitResult.areaExitHitZones, ...roomResult.areaExitHitZones];

        // Area exit labels (one per spatial cluster of exits to the same target area).
        // Labels themselves become clickable hit zones that navigate to the target area.
        const labelHitZones = this.renderAreaExitLabels(
            areaExitHitZones,
            area.getAreaId(),
            plane.getRooms() ?? [],
            exitResult.standaloneExitShapeRefs.map(n => n.bounds),
        );
        areaExitHitZones.push(...labelHitZones);

        // All hit-bearing layers concatenated. HitTester walks the tree and
        // ignores shapes without `hit`, so feeding it the union is cheap and
        // keeps every annotated shape (rooms, exits, stubs, labels, area-exit
        // labels, …) reachable from a single index.
        const hitShapes: Shape[] = [
            ...this.linkShapes,
            ...this.roomShapes,
            ...this.topLabelShapes,
        ];

        return {
            roomShapeRefs: roomResult.roomShapeRefs,
            standaloneExitShapeRefs: exitResult.standaloneExitShapeRefs,
            areaExitHitZones,
            drawnExits: exitResult.drawnExits,
            drawnSpecialExits: roomResult.drawnSpecialExits,
            drawnStubs: roomResult.drawnStubs,
            hitShapes,
            sceneShapes: {
                grid: this.gridShapes,
                link: this.linkShapes,
                room: this.roomShapes,
                topLabel: this.topLabelShapes,
            },
        };
    }

    getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    // --- Rooms ---

    private renderRooms(rooms: MapData.Room[], _zIndex: number) {
        const roomShapeRefs = new Map<number, RoomShapeRef>();
        const areaExitHitZones: AreaExitHitZone[] = [];
        const drawnSpecialExits: DrawnSpecialExitEntry[] = [];
        const drawnStubs: DrawnStubEntry[] = [];

        // Queue room shapes and push them onto roomShapes after all rooms'
        // special exits and stubs have been pushed onto linkShapes. This keeps
        // the correct z-order (all exits/stubs under all rooms) on shared
        // logical layers.
        const queuedRoomShapes: Array<[MapData.Room, GroupShape]> = [];

        rooms.forEach(room => {
            // Room body + inner exits — emitted as a single SceneIR group.
            // flatPipeline is always true now: per-style coordinate warping
            // (e.g. Isometric) is applied downstream by Style.transform.
            const roomShape = layoutRoom(room, this.mapReader, this.settings, {flatPipeline: true});
            roomShape.children.push(...layoutInnerExits(room, this.mapReader, this.settings));

            // Special exits → link layer. The active Style applies any
            // cube-base offset when transforming the link group.
            for (const se of computeSpecialExits(room, this.settings)) {
                const seShape = specialExitToShape(se, room.id);
                this.linkShapes.push(seShape);

                const pts = se.line.points;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < pts.length; i += 2) {
                    if (pts[i] < minX) minX = pts[i];
                    if (pts[i] > maxX) maxX = pts[i];
                    if (pts[i + 1] < minY) minY = pts[i + 1];
                    if (pts[i + 1] > maxY) maxY = pts[i + 1];
                }
                drawnSpecialExits.push({
                    roomId: room.id,
                    exitName: se.dir,
                    points: pts,
                    stroke: se.line.stroke,
                    strokeWidth: se.line.strokeWidth,
                    dash: se.line.dash,
                    hasArrow: !!se.arrow,
                    arrowTip: se.arrow ? {x: se.arrow.tipX, y: se.arrow.tipY} : undefined,
                    bounds: {x: minX, y: minY, width: maxX - minX, height: maxY - minY},
                });
            }

            // Area exit hit zones from special exits (custom lines to other areas)
            this.exitRenderer.getSpecialExitAreaTargets(room).forEach(zone => {
                areaExitHitZones.push({
                    bounds: zone.bounds,
                    targetRoomId: zone.targetRoomId,
                    from: zone.from,
                    tip: zone.tip,
                    arrowColor: zone.arrowColor,
                });
            });
            // Area exit hit zones from inner exits (up/down/in/out to other areas)
            this.exitRenderer.getInnerExitAreaTargets(room).forEach(zone => {
                areaExitHitZones.push({
                    bounds: zone.bounds,
                    targetRoomId: zone.targetRoomId,
                    from: zone.from,
                    tip: zone.tip,
                    arrowColor: zone.arrowColor,
                });
            });

            // Stubs → link layer (so they render under rooms, like exits)
            for (const stub of computeStubs(room, this.settings)) {
                const stubShape = stubToShape(stub);
                this.linkShapes.push(stubShape);
                drawnStubs.push({
                    roomId: stub.roomId,
                    direction: stub.direction,
                    x1: stub.x1, y1: stub.y1,
                    x2: stub.x2, y2: stub.y2,
                    stroke: stub.stroke,
                    strokeWidth: stub.strokeWidth,
                });
            }

            queuedRoomShapes.push([room, roomShape]);
            roomShapeRefs.set(room.id, {room, shape: roomShape});
        });

        for (const [, roomShape] of queuedRoomShapes) {
            this.roomShapes.push(roomShape);
        }

        return {roomShapeRefs, areaExitHitZones, drawnSpecialExits, drawnStubs};
    }

    // --- Link Exits ---

    private renderLinkExits(exits: Exit[], zIndex: number) {
        const standaloneExitShapeRefs: StandaloneExitShapeRef[] = [];
        const areaExitHitZones: AreaExitHitZone[] = [];
        const drawnExits: DrawnExitEntry[] = [];

        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) return;
            const exitShape = layoutLinkExit(data, {
                kind: "exit",
                id: `${exit.a}:${exit.b}:${exit.aDir ?? ""}:${exit.bDir ?? ""}`,
                payload: {
                    a: exit.a,
                    b: exit.b,
                    aDir: exit.aDir,
                    bDir: exit.bDir,
                    kind: exit.kind ?? "exit",
                },
            });
            this.linkShapes.push(exitShape);
            standaloneExitShapeRefs.push({shape: exitShape, bounds: data.bounds, targetRoomId: data.targetRoomId});
            drawnExits.push({
                a: exit.a,
                b: exit.b,
                aDir: exit.aDir,
                bDir: exit.bDir,
                kind: exit.kind ?? "exit",
                zIndex: exit.zIndex,
                data,
            });
            if (data.targetRoomId !== undefined) {
                areaExitHitZones.push({
                    bounds: data.bounds,
                    targetRoomId: data.targetRoomId,
                    from: data.from,
                    tip: data.tip,
                    arrowColor: data.arrowColor,
                });
            }
        });

        return {standaloneExitShapeRefs, areaExitHitZones, drawnExits};
    }

    /**
     * Build the world-space shape tree for one inter-room exit. Used by the
     * live renderer's current-room overlay path to recolour a single exit
     * without rebuilding the whole scene.
     */
    buildExitShape(data: ExitDrawData): GroupShape {
        return layoutLinkExit(data);
    }

    // --- Labels ---

    private renderLabels(labels: MapData.Label[], areaId: number) {
        for (const label of labels) {
            const shape = labelToShape(label, this.settings);
            if (!shape) continue;
            // labelToShape leaves a placeholder `hit` without an id; replace it
            // here so the HitTester can return `{ id, areaId }` directly to
            // editor consumers without a follow-up lookup.
            shape.hit = {
                kind: "label",
                id: label.labelId,
                payload: {label, areaId},
            };
            if (label.showOnTop) {
                this.topLabelShapes.push(shape);
            } else {
                this.linkShapes.push(shape);
            }
        }
    }

    // --- Area Exit Labels ---

    private renderAreaExitLabels(
        hitZones: AreaExitHitZone[],
        currentAreaId: number,
        rooms: MapData.Room[],
        exitLineBounds: Bounds[],
    ): AreaExitHitZone[] {
        const labelHitZones: AreaExitHitZone[] = [];
        if (!this.settings.areaExitLabels || hitZones.length === 0) return labelHitZones;

        type Point = {
            tip: { x: number; y: number };
            dir: { x: number; y: number };
            color: string;
            bounds: Bounds;
            targetRoomId: number;
        };
        type Placement = {
            cluster: Point[];
            boxX: number; boxY: number; boxW: number; boxH: number;
            color: string;
        };

        // Filter to cross-area exits with direction info, group by target area.
        const byArea = new Map<number, Point[]>();
        for (const zone of hitZones) {
            if (!zone.tip || !zone.from) continue;
            const targetRoom = this.mapReader.getRoom(zone.targetRoomId);
            if (!targetRoom || targetRoom.area === currentAreaId) continue;
            const dx = zone.tip.x - zone.from.x;
            const dy = zone.tip.y - zone.from.y;
            const len = Math.hypot(dx, dy) || 1;
            const pt: Point = {
                tip: zone.tip,
                dir: { x: dx / len, y: dy / len },
                color: zone.arrowColor ?? 'white',
                bounds: zone.bounds,
                targetRoomId: zone.targetRoomId,
            };
            const arr = byArea.get(targetRoom.area);
            if (arr) arr.push(pt); else byArea.set(targetRoom.area, [pt]);
        }

        const CLUSTER_RADIUS = 10; // generous — same-area exits usually benefit from a single label
        const MERGE_GAP = 2; // post-placement, merge same-area labels whose boxes are this close
        const LABEL_GAP = 0.5;
        const DIR_THRESHOLD = 0.4; // averaged direction below this magnitude → treat as "no preference"
        const SPREAD_THRESHOLD = 3; // map units — tip spread above this means the cluster is wide
                                    // enough that its centroid (the gap) beats any directional push
        const fontSize = this.settings.areaExitLabelFontSize;
        const padX = fontSize * 0.6;
        const padY = fontSize * 0.333;
        const charWidth = fontSize * 0.55;
        const textHeight = fontSize * 1.1;
        const cornerRadius = fontSize * 0.6;
        const FILL_ALPHA = 0.35;
        const strokeWidth = fontSize * 0.1;

        // All rooms on this plane are obstacles for labels.
        const rs = this.settings.roomSize;
        const roomBoxes: Bounds[] = rooms.map(r => ({
            x: r.x - rs / 2, y: r.y - rs / 2, width: rs, height: rs,
        }));
        // All area-exit arrow bounds are obstacles too — the placer excludes
        // the current cluster's own arrows when checking.
        const allArrowBounds: Bounds[] = hitZones.map(z => z.bounds);

        const boxesOverlap = (a: { x: number; y: number; w: number; h: number },
                              b: { x: number; y: number; w: number; h: number }) =>
            a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

        /** True if boxes overlap OR are within `gap` units of each other (AABB gap check). */
        const boxesCloseOrOverlap = (
            a: { x: number; y: number; w: number; h: number },
            b: { x: number; y: number; w: number; h: number },
            gap: number,
        ) => {
            const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
            const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
            return Math.hypot(dx, dy) <= gap;
        };

        const overlapsAny = (
            bx: number, by: number, bw: number, bh: number,
            obstacles: Bounds[],
        ) => {
            for (const r of obstacles) {
                if (bx < r.x + r.width && bx + bw > r.x && by < r.y + r.height && by + bh > r.y) return true;
            }
            return false;
        };

        // Compass ring used as fallback candidates, ordered (cardinals first).
        const ring: Array<[number, number]> = [
            [0, 1], [0, -1], [1, 0], [-1, 0],
            [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
        ];

        const placeCluster = (
            cluster: Point[],
            name: string,
            hintCenter?: { x: number; y: number },
        ): Placement | undefined => {
            const textWidth = name.length * charWidth;
            const boxW = textWidth + padX * 2;
            const boxH = textHeight + padY * 2;

            let cxSum = 0, cySum = 0, dxSum = 0, dySum = 0;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            const colorTally = new Map<string, number>();
            for (const p of cluster) {
                cxSum += p.tip.x; cySum += p.tip.y;
                dxSum += p.dir.x; dySum += p.dir.y;
                if (p.tip.x < minX) minX = p.tip.x;
                if (p.tip.x > maxX) maxX = p.tip.x;
                if (p.tip.y < minY) minY = p.tip.y;
                if (p.tip.y > maxY) maxY = p.tip.y;
                colorTally.set(p.color, (colorTally.get(p.color) ?? 0) + 1);
            }
            const n = cluster.length;
            const dLen = Math.hypot(dxSum, dySum);
            const udx = dLen > 0 ? dxSum / dLen : 0;
            const udy = dLen > 0 ? dySum / dLen : 0;

            // Spread = max distance between any two tips in the cluster.
            // Large spread → the cluster came from merging distant clumps, so its
            // centroid is the natural spot and directional push looks off-center.
            let spread = 0;
            for (let i = 0; i < cluster.length; i++) {
                for (let j = i + 1; j < cluster.length; j++) {
                    const sx = cluster[i].tip.x - cluster[j].tip.x;
                    const sy = cluster[i].tip.y - cluster[j].tip.y;
                    const d = Math.hypot(sx, sy);
                    if (d > spread) spread = d;
                }
            }
            const useSpreadMidpoint = spread > SPREAD_THRESHOLD;
            // A consistent direction-of-travel is meaningful even when the
            // cluster is spread — e.g. a column of rooms all exiting east.
            // Spread perpendicular to travel doesn't invalidate the push.
            const hasPreferred = dLen / n >= DIR_THRESHOLD;

            // Anchor precedence:
            //   1) hintCenter — merge pass passes the midpoint between colliding boxes.
            //   2) Wide clusters — use the tip bounding-box midpoint (unbiased by
            //      arrow count; the weighted centroid pulls toward whichever
            //      sub-group has more arrows).
            //   3) Tight clusters — weighted centroid is fine, sub-groups don't exist.
            const cx = hintCenter?.x ?? (useSpreadMidpoint ? (minX + maxX) / 2 : cxSum / n);
            const cy = hintCenter?.y ?? (useSpreadMidpoint ? (minY + maxY) / 2 : cySum / n);

            let color = 'white';
            let bestCount = 0;
            for (const [c, count] of colorTally) {
                if (count > bestCount) { color = c; bestCount = count; }
            }

            // Obstacles include rooms, every area-exit arrow, and every regular
            // link exit line — labels must not run through connecting lines either.
            const obstacles = roomBoxes.concat(allArrowBounds).concat(exitLineBounds);

            const offsetAlong = (dx: number, dy: number, extra = 0) =>
                LABEL_GAP + extra + Math.abs(dx) * boxW / 2 + Math.abs(dy) * boxH / 2;

            const candidates: Array<{ x: number; y: number }> = [];
            if (hasPreferred) {
                const off = offsetAlong(udx, udy);
                candidates.push({ x: cx + udx * off, y: cy + udy * off });
            }
            // Try the raw centroid early — it often IS the empty gap between
            // merged clumps, and in that case every directional push looks worse.
            candidates.push({ x: cx, y: cy });
            // Compass ring at three escape radii to handle dense maps.
            for (const extra of [0, 0.6, 1.4]) {
                for (const [dx, dy] of ring) {
                    const off = offsetAlong(dx, dy, extra);
                    candidates.push({ x: cx + dx * off, y: cy + dy * off });
                }
            }

            // Return undefined if no candidate clears every obstacle — better to
            // drop the label than draw it on top of rooms/arrows/lines.
            for (const c of candidates) {
                const bx = c.x - boxW / 2;
                const by = c.y - boxH / 2;
                if (!overlapsAny(bx, by, boxW, boxH, obstacles)) {
                    return {
                        cluster,
                        boxX: bx, boxY: by,
                        boxW, boxH,
                        color,
                    };
                }
            }
            return undefined;
        };

        for (const [areaId, points] of byArea) {
            const name = this.mapReader.getArea(areaId)?.getAreaName() || `Area ${areaId}`;

            // Initial spatial clustering by arrow-tip proximity.
            const rawClusters = clusterByProximity(points, CLUSTER_RADIUS);
            let placements = rawClusters
                .map(c => placeCluster(c, name))
                .filter((p): p is Placement => p !== undefined);

            // Merge placements whose final boxes collide — two distant clumps that
            // both gravitated into the same empty gap become a single combined label.
            let changed = true;
            while (changed && placements.length > 1) {
                changed = false;
                outer: for (let i = 0; i < placements.length; i++) {
                    for (let j = i + 1; j < placements.length; j++) {
                        const a = { x: placements[i].boxX, y: placements[i].boxY, w: placements[i].boxW, h: placements[i].boxH };
                        const b = { x: placements[j].boxX, y: placements[j].boxY, w: placements[j].boxW, h: placements[j].boxH };
                        // Merge when labels are close enough to read as "two for the
                        // same area" — not only when they literally overlap.
                        if (boxesCloseOrOverlap(a, b, MERGE_GAP)) {
                            const combined = [...placements[i].cluster, ...placements[j].cluster];
                            const midpoint = {
                                x: (a.x + a.w / 2 + b.x + b.w / 2) / 2,
                                y: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
                            };
                            const merged = placeCluster(combined, name, midpoint)
                                ?? placeCluster(combined, name);
                            if (merged) {
                                placements[i] = merged;
                                placements.splice(j, 1);
                            } else {
                                // Combined placement couldn't find a clear spot — drop both.
                                placements.splice(j, 1);
                                placements.splice(i, 1);
                            }
                            changed = true;
                            break outer;
                        }
                    }
                }
            }

            for (const p of placements) {
                const fill = colorWithAlpha(p.color, FILL_ALPHA);
                // Pick text color against the *effective* label bg (fill alpha-blended
                // over the map background), not the raw arrow color — otherwise a pale
                // arrow color at low alpha still reads as dark and needs light text.
                const effectiveBg = blendOverBackground(p.color, this.settings.backgroundColor, FILL_ALPHA);
                const textColor = colorLightness(effectiveBg) > 0.55 ? '#000' : '#fff';
                const labelShape: Shape = {
                    type: "group",
                    x: 0,
                    y: 0,
                    layer: "room",
                    hit: {
                        kind: "areaExit",
                        id: p.cluster[0].targetRoomId,
                        payload: {targetRoomId: p.cluster[0].targetRoomId},
                    },
                    children: [
                        {
                            type: "rect",
                            x: p.boxX, y: p.boxY,
                            width: p.boxW, height: p.boxH,
                            cornerRadius,
                            paint: {fill, stroke: p.color, strokeWidth},
                        },
                        {
                            type: "text",
                            x: p.boxX + padX,
                            y: p.boxY + padY,
                            width: p.boxW - padX * 2,
                            height: p.boxH - padY * 2,
                            text: name,
                            fontSize,
                            fontFamily: this.settings.fontFamily,
                            fill: textColor,
                            align: "center",
                            verticalAlign: "middle",
                        },
                    ],
                };
                this.roomShapes.push(labelShape);

                // Label is clickable — navigate to the target area (any room from the
                // cluster works since they all live there).
                labelHitZones.push({
                    bounds: { x: p.boxX, y: p.boxY, width: p.boxW, height: p.boxH },
                    targetRoomId: p.cluster[0].targetRoomId,
                });
            }
        }

        return labelHitZones;
    }

    // --- Area Name ---

    private renderAreaName(area: Area, plane: Plane) {
        if (!this.settings.areaName) return;
        const name = area.getAreaName();
        if (!name) return;
        const bounds = this.getEffectiveBounds(area, plane);
        const areaNameShape: GroupShape = {
            type: "group",
            x: 0,
            y: 0,
            layer: "room",
            children: [{
                type: "text",
                x: bounds.minX - 3.5,
                y: bounds.minY - 4.5,
                text: name,
                fontSize: 2.5,
                fontFamily: this.settings.fontFamily,
                fill: this.settings.lineColor,
            }],
        };
        this.roomShapes.push(areaNameShape);
    }
}
