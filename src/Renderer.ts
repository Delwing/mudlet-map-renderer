import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";
import Area from "./reader/Area";
import Plane from "./reader/Plane";
import ExplorationArea from "./reader/ExplorationArea";
import PathRenderer from "./PathRenderer";
import {SvgExporter} from "./SvgExporter";
import type {SvgExportOptions} from "./SvgExporter";
import type {MapRenderer} from "./MapRenderer";
import {ViewportManager} from "./ViewportManager";
import {RoomShapeRenderer} from "./RoomShapeRenderer";
import {GridRenderer} from "./GridRenderer";
import {InteractionHandler} from "./InteractionHandler";
import {CullingManager} from "./CullingManager";
import type {RoomNodeEntry, StandaloneExitEntry} from "./CullingManager";
import {TypedEventEmitter} from "./TypedEventEmitter";
import {drawExitDataToCanvas} from "./scene/ExitDataRenderer";

const defaultRoomSize = 0.6;
const defaultLineWidth = 0.025;
const lineColor = 'rgb(225, 255, 225)';
const currentRoomColor = 'rgb(120, 72, 0)';

export function colorLightness(color: string): number {
    let r: number, g: number, b: number;
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]) / 255;
        g = parseInt(rgbMatch[2]) / 255;
        b = parseInt(rgbMatch[3]) / 255;
    } else if (color.startsWith('#') && color.length >= 7) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    } else {
        return 0.5;
    }
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

export function darkenColor(color: string, factor: number): string {
    let r: number, g: number, b: number;
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
    } else if (color.startsWith('#') && color.length >= 7) {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
    } else {
        return color;
    }
    r = Math.round(r * (1 - factor));
    g = Math.round(g * (1 - factor));
    b = Math.round(b * (1 - factor));
    return `rgb(${r}, ${g}, ${b})`;
}

export type PerfSnapshot = {
    /** Total updateRoomCulling time in ms */
    cullingMs: number;
    /** renderGrid time in ms (subset of culling) */
    gridMs: number;
    /** Number of visible rooms after culling */
    visibleRooms: number;
    /** Total room count */
    totalRooms: number;
    /** Number of visible standalone exits */
    visibleExits: number;
    /** Estimated FPS based on time between culling calls */
    fps: number;
};

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type LabelRenderMode = "image" | "data" | "none";

export type CullingMode = "none" | "basic" | "indexed";

export type RoomShape = "rectangle" | "circle" | "roundedRectangle";

export type RoomContextMenuEventDetail = {
    roomId: number;
    position: { x: number; y: number };
};

export type RoomClickEventDetail = {
    roomId: number;
    position: { x: number; y: number };
};

export type ZoomChangeEventDetail = {
    zoom: number;
};

export type AreaExitClickEventDetail = {
    targetRoomId: number;
    position: { x: number; y: number };
};

export type ViewportBounds = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};

export type PanEventDetail = ViewportBounds;

export type RendererEventMap = {
    roomclick: RoomClickEventDetail;
    roomcontextmenu: RoomContextMenuEventDetail;
    areaexitclick: AreaExitClickEventDetail;
    mapclick: undefined;
    pan: PanEventDetail;
    zoom: ZoomChangeEventDetail;
};

/**
 * Style configuration for the player position marker.
 * The player marker is a circle that indicates the current player position on the map.
 */
export type PlayerMarkerStyle = {
    /**
     * Hex color for the marker's stroke/border (e.g., "#00e5b2" for cyan-green).
     */
    strokeColor: string;

    /**
     * Opacity for the stroke/border (0.0 = fully transparent, 1.0 = fully opaque).
     */
    strokeAlpha: number;

    /**
     * Hex color for the marker's fill (e.g., "#00e5b2" for cyan-green).
     */
    fillColor: string;

    /**
     * Opacity for the fill (0.0 = fully transparent, 1.0 = fully opaque).
     * Setting this to 0 creates a hollow circle effect.
     */
    fillAlpha: number;

    /**
     * Width of the marker's stroke/border in map units (typically 0.01-0.3).
     */
    strokeWidth: number;

    /**
     * Size multiplier relative to the room size.
     * - 1.0 = marker radius equals room radius (matches room size)
     * - Values > 1.0 make the marker larger than rooms
     * - Values < 1.0 make the marker smaller than rooms
     *
     * Note: Room circles have radius = roomSize / 2, so sizeFactor is applied to that radius.
     */
    sizeFactor: number;

    /**
     * Dash pattern for the stroke as an array of [dash length, gap length].
     * Example: [0.05, 0.05] creates evenly spaced dashes.
     * Only applied when dashEnabled is true.
     */
    dash?: number[];

    /**
     * Whether to apply the dash pattern to the stroke.
     * When false, the stroke is solid regardless of the dash property.
     */
    dashEnabled: boolean;

    /**
     * When true, the marker shape matches the current roomShape setting
     * (rectangle, circle, or roundedRectangle) instead of always being a circle.
     */
    matchRoomShape: boolean;
};

