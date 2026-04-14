import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData} from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import Plane from "./reader/Plane";
import type Exit from "./reader/Exit";
import type {Settings, ViewportBounds} from "./Renderer";
import {RoomShapeRenderer} from "./RoomShapeRenderer";
import {GridRenderer} from "./GridRenderer";
import {KonvaBackend, KonvaGroupNode, KonvaLayerNode} from "./backend/KonvaBackend";
import type {GroupNode} from "./backend/DrawingBackend";
import {drawExitDataToCanvas} from "./scene/ExitDataRenderer";
import {computePathData} from "./PathData";
import {movePoint} from "./directions";

type Bounds = { x: number; y: number; width: number; height: number };

export type RoomNodeEntry = { room: MapData.Room; group: GroupNode };

export type StandaloneExitEntry = { data: ExitDrawData; bounds: Bounds; targetRoomId?: number };

export type AreaExitHitZone = { bounds: Bounds; targetRoomId: number };

export type SceneBuildResult = {
    roomNodes: Map<number, RoomNodeEntry>;
    standaloneExitNodes: StandaloneExitEntry[];
    areaExitHitZones: AreaExitHitZone[];
    exitBatchShape: Konva.Shape;
    /** All exit draw data. The sceneFunc reads from this array; replace its
     *  contents with culling-filtered data for viewport-based rendering. */
    exitDrawData: ExitDrawData[];
};

/**
 * Builds the Konva scene graph for a map area.
 * Used by both the interactive Renderer (browser) and HeadlessRenderer (Node.js).
 */
export class SceneBuilder {
    private readonly mapReader: MapReader;
    private readonly settings: Settings;
    readonly exitRenderer: ExitRenderer;
    readonly roomShapeRenderer: RoomShapeRenderer;
    readonly gridRenderer: GridRenderer;

    private readonly gridLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly roomLayer: Konva.Layer;

    constructor(
        mapReader: MapReader,
        settings: Settings,
        layers: {
            gridLayer: Konva.Layer;
            linkLayer: Konva.Layer;
            roomLayer: Konva.Layer;
        },
    ) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.gridLayer = layers.gridLayer;
        this.linkLayer = layers.linkLayer;
        this.roomLayer = layers.roomLayer;

