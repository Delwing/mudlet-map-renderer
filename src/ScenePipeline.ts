import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type Plane from "./reader/Plane";
import type Exit from "./reader/Exit";
import type {Settings, ViewportBounds} from "./types/Settings";
import type {DrawingBackend, GroupNode, LayerNode} from "./backend/DrawingBackend";
import {RoomShapeRenderer} from "./RoomShapeRenderer";
import {GridRenderer} from "./GridRenderer";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData} from "./ExitRenderer";
import {computeStubs} from "./scene/StubStyle";
import {computeSpecialExits} from "./scene/SpecialExitStyle";
import {computeInnerExits} from "./scene/InnerExitStyle";
import {measureTextBaselineOffset} from "./utils/textMeasure";

type Bounds = { x: number; y: number; width: number; height: number };

export type RoomNodeEntry = { room: MapData.Room; group: GroupNode };
export type StandaloneExitEntry = { data: ExitDrawData; bounds: Bounds; targetRoomId?: number };
export type AreaExitHitZone = { bounds: Bounds; targetRoomId: number };

export type SceneBuildResult = {
    roomNodes: Map<number, RoomNodeEntry>;
    standaloneExitNodes: StandaloneExitEntry[];
    areaExitHitZones: AreaExitHitZone[];
    exitDrawData: ExitDrawData[];
};

function getLabelColor(color: MapData.Color): string {
    const alpha = (color?.alpha ?? 255) / 255;
    const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
    return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
}

/**
 * Backend-agnostic scene composition pipeline.
 * Drives a DrawingBackend + LayerNode to render the full map scene.
 *
 * Both KonvaRenderBackend and SvgRenderBackend use this same pipeline
 * with their respective DrawingBackend implementations.
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

    constructor(
        mapReader: MapReader,
        settings: Settings,
        backend: DrawingBackend,
        layers: { gridLayer: LayerNode; linkLayer: LayerNode; roomLayer: LayerNode },
    ) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.backend = backend;
        this.gridLayer = layers.gridLayer;
        this.linkLayer = layers.linkLayer;
        this.roomLayer = layers.roomLayer;

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

        // Grid
        if (viewportBounds) {
            this.gridRenderer.render(viewportBounds);
        }

        // Labels
        this.renderLabels(plane.getLabels());

        // Link exits (two-way connections)
        const exitResult = this.renderLinkExits(area.getLinkExits(zIndex), zIndex);

        // Rooms (with stubs, special exits, inner exits)
        const roomResult = this.renderRooms(plane.getRooms() ?? []);

        // Area name
        this.renderAreaName(area, plane);

        return {
            roomNodes: roomResult.roomNodes,
            standaloneExitNodes: exitResult.standaloneExitNodes,
            areaExitHitZones: [...exitResult.areaExitHitZones, ...roomResult.areaExitHitZones],
            exitDrawData: exitResult.exitDrawData,
        };
    }

    getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    // --- Rooms ---

    private renderRooms(rooms: MapData.Room[]) {
        const roomNodes = new Map<number, RoomNodeEntry>();
        const areaExitHitZones: AreaExitHitZone[] = [];
        const rs = this.settings.roomSize;

        rooms.forEach(room => {
            // Room shape (through DrawingBackend)
            const roomNode = this.roomShapeRenderer.createRoomGroup(room);

            // Special exits → link layer
            for (const se of computeSpecialExits(room, this.settings)) {
                const seGroup = this.backend.createGroup(0, 0);
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
            }

            // Area exit hit zones from special exits
            this.exitRenderer.getSpecialExitAreaTargets(room).forEach(zone => {
                areaExitHitZones.push(zone);
            });

            // Stubs → room group (relative coordinates)
            const gx = room.x - rs / 2;
            const gy = room.y - rs / 2;
            for (const stub of computeStubs(room, this.settings)) {
                this.backend.addLine(roomNode, {
                    points: [stub.x1 - gx, stub.y1 - gy, stub.x2 - gx, stub.y2 - gy],
                    stroke: stub.stroke,
                    strokeWidth: stub.strokeWidth,
                });
            }

            // Inner exits → room group (relative coordinates)
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

            this.roomLayer.addNode(roomNode);
            roomNodes.set(room.id, {room, group: roomNode});
        });

        return {roomNodes, areaExitHitZones};
    }

    // --- Link Exits ---

    private renderLinkExits(exits: Exit[], zIndex: number) {
        const standaloneExitNodes: StandaloneExitEntry[] = [];
        const areaExitHitZones: AreaExitHitZone[] = [];
        const exitDrawData: ExitDrawData[] = [];

        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) return;
            standaloneExitNodes.push({data, bounds: data.bounds, targetRoomId: data.targetRoomId});
            exitDrawData.push(data);
            if (data.targetRoomId !== undefined) {
                areaExitHitZones.push({bounds: data.bounds, targetRoomId: data.targetRoomId});
            }
        });

        return {standaloneExitNodes, areaExitHitZones, exitDrawData};
    }

    // --- Labels ---

    private renderLabels(labels: MapData.Label[]) {
        if (this.settings.labelRenderMode === "none") return;

        labels.forEach(label => {
            const lx = label.X;
            const ly = -label.Y;

            if (this.settings.labelRenderMode === "image" && label.pixMap) {
                const group = this.backend.createGroup(0, 0);
                this.backend.addImage(group, {
                    x: lx, y: ly,
                    width: label.Width, height: label.Height,
                    src: `data:image/png;base64,${label.pixMap}`,
                });
                this.linkLayer.addNode(group);
                return;
            }

            const group = this.backend.createGroup(0, 0);

            if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
                this.backend.addRect(group, {
                    x: lx, y: ly, width: label.Width, height: label.Height,
                    fill: getLabelColor(label.BgColor),
                });
            }

            if (label.Text) {
                const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
                const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

                this.backend.addText(group, {
                    x: lx, y: ly,
                    width: label.Width, height: label.Height,
                    text: label.Text,
                    fontSize,
                    fill: getLabelColor(label.FgColor),
                    align: "center",
                    verticalAlign: "middle",
                });
            }

            this.linkLayer.addNode(group);
        });
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
            fill: 'white',
        });
        this.roomLayer.addNode(group);
    }
}