/**
 * Settings for map rendering.
 * All properties can be modified at runtime to change the map's appearance and behavior.
 * Create with {@link createSettings} and pass to the {@link Renderer} constructor.
 * Multiple renderers can share the same settings object for synchronized configuration.
 */
export type Settings = {
    /** Size of each room in map units (width/height for rectangles, diameter for circles). Default: 0.6 */
    roomSize: number;
    /** Width of lines (exit connections, room borders) in map units. Default: 0.025 */
    lineWidth: number;
    /** Color of exit connection lines as RGB string. Default: 'rgb(225, 255, 225)' */
    lineColor: string;
    /** Background color of the map container. Default: '#000000' */
    backgroundColor: string;
    /** When true, map instantly jumps to new position on room change. Default: false */
    instantMapMove: boolean;
    /** When true, highlights the current room and its exits with an overlay. Default: true */
    highlightCurrentRoom: boolean;
    /** Legacy flag for enabling/disabling culling (prefer cullingMode). Default: true */
    cullingEnabled: boolean;
    /** How off-screen elements are culled: "none" | "basic" | "indexed". Default: "indexed" */
    cullingMode: CullingMode;
    /** Custom culling bounds in map coordinates, or null for viewport bounds. Default: null */
    cullingBounds: { x: number; y: number; width: number; height: number } | null;
    /** How to render room labels: "image" | "data". Default: "image" */
    labelRenderMode: LabelRenderMode;
    /** When true, room labels have transparent backgrounds. Default: false */
    transparentLabels: boolean;
    /** Shape used to render rooms: "rectangle" | "circle" | "roundedRectangle". Default: "rectangle" */
    roomShape: RoomShape;
    /** Style configuration for the player position marker. */
    playerMarker: PlayerMarkerStyle;
    /** Whether to render a background grid. Default: false */
    gridEnabled: boolean;
    /** Grid line spacing in map units. Default: 1 */
    gridSize: number;
    /** Color of grid lines as CSS color string. Default: 'rgba(255, 255, 255, 0.07)' */
    gridColor: string;
    /** Width of grid lines in map units. Default: 0.02 */
    gridLineWidth: number;
    /** Performance monitoring callback, or null to disable. */
    perfCallback: ((stats: PerfSnapshot) => void) | null;
    /** Whether to draw borders (strokes) on rooms. Default: true */
    borders: boolean;
    /** When true, rooms use frame rendering: fill=backgroundColor, stroke=envColor. Default: false */
    frameMode: boolean;
    /** When true, rooms use colored rendering: fill=envColor darkened 30%, stroke=envColor. Default: false */
    coloredMode: boolean;
    /** When true, rooms display a 3D emboss effect (rectangle/roundedRectangle only). Default: false */
    emboss: boolean;
    /** When true, displays the area name as a header text on the map. Default: false */
    areaName: boolean;
    /** Font family for the area name header. Default: 'sans-serif' */
    fontFamily: string;
    /** When true, uses bounds from all z-levels for viewport sizing, not just the current level. Default: false */
    uniformLevelSize: boolean;
};

/** Creates a new Settings object with default values. */
export function createSettings(): Settings {
    return {
        roomSize: defaultRoomSize,
        lineWidth: defaultLineWidth,
        lineColor: lineColor,
        backgroundColor: '#000000',
        instantMapMove: false,
        highlightCurrentRoom: true,
        cullingEnabled: true,
        cullingMode: "indexed",
        cullingBounds: null,
        labelRenderMode: "image",
        transparentLabels: false,
        roomShape: "rectangle",
        playerMarker: {
            strokeColor: "#00e5b2",
            strokeAlpha: 1.0,
            fillColor: "#00e5b2",
            fillAlpha: 0.0,
            strokeWidth: 0.1,
            sizeFactor: 1.7,
            dash: [0.05, 0.05],
            dashEnabled: true,
            matchRoomShape: false,
        },
        gridEnabled: false,
        gridSize: 1,
        gridColor: 'rgba(200, 200, 200, 0.15)',
        gridLineWidth: 0.03,
        perfCallback: null,
        borders: true,
        frameMode: false,
        coloredMode: false,
        emboss: false,
        areaName: true,
        fontFamily: 'sans-serif',
        uniformLevelSize: false,
    };
}