        this.exitRenderer = new ExitRenderer(mapReader, settings);
        const backend = new KonvaBackend();
        this.roomShapeRenderer = new RoomShapeRenderer(mapReader, settings, backend);
        this.gridRenderer = new GridRenderer(new KonvaLayerNode(this.gridLayer), settings, backend);
    }

    buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: ViewportBounds): SceneBuildResult {
        this.gridLayer.destroyChildren();
        this.gridRenderer.invalidateCache();
        this.linkLayer.destroyChildren();
        this.roomLayer.destroyChildren();

        if (viewportBounds) {
            this.gridRenderer.render(viewportBounds);
        }

        this.renderLabels(plane.getLabels());

        const exitResult = this.renderExits(area.getLinkExits(zIndex), zIndex);
        const roomResult = this.renderRooms(plane.getRooms() ?? []);

        this.renderAreaName(area, plane);

        return {
            roomNodes: roomResult.roomNodes,
            standaloneExitNodes: exitResult.standaloneExitNodes,
            areaExitHitZones: [...exitResult.areaExitHitZones, ...roomResult.areaExitHitZones],
            exitBatchShape: exitResult.exitBatchShape,
            exitDrawData: exitResult.exitDrawData,
        };
    }

    private renderRooms(rooms: MapData.Room[]) {
        const roomNodes = new Map<number, RoomNodeEntry>();
        const areaExitHitZones: AreaExitHitZone[] = [];

        rooms.forEach(room => {
            const roomNode = this.roomShapeRenderer.createRoomGroup(room);
            const roomRender = (roomNode as KonvaGroupNode).konvaGroup;
            this.roomLayer.add(roomRender);

            this.exitRenderer.renderSpecialExits(room).forEach(render => {
                this.linkLayer.add(render);
            });
            this.exitRenderer.getSpecialExitAreaTargets(room).forEach(zone => {
                areaExitHitZones.push(zone);
            });

            const gx = room.x - this.settings.roomSize / 2;
            const gy = room.y - this.settings.roomSize / 2;
            this.exitRenderer.renderStubs(room).forEach(render => {
                const pts = render.points();
                for (let i = 0; i < pts.length; i += 2) {
                    pts[i] -= gx;
                    pts[i + 1] -= gy;
                }
                render.points(pts);
                roomRender.add(render);
            });
            this.exitRenderer.renderInnerExits(room).forEach(render => {
                render.position({ x: -gx, y: -gy });
                roomRender.add(render);
            });

            roomNodes.set(room.id, { room, group: roomNode });
        });

        return { roomNodes, areaExitHitZones };
    }

    private renderExits(exits: Exit[], zIndex: number) {
        const standaloneExitNodes: StandaloneExitEntry[] = [];
        const areaExitHitZones: AreaExitHitZone[] = [];
        let visibleExitDrawData: ExitDrawData[] = [];

        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) return;
            const entry: StandaloneExitEntry = { data, bounds: data.bounds, targetRoomId: data.targetRoomId };
            standaloneExitNodes.push(entry);
            visibleExitDrawData.push(data);
            if (data.targetRoomId !== undefined) {
                areaExitHitZones.push({ bounds: data.bounds, targetRoomId: data.targetRoomId });
            }
        });

        const exitBatchShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context;
                for (const data of visibleExitDrawData) {
                    drawExitDataToCanvas(ctx, data);
                }
            },
        });
        this.linkLayer.add(exitBatchShape);

        return { standaloneExitNodes, areaExitHitZones, exitBatchShape, exitDrawData: visibleExitDrawData };
    }

    private renderLabels(labels: MapData.Label[]) {
        if (this.settings.labelRenderMode === "none") return;
        labels.forEach(label => {
            if (this.settings.labelRenderMode === "image") {
                if (!label.pixMap) return;
                const image = Konva.Util.createImageElement();
                image.src = `data:image/png;base64,${label.pixMap}`;
                this.linkLayer.add(new Konva.Image({
                    x: label.X,
                    y: -label.Y,
                    width: label.Width,
                    height: label.Height,
                    image: image,
                    listening: false,
                }));
                return;
            }
            this.renderLabelAsData(label);
        });
    }

    private renderLabelAsData(label: MapData.Label) {
        const labelRender = new Konva.Group({ listening: false });

        const background = new Konva.Rect({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            listening: false,
        });

        if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
            background.fill(getLabelColor(label.BgColor));
        } else {
            background.fillEnabled(false);
        }
        labelRender.add(background);

        const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
        const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

        labelRender.add(new Konva.Text({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            text: label.Text,
            fontSize,
            fillEnabled: true,
            fill: getLabelColor(label.FgColor),
            align: "center",
            verticalAlign: "middle",
            listening: false,
        }));

        this.linkLayer.add(labelRender);
    }

    private renderAreaName(area: Area, plane: Plane) {
        if (!this.settings.areaName) return;
        const name = area.getAreaName();
        if (!name) return;
        const bounds = this.getEffectiveBounds(area, plane);
        this.roomLayer.add(new Konva.Text({
            x: bounds.minX - 3.5,
            y: bounds.minY - 4.5,
            text: name,
            fontSize: 2.5,
            fontFamily: this.settings.fontFamily,
            fill: 'white',
            listening: false,
            perfectDrawEnabled: false,
        }));
    }

    getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }
}

function getLabelColor(color: MapData.Color): string {
    const alpha = (color?.alpha ?? 255) / 255;
    const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
    return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
}

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Overlay Builders ---

export function buildPositionMarker(room: MapData.Room, settings: Settings): Konva.Shape {
    const pm = settings.playerMarker;
    const strokeColor = hexToRgba(pm.strokeColor, pm.strokeAlpha);
    const fillColor = hexToRgba(pm.fillColor, pm.fillAlpha);
    const markerSize = settings.roomSize * pm.sizeFactor;
    const halfSize = markerSize / 2;

    const useRoomShape = pm.matchRoomShape && settings.roomShape !== "circle";
    if (useRoomShape) {
        const cr = settings.roomShape === "roundedRectangle" ? markerSize * 0.2 : 0;
        return new Konva.Rect({
            x: room.x - halfSize,
            y: room.y - halfSize,
            width: markerSize,
            height: markerSize,
            stroke: strokeColor,
            fill: fillColor,
            strokeWidth: pm.strokeWidth,
            dash: pm.dash,
            dashEnabled: pm.dashEnabled,
            cornerRadius: cr,
        });
    }
    return new Konva.Circle({
        x: room.x,
        y: room.y,
        radius: halfSize,
        stroke: strokeColor,
        fill: fillColor,
        strokeWidth: pm.strokeWidth,
        dash: pm.dash,
        dashEnabled: pm.dashEnabled,
    });
}

