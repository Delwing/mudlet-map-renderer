import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type Plane from "./reader/Plane";
import type Exit from "./reader/Exit";
import type {Settings, ViewportBounds} from "./types/Settings";
import type {DrawingBackend, GroupNode, LayerNode} from "./backend/DrawingBackend";
import {RoomShapeRenderer} from "./RoomShapeRenderer";
import {GridRenderer} from "./GridRenderer";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData, ExitDrawArrow} from "./ExitRenderer";
import {computeStubs} from "./scene/StubStyle";
import {computeSpecialExits} from "./scene/SpecialExitStyle";
import {computeInnerExits} from "./scene/InnerExitStyle";
import {colorLightness} from "./utils/color";

type Bounds = { x: number; y: number; width: number; height: number };

export type RoomNodeEntry = { room: MapData.Room; group: GroupNode };
export type StandaloneExitEntry = { group: GroupNode; bounds: Bounds; targetRoomId?: number };
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

export type SceneBuildResult = {
    roomNodes: Map<number, RoomNodeEntry>;
    standaloneExitNodes: StandaloneExitEntry[];
    areaExitHitZones: AreaExitHitZone[];
    drawnExits: DrawnExitEntry[];
    drawnSpecialExits: DrawnSpecialExitEntry[];
    drawnStubs: DrawnStubEntry[];
};

function getLabelColor(color: MapData.Color): string {
    const alpha = (color?.alpha ?? 255) / 255;
    const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
    return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
}

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
 * Backend-agnostic scene composition pipeline.
 * Drives a DrawingBackend + LayerNode to render the full map scene.
 *
 * Both the interactive KonvaRenderBackend and exporters (SvgExporter,
 * CanvasExporter, …) drive this pipeline with their respective DrawingBackend.
 */
export class ScenePipeline {
    private readonly mapReader: MapReader;
    private readonly settings: Settings;
    private readonly backend: DrawingBackend;
    readonly roomShapeRenderer: RoomShapeRenderer;
    readonly gridRenderer: GridRenderer;
    readonly exitRenderer: ExitRenderer;

    private readonly gridLayer: LayerNode;
    private readonly linkLayer: LayerNode;
    private readonly roomLayer: LayerNode;
    private readonly topLabelLayer: LayerNode | undefined;

    constructor(
        mapReader: MapReader,
        settings: Settings,
        backend: DrawingBackend,
        layers: { gridLayer: LayerNode; linkLayer: LayerNode; roomLayer: LayerNode; topLabelLayer?: LayerNode },
    ) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.backend = backend;
        this.gridLayer = layers.gridLayer;
        this.linkLayer = layers.linkLayer;
        this.roomLayer = layers.roomLayer;
        this.topLabelLayer = layers.topLabelLayer;