type HighlightData = {
    color: string;
    area: number;
    z: number;
    shape?: Konva.Shape;
};

type AreaExitHitZone = { bounds: { x: number; y: number; width: number; height: number }; targetRoomId: number };

export class Renderer implements MapRenderer {

    private readonly events: TypedEventEmitter<RendererEventMap>;
    private readonly stage: Konva.Stage;
    private readonly gridLayer: Konva.Layer;
    private readonly roomLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly overlayLayer: Konva.Layer;
    private readonly positionLayer: Konva.Layer;
    private mapReader: MapReader;
    readonly settings: Settings;
    private exitRenderer: ExitRenderer;
    private pathRenderer: PathRenderer;
    private highlights: Map<number, HighlightData> = new Map();
    private currentArea?: number;
    private currentAreaInstance?: Area;
    private currentZIndex?: number;
    private currentAreaVersion?: number;
    private currentRoomId?: number;
    private positionRender?: Konva.Shape;
    private currentRoomOverlay: Konva.Node[] = [];

    private readonly viewport: ViewportManager;
    private readonly roomShapeRenderer: RoomShapeRenderer;
    private readonly gridRenderer: GridRenderer;
    private readonly culling: CullingManager;
    private exitBatchShape?: Konva.Shape;
    private areaExitHitZones: AreaExitHitZone[] = [];