export function buildHighlight(room: MapData.Room, color: string, settings: Settings): Konva.Shape {
    const highlightFactor = 1.5;
    if (settings.roomShape === "circle") {
        return new Konva.Circle({
            x: room.x,
            y: room.y,
            radius: settings.roomSize / 2 * highlightFactor,
            stroke: color,
            strokeWidth: 0.1,
            dash: [0.05, 0.05],
            dashEnabled: true,
            listening: false,
        });
    }
    return new Konva.Rect({
        x: room.x - settings.roomSize / 2 * highlightFactor,
        y: room.y - settings.roomSize / 2 * highlightFactor,
        width: settings.roomSize * highlightFactor,
        height: settings.roomSize * highlightFactor,
        stroke: color,
        strokeWidth: 0.1,
        dash: [0.05, 0.05],
        dashEnabled: true,
        cornerRadius: settings.roomShape === "roundedRectangle" ? settings.roomSize * highlightFactor * 0.2 : 0,
        listening: false,
    });
}

export function buildPathOverlay(
    mapReader: MapReader,
    settings: Settings,
    locations: number[],
    color: string,
    areaId: number,
    zIndex: number,
): Konva.Group {
    const result = computePathData(mapReader, settings, locations, areaId, zIndex);
    const group = new Konva.Group();

    function createStrokedLine(points: number[]): Konva.Group {
        const lineGroup = new Konva.Group();
        lineGroup.opacity(0.8);
        lineGroup.add(new Konva.Line({
            points,
            stroke: 'black',
            strokeWidth: settings.lineWidth * 8,
            lineCap: 'round',
            lineJoin: 'round',
        }));
        lineGroup.add(new Konva.Line({
            points,
            stroke: color,
            strokeWidth: settings.lineWidth * 4,
            lineCap: 'round',
            lineJoin: 'round',
        }));
        return lineGroup;
    }

    for (const segment of result.segments) {
        group.add(createStrokedLine(segment.points));
    }
    for (const cl of result.customLines) {
        group.add(createStrokedLine(cl.points));
    }

    for (const marker of result.innerMarkers) {
        const markerGroup = new Konva.Group();
        markerGroup.opacity(0.8);

        const triangle = new Konva.RegularPolygon({
            x: marker.room.x,
            y: marker.room.y,
            sides: 3,
            fill: color,
            stroke: 'black',
            strokeWidth: settings.lineWidth * 2,
            radius: settings.roomSize / 5,
            scaleX: 1.4,
            scaleY: 0.8,
        });

        switch (marker.direction) {
            case "up":
                triangle.position(movePoint(marker.room.x, marker.room.y, "south", settings.roomSize / 4));
                break;
            case "down":
                triangle.rotation(180);
                triangle.position(movePoint(marker.room.x, marker.room.y, "north", settings.roomSize / 4));
                break;
            case "in": {
                const inTriangle = triangle.clone();
                inTriangle.rotation(-90);
                inTriangle.position(movePoint(marker.room.x, marker.room.y, "east", settings.roomSize / 4));
                markerGroup.add(inTriangle);
                triangle.rotation(90);
                triangle.position(movePoint(marker.room.x, marker.room.y, "west", settings.roomSize / 4));
                break;
            }
            case "out": {
                const outTriangle = triangle.clone();
                outTriangle.rotation(90);
                outTriangle.position(movePoint(marker.room.x, marker.room.y, "east", settings.roomSize / 4));
                markerGroup.add(outTriangle);
                triangle.rotation(-90);
                triangle.position(movePoint(marker.room.x, marker.room.y, "west", settings.roomSize / 4));
                break;
            }
        }

        markerGroup.add(triangle);
        group.add(markerGroup);
    }

    return group;
}