        this.roomShapeRenderer = new RoomShapeRenderer(mapReader, settings, backend);
        this.gridRenderer = new GridRenderer(layers.gridLayer, settings, backend);
        this.exitRenderer = new ExitRenderer(mapReader, settings);
    }

    /**
     * Build the full scene for an area/plane.
     * Clears layers, renders grid → labels → exits → rooms → area name.
     * Returns data for culling and interaction (room nodes, exit data, hit zones).
     */
    buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: ViewportBounds): SceneBuildResult {
        this.gridLayer.destroyChildren();
        this.gridRenderer.invalidateCache();
        this.linkLayer.destroyChildren();
        this.roomLayer.destroyChildren();
        this.topLabelLayer?.destroyChildren();

        // Grid
        if (viewportBounds) {
            this.gridRenderer.render(viewportBounds);
        }

        // Labels
        this.renderLabels(plane.getLabels());

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
            exitResult.standaloneExitNodes.map(n => n.bounds),
        );
        areaExitHitZones.push(...labelHitZones);

        return {
            roomNodes: roomResult.roomNodes,
            standaloneExitNodes: exitResult.standaloneExitNodes,
            areaExitHitZones,
            drawnExits: exitResult.drawnExits,
            drawnSpecialExits: roomResult.drawnSpecialExits,
            drawnStubs: roomResult.drawnStubs,
        };
    }

    getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    // --- Rooms ---

    private renderRooms(rooms: MapData.Room[], _zIndex: number) {
        const roomNodes = new Map<number, RoomNodeEntry>();
        const areaExitHitZones: AreaExitHitZone[] = [];
        const drawnSpecialExits: DrawnSpecialExitEntry[] = [];
        const drawnStubs: DrawnStubEntry[] = [];
        const rs = this.settings.roomSize;
        const depthOff = this.backend.getExitDepthOffset();

        // Queue room groups and add them to the room layer after all rooms'
        // special exits and stubs have been added to the link layer. This keeps
        // the correct z-order (all exits/stubs under all rooms) when the link
        // and room layers are backed by the same recording node.
        const queuedRoomNodes: Array<[MapData.Room, GroupNode]> = [];

        rooms.forEach(room => {
            // Room shape (through DrawingBackend)
            const roomNode = this.roomShapeRenderer.createRoomGroup(room);

            // Special exits → link layer (offset for cube depth)
            for (const se of computeSpecialExits(room, this.settings)) {
                const seGroup = this.backend.createGroup(depthOff.x, depthOff.y);
                this.backend.addLine(seGroup, {
                    points: se.line.points,
                    stroke: se.line.stroke,
                    strokeWidth: se.line.strokeWidth,
                    dash: se.line.dash,
                });
                if (se.arrow) {
                    const a = se.arrow;
                    this.backend.addPolygon(seGroup, {
                        vertices: [a.tipX, a.tipY, a.x1, a.y1, a.x2, a.y2],
                        fill: a.fill,
                        stroke: a.stroke,
                        strokeWidth: a.strokeWidth,
                    });
                }
                if (se.door) {
                    const d = se.door;
                    this.backend.addRect(seGroup, {
                        x: d.x, y: d.y, width: d.width, height: d.height,
                        stroke: d.stroke, strokeWidth: d.strokeWidth,
                    });
                }
                this.linkLayer.addNode(seGroup);
                // Record drawn geometry for hit-testing consumers.
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
                    arrowTip: se.arrow ? { x: se.arrow.tipX, y: se.arrow.tipY } : undefined,
                    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
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
                const stubGroup = this.backend.createGroup(depthOff.x, depthOff.y);
                this.backend.addLine(stubGroup, {
                    points: [stub.x1, stub.y1, stub.x2, stub.y2],
                    stroke: stub.stroke,
                    strokeWidth: stub.strokeWidth,
                });
                this.linkLayer.addNode(stubGroup);
                drawnStubs.push({
                    roomId: stub.roomId,
                    direction: stub.direction,
                    x1: stub.x1, y1: stub.y1,
                    x2: stub.x2, y2: stub.y2,
                    stroke: stub.stroke,
                    strokeWidth: stub.strokeWidth,
                });
            }

            // Inner exits → room group (relative coordinates)
            const gx = room.x - rs / 2;
            const gy = room.y - rs / 2;
            const {triangles} = computeInnerExits(room, this.mapReader, this.settings);
            for (const tri of triangles) {
                const relVertices: number[] = [];
                for (let i = 0; i < tri.vertices.length; i += 2) {
                    relVertices.push(tri.vertices[i] - gx, tri.vertices[i + 1] - gy);
                }
                this.backend.addPolygon(roomNode, {
                    vertices: relVertices,
                    fill: tri.fill,
                    stroke: tri.stroke,
                    strokeWidth: tri.strokeWidth,
                });
            }

            queuedRoomNodes.push([room, roomNode]);
            roomNodes.set(room.id, {room, group: roomNode});
        });

        for (const [, roomNode] of queuedRoomNodes) {
            this.roomLayer.addNode(roomNode);
        }

        return {roomNodes, areaExitHitZones, drawnSpecialExits, drawnStubs};
    }

    // --- Link Exits ---

    private renderLinkExits(exits: Exit[], zIndex: number) {
        const standaloneExitNodes: StandaloneExitEntry[] = [];
        const areaExitHitZones: AreaExitHitZone[] = [];
        const drawnExits: DrawnExitEntry[] = [];

        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) return;
            const group = this.renderExitData(data);
            this.linkLayer.addNode(group);
            standaloneExitNodes.push({group, bounds: data.bounds, targetRoomId: data.targetRoomId});
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

        return {standaloneExitNodes, areaExitHitZones, drawnExits};
    }

    /** Render ExitDrawData through the DrawingBackend. */
    renderExitData(data: ExitDrawData): GroupNode {
        const depthOff = this.backend.getExitDepthOffset();
        const group = this.backend.createGroup(depthOff.x, depthOff.y);
        for (const line of data.lines) {
            this.backend.addLine(group, {
                points: line.points,
                stroke: line.stroke, strokeWidth: line.strokeWidth,
                dash: line.dash,
            });
        }
        for (const arrow of data.arrows) {
            this.renderArrow(group, arrow);
        }
        for (const door of data.doors) {
            this.backend.addRect(group, {
                x: door.x, y: door.y,
                width: door.width, height: door.height,
                stroke: door.stroke, strokeWidth: door.strokeWidth,
            });
        }
        return group;
    }

    private renderArrow(group: GroupNode, arrow: ExitDrawArrow) {
        this.backend.addLine(group, {
            points: arrow.points,
            stroke: arrow.stroke, strokeWidth: arrow.strokeWidth,
            dash: arrow.dash,
        });
        const lastIdx = arrow.points.length - 2;
        const tipX = arrow.points[lastIdx], tipY = arrow.points[lastIdx + 1];
        const prevX = arrow.points[lastIdx - 2], prevY = arrow.points[lastIdx - 1];
        const angle = Math.atan2(tipY - prevY, tipX - prevX);
        const pl = arrow.pointerLength, pw = arrow.pointerWidth / 2;
        const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
        const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
        const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
        const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));
        this.backend.addPolygon(group, {
            vertices: [tipX, tipY, x1, y1, x2, y2],
            fill: arrow.fill, stroke: arrow.stroke,
            strokeWidth: arrow.strokeWidth,
        });
    }

    // --- Labels ---

    private targetLabelLayer(label: MapData.Label): LayerNode {
        return (label.showOnTop && this.topLabelLayer) ? this.topLabelLayer : this.linkLayer;
    }

    private renderLabels(labels: MapData.Label[]) {
        if (this.settings.labelRenderMode === "none") return;

        labels.forEach(label => {
            const lx = label.X;
            const ly = -label.Y;
            const noScaling = !!label.noScaling;
            // noScaling groups are anchored at (lx,ly) with content at (0,0) so the
            // RecordingLayerNode can cancel out the stage zoom for those groups only.
            const gx = noScaling ? lx : 0;
            const gy = noScaling ? ly : 0;
            const cx = noScaling ? 0 : lx;
            const cy = noScaling ? 0 : ly;

            if (this.settings.labelRenderMode === "image" && label.pixMap) {
                const group = this.backend.createGroup(gx, gy);
                this.backend.addImage(group, {
                    x: cx, y: cy,
                    width: label.Width, height: label.Height,
                    src: `data:image/png;base64,${label.pixMap}`,
                });
                if (noScaling) group.noScaling = true;
                this.targetLabelLayer(label).addNode(group);
                return;
            }

            const group = this.backend.createGroup(gx, gy);

            if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
                this.backend.addRect(group, {
                    x: cx, y: cy, width: label.Width, height: label.Height,
                    fill: getLabelColor(label.BgColor),
                });
            }

            if (label.Text) {
                const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
                const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

                this.backend.addText(group, {
                    x: cx, y: cy,
                    width: label.Width, height: label.Height,
                    text: label.Text,
                    fontSize,
                    fill: getLabelColor(label.FgColor),
                    align: "center",
                    verticalAlign: "middle",
                });
            }

            if (noScaling) group.noScaling = true;
            this.targetLabelLayer(label).addNode(group);
        });
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
                const group = this.backend.createGroup(0, 0);
                this.backend.addRect(group, {
                    x: p.boxX, y: p.boxY,
                    width: p.boxW, height: p.boxH,
                    fill,
                    stroke: p.color,
                    strokeWidth,
                    cornerRadius,
                });
                this.backend.addText(group, {
                    x: p.boxX + padX,
                    y: p.boxY + padY,
                    width: p.boxW - padX * 2,
                    height: p.boxH - padY * 2,
                    text: name,
                    fontSize,
                    fontFamily: this.settings.fontFamily,
                    fill: textColor,
                    align: 'center',
                    verticalAlign: 'middle',
                });
                this.roomLayer.addNode(group);

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
        const group = this.backend.createGroup(0, 0);
        this.backend.addText(group, {
            x: bounds.minX - 3.5,
            y: bounds.minY - 4.5,
            text: name,
            fontSize: 2.5,
            fontFamily: this.settings.fontFamily,
            fill: this.settings.lineColor,
        });
        this.roomLayer.addNode(group);
    }
}