    constructor(container: HTMLDivElement, mapReader: MapReader, settings?: Settings) {
        this.settings = settings ?? createSettings();
        this.events = new TypedEventEmitter<RendererEventMap>(container);
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        container.style.backgroundColor = this.settings.backgroundColor;
        this.gridLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.gridLayer);
        this.linkLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.linkLayer);
        this.roomLayer = new Konva.Layer();
        this.stage.add(this.roomLayer);
        this.positionLayer = new Konva.Layer({ listening: false });
        this.stage.add(this.positionLayer);
        this.overlayLayer = new Konva.Layer({ listening: false })
        this.stage.add(this.overlayLayer);
        this.mapReader = mapReader;
        this.exitRenderer = new ExitRenderer(mapReader, this.settings);
        this.pathRenderer = new PathRenderer(mapReader, this.overlayLayer, this.settings);
        this.roomShapeRenderer = new RoomShapeRenderer(mapReader, this.settings);
        this.gridRenderer = new GridRenderer(this.gridLayer, this.settings);

        this.viewport = new ViewportManager(this.stage, container, this.settings, {
            scheduleCulling: () => this.culling.scheduleCulling(),
            onResize: () => {
                if (this.currentRoomId) {
                    const room = this.mapReader.getRoom(this.currentRoomId);
                    if (room) this.viewport.panToMapPoint(room.x, room.y, false);
                }
            },
        }, this.events);

        this.culling = new CullingManager(
            this.stage, this.roomLayer, this.linkLayer,
            this.settings, this.gridRenderer, this.viewport,
        );

        new InteractionHandler(this.stage, container, this.settings, {
            clientToMapPoint: (cx, cy) => this.viewport.clientToMapPoint(cx, cy),
            findRoomAtPoint: (mx, my) => this.culling.findRoomAtMapPoint(mx, my),
            getAreaExitHitZones: () => this.areaExitHitZones,
        }, this.events);
    }


    drawArea(id: number, zIndex: number) {
        const area = this.mapReader.getArea(id);
        if (!area) {
            return;
        }
        const plane = area.getPlane(zIndex);
        if (!plane) {
            return;
        }
        this.currentArea = id;
        this.currentAreaInstance = area;
        this.currentZIndex = zIndex;
        this.currentAreaVersion = area.getVersion();
        this.clearCurrentRoomOverlay();
        if (this.positionRender) {
            this.positionRender.destroy();
            this.positionRender = undefined;
        }
        this.positionLayer.destroyChildren();
        this.gridLayer.destroyChildren();
        this.gridRenderer.invalidateCache();
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();
        this.culling.clear();
        this.areaExitHitZones = [];
        this.exitBatchShape = undefined;
        this.culling.computeBucketSize();

        this.viewport.applyScale();

        this.gridRenderer.render(this.viewport.getViewportBounds());
        this.renderLabels(plane.getLabels());
        this.renderExits(area.getLinkExits(zIndex));
        this.renderRooms(plane.getRooms() ?? []);
        this.renderAreaName(area, plane);
        this.refreshHighlights();
        // Run culling synchronously so visibleExitDrawData is populated
        // before the first paint, preventing a 1-frame blink.
        this.culling.updateCulling();
        this.stage.batchDraw();
    }

    /**
     * Export the currently displayed area as an SVG string.
     * @param options - Optional room focus and padding
     * @returns SVG string, or undefined if no area is displayed
     */
    exportSvg(options?: SvgExportOptions): string | undefined {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;
        const exporter = new SvgExporter(this.mapReader, this.settings);
        return exporter.export(this.currentArea, this.currentZIndex, options);
    }

    /**
     * Export the currently displayed canvas as a PNG data URL.
     * @param options - pixelRatio for resolution (default 1), mimeType override
     * @returns data URL string, or undefined if no area is displayed
     */
    exportPng(options?: { pixelRatio?: number }): string | undefined {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;
        const pixelRatio = options?.pixelRatio ?? 1;
        const stageCanvas = this.stage.toCanvas({pixelRatio});
        const composite = document.createElement('canvas');
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite.toDataURL('image/png');
    }

    /**
     * Export the currently displayed canvas as a PNG Blob.
     * @param options - pixelRatio for resolution (default 1)
     * @returns Promise resolving to a Blob, or undefined if no area is displayed
     */
    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;
        const pixelRatio = options?.pixelRatio ?? 1;
        const stageCanvas = this.stage.toCanvas({pixelRatio});
        const composite = document.createElement('canvas');
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return new Promise<Blob>((resolve) => {
            composite.toBlob((blob: Blob | null) => { if (blob) resolve(blob); }, 'image/png');
        });
    }

    setZoom(zoom: number): boolean {
        return this.viewport.setZoom(zoom);
    }

    zoomToCenter(zoom: number): boolean {
        return this.viewport.zoomToCenter(zoom);
    }

    getZoom() {
        return this.viewport.getZoom();
    }

    getViewportBounds(): ViewportBounds {
        return this.viewport.getViewportBounds();
    }

    getAreaBounds(): ViewportBounds | null {
        if (!this.currentAreaInstance || this.currentZIndex === undefined) return null;
        const plane = this.currentAreaInstance.getPlane(this.currentZIndex);
        if (!plane) return null;
        const b = this.getEffectiveBounds(this.currentAreaInstance, plane);
        const hasAreaName = this.settings.areaName && this.currentAreaInstance.getAreaName();
        return {
            minX: hasAreaName ? b.minX - 4 : b.minX,
            maxX: b.maxX,
            minY: hasAreaName ? b.minY - 7 : b.minY,
            maxY: b.maxY,
        };
    }

    fitArea() {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.viewport.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
    }

    get centerOnResize(): boolean {
        return this.viewport.centerOnResize;
    }

    set centerOnResize(value: boolean) {
        this.viewport.centerOnResize = value;
    }

    get minZoom(): number {
        return this.viewport.minZoom;
    }

    set minZoom(value: number) {
        this.viewport.minZoom = value;
    }

    /**
     * Subscribe to a typed renderer event.
     * Also works alongside legacy container.addEventListener() for backwards compat.
     */
    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.events.off(event, handler);
    }

    setCullingMode(mode: CullingMode) {
        this.settings.cullingMode = mode;
        this.settings.cullingEnabled = mode !== "none";
        this.culling.scheduleCulling();
    }

    getCullingMode() {
        return this.settings.cullingMode;
    }

    getCurrentArea() {
        return this.currentArea ? this.mapReader.getArea(this.currentArea) : undefined
    }

    /**
     * Refreshes the current room overlay to reflect any changes to settings.
     * Call this after modifying Settings properties (like roomSize, roomShape, lineWidth, etc.)
     * to update the visual appearance of the current room and its exits without changing position.
     */
    refreshCurrentRoomOverlay() {
        if (this.currentRoomId !== undefined) {
            const room = this.mapReader.getRoom(this.currentRoomId);
            if (room) {
                this.updateCurrentRoomOverlay(room);
            }
        }
    }

    /**
     * Completely refreshes the map to reflect changes to settings.
     * This re-renders the entire current area and updates the player position marker.
     * Call this after changing Settings properties like roomSize, roomShape, lineWidth, etc.
     *
     * Note: This is more expensive than refreshCurrentRoomOverlay() but ensures everything is updated.
     */
    updateBackground() {
        this.stage.container().style.backgroundColor = this.settings.backgroundColor;
    }

    refresh() {
        this.updateBackground();
        if (this.currentArea !== undefined && this.currentZIndex !== undefined) {
            this.drawArea(this.currentArea, this.currentZIndex);

            if (this.currentRoomId !== undefined) {
                this.setPosition(this.currentRoomId);
            }
        }
    }

    /**
     * Updates the player position marker without centering the view.
     * Use this when you want to show where the player is without moving the viewport.
     */
    updatePositionMarker(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;

        // Only show marker if player is in the currently displayed area/level
        if (room.area !== this.currentArea || room.z !== this.currentZIndex) {
            // Hide the marker if player is not on current area/level
            if (this.positionRender) {
                this.positionRender.hide();
                this.positionLayer.batchDraw();
            }
            return;
        }

        this.currentRoomId = roomId;
        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
        this.positionLayer.batchDraw();
    }

    setPosition(roomId: number, center: boolean = true) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        let instant = this.currentArea !== room.area || this.currentZIndex !== room.z
        if (
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        ) {
            this.drawArea(room.area, room.z);
        }
        if (center) {
            this.centerOnRoom(room, instant);
        } else {
            this.currentRoomId = roomId;
        }
        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        const pm = this.settings.playerMarker;
        const strokeColor = hexToRgba(pm.strokeColor, pm.strokeAlpha);
        const fillColor = hexToRgba(pm.fillColor, pm.fillAlpha);
        const markerSize = this.settings.roomSize * pm.sizeFactor;
        const halfSize = markerSize / 2;

        if (this.positionRender) {
            this.positionRender.destroy();
        }

        const useRoomShape = pm.matchRoomShape && this.settings.roomShape !== "circle";
        if (useRoomShape) {
            const cr = this.settings.roomShape === "roundedRectangle" ? markerSize * 0.2 : 0;
            this.positionRender = new Konva.Rect({
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
        } else {
            this.positionRender = new Konva.Circle({
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
        this.positionLayer.add(this.positionRender);
    }

    clearPosition() {
        this.currentRoomId = undefined;
        if (this.positionRender) {
            this.positionRender.destroy();
            this.positionRender = undefined;
        }
        this.positionLayer.batchDraw();
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.overlayLayer.batchDraw();
    }

    centerOn(roomId: number, instant?: boolean) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        const areaChanged = this.currentArea !== room.area || this.currentZIndex !== room.z;
        if (
            areaChanged ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        ) {
            this.drawArea(room.area, room.z);
        }
        this.centerOnRoomView(room, instant ?? areaChanged);
    }

    renderPath(locations: number[], color?: string) {
        return this.pathRenderer.renderPath(locations, this.currentArea, this.currentZIndex, color);
    }

    clearPaths() {
        this.pathRenderer.clearPaths();
    }

    renderHighlight(roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) {
            return;
        }

        const existing = this.highlights.get(roomId);
        if (existing?.shape) {
            existing.shape.destroy();
            delete existing.shape;
        }

        const highlightData: HighlightData = {color, area: room.area, z: room.z};

        this.highlights.set(roomId, highlightData);

        if (room.area === this.currentArea && room.z === this.currentZIndex) {
            const shape = this.createHighlightShape(room, color);
            this.overlayLayer.add(shape);
            highlightData.shape = shape;
            this.overlayLayer.batchDraw();
            return shape;
        }

        return highlightData.shape;
    }

    removeHighlight(roomId: number) {
        const existing = this.highlights.get(roomId);
        if (!existing) return;
        existing.shape?.destroy();
        this.highlights.delete(roomId);
        this.overlayLayer.batchDraw();
    }

    hasHighlight(roomId: number) {
        return this.highlights.has(roomId);
    }

    clearHighlights() {
        this.highlights.forEach(({shape}) => shape?.destroy());
        this.highlights.clear();
        this.overlayLayer.batchDraw();
    }

    private refreshHighlights() {
        this.highlights.forEach((highlight, roomId) => {
            highlight.shape?.destroy();
            delete highlight.shape;

            if (highlight.area !== this.currentArea || highlight.z !== this.currentZIndex) {
                return;
            }

            const room = this.mapReader.getRoom(roomId);
            if (!room) {
                return;
            }

            const shape = this.createHighlightShape(room, highlight.color);
            this.overlayLayer.add(shape);
            highlight.shape = shape;
        });

        this.overlayLayer.batchDraw();
    }

    private createHighlightShape(room: MapData.Room, color: string) {
        const highlightFactor = 1.5;
        return this.settings.roomShape === "circle"
            ? new Konva.Circle({
                x: room.x,
                y: room.y,
                radius: this.settings.roomSize / 2 * highlightFactor,
                stroke: color,
                strokeWidth: 0.1,
                dash: [0.05, 0.05],
                dashEnabled: true,
                listening: false,
            })
            : new Konva.Rect({
                x: room.x - this.settings.roomSize / 2 * highlightFactor,
                y: room.y - this.settings.roomSize / 2 * highlightFactor,
                width: this.settings.roomSize * highlightFactor,
                height: this.settings.roomSize * highlightFactor,
                stroke: color,
                strokeWidth: 0.1,
                dash: [0.05, 0.05],
                dashEnabled: true,
                cornerRadius: this.settings.roomShape === "roundedRectangle" ? this.settings.roomSize * highlightFactor * 0.2 : 0,
                listening: false,
            });
    }

    private centerOnRoom(room: MapData.Room, instant: boolean = false) {
        this.currentRoomId = room.id;

        if (this.positionRender) {
            if (this.positionRender instanceof Konva.Rect) {
                const halfSize = this.positionRender.width() / 2;
                this.positionRender.position({ x: room.x - halfSize, y: room.y - halfSize });
            } else {
                this.positionRender.position(room);
            }
        }

        this.viewport.panToMapPoint(room.x, room.y, instant);
    }

    private centerOnRoomView(room: MapData.Room, instant: boolean = false) {
        this.viewport.panToMapPoint(room.x, room.y, instant);
    }

    private getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
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

    private renderRooms(rooms: MapData.Room[]) {
        rooms.forEach(room => {
            const roomRender = this.roomShapeRenderer.createRoomGroup(room);
            this.roomLayer.add(roomRender);

            // Special exits stored as draw data for batch rendering
            this.exitRenderer.renderSpecialExits(room).forEach(render => {
                this.linkLayer.add(render);
            })
            // Track cross-area custom line hit zones
            this.exitRenderer.getSpecialExitAreaTargets(room).forEach(zone => {
                this.areaExitHitZones.push(zone);
            });
            // Stubs and inner exits nested in room group for automatic culling
            const gx = room.x - this.settings.roomSize / 2;
            const gy = room.y - this.settings.roomSize / 2;
            this.exitRenderer.renderStubs(room).forEach(render => {
                // Offset absolute points to group-relative coordinates
                const pts = render.points();
                for (let i = 0; i < pts.length; i += 2) {
                    pts[i] -= gx;
                    pts[i + 1] -= gy;
                }
                render.points(pts);
                roomRender.add(render);
            })
            this.exitRenderer.renderInnerExits(room).forEach(render => {
                render.position({ x: -gx, y: -gy });
                roomRender.add(render);
            })

            const entry: RoomNodeEntry = {room, group: roomRender};
            this.culling.roomNodes.set(room.id, entry);
            this.culling.addRoomToSpatialIndex(entry);
        })
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.positionLayer.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.currentArea || room.z !== this.currentZIndex) {
            this.positionLayer.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        const preRoomNodes: Array<Konva.Group | Konva.Shape> = [];

        const explorationArea =
            this.currentAreaInstance instanceof ExplorationArea ? this.currentAreaInstance : undefined;

        if (this.currentAreaInstance && this.currentZIndex !== undefined) {
            const exits = this.currentAreaInstance
                .getLinkExits(this.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const render = this.settings.highlightCurrentRoom
                    ? this.exitRenderer.renderWithColor(exit, currentRoomColor, this.currentZIndex!)
                    : this.exitRenderer.render(exit, this.currentZIndex!);
                if (render) {
                    preRoomNodes.push(render);
                }
            });
        }

        const highlightColor = this.settings.highlightCurrentRoom ? currentRoomColor : undefined;


        this.exitRenderer.renderSpecialExits(room, highlightColor).forEach(render => {
            preRoomNodes.push(render);
        });

        const stubs = this.settings.highlightCurrentRoom
            ? this.exitRenderer.renderStubs(room, currentRoomColor)
            : this.exitRenderer.renderStubs(room);
        stubs.forEach(render => {
            preRoomNodes.push(render);
        });

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.mapReader.getRoom(id);
            const canRenderOtherRoom =
                !explorationArea || explorationArea.hasVisitedRoom(id);

            if (
                otherRoom &&
                otherRoom.area === this.currentArea &&
                otherRoom.z === this.currentZIndex &&
                canRenderOtherRoom) {
                roomsToRedraw.set(id, otherRoom)
            }
        })

        preRoomNodes.forEach(node => {
            this.positionLayer.add(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayRoom = this.createOverlayRoomGroup(
                roomToRedraw,
                {
                    stroke: isCurrent && this.settings.highlightCurrentRoom ? currentRoomColor : this.settings.lineColor,
                }
            );
            this.positionLayer.add(overlayRoom);
            this.currentRoomOverlay.push(overlayRoom);

            this.exitRenderer.renderInnerExits(roomToRedraw).forEach(render => {
                this.positionLayer.add(render);
                this.currentRoomOverlay.push(render);
            });
        });

        // Move the position circle to the top so it draws over the overlay
        if (this.positionRender) {
            this.positionRender.moveToTop();
        }

        this.positionLayer.batchDraw();
    }

    private createOverlayRoomGroup(room: MapData.Room, options: {
        stroke: string;
    }) {
        return this.roomShapeRenderer.createRoomGroup(room, {
            strokeOverride: options.stroke,
        });
    }

    private renderExits(exits: Exit[]) {
        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, this.currentZIndex!);
            if (!data) {
                return;
            }
            const entry: StandaloneExitEntry = { data, bounds: data.bounds, targetRoomId: data.targetRoomId };
            this.culling.standaloneExitNodes.push(entry);
            this.culling.addStandaloneExitToSpatialIndex(entry);
            if (data.targetRoomId !== undefined) {
                this.areaExitHitZones.push({ bounds: data.bounds, targetRoomId: data.targetRoomId });
            }
        });

        this.culling.setExitBoundsRoomSize();

        // Create a single batched shape for drawing all visible exits
        this.exitBatchShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context;
                for (const data of this.culling.visibleExitDrawData) {
                    drawExitDataToCanvas(ctx, data);
                }
            },
        });
        this.linkLayer.add(this.exitBatchShape);
    }

    private renderLabels(Labels: MapData.Label[]) {
        if (this.settings.labelRenderMode === "none") return;
        Labels.forEach(label => {
            if (this.settings.labelRenderMode === "image") {
                if (!label.pixMap) {
                    return;
                }

                const image = new Image();
                image.src = `data:image/png;base64,${label.pixMap}`;
                const labelRender = new Konva.Image({
                    x: label.X,
                    y: -label.Y,
                    width: label.Width,
                    height: label.Height,
                    image: image,
                    listening: false,
                });
                this.linkLayer.add(labelRender);
                return;
            }

            this.renderLabelAsData(label);
        });
    }

    private renderLabelAsData(label: MapData.Label) {
        const labelRender = new Konva.Group({
            listening: false,
        });

        const background = new Konva.Rect({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            listening: false,
        });

        if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
            background.fill(this.getLabelColor(label.BgColor));
        } else {
            background.fillEnabled(false);
        }

        labelRender.add(background);

        const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
        const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

        const text = new Konva.Text({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            text: label.Text,
            fontSize,
            fillEnabled: true,
            fill: this.getLabelColor(label.FgColor),
            align: "center",
            verticalAlign: "middle",
            listening: false,
        });

        labelRender.add(text);

        this.linkLayer.add(labelRender);
    }

    private getLabelColor(color: MapData.Color): string {
        const alpha = (color?.alpha ?? 255) / 255;
        const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
        return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
    }


}