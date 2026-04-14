import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type {MapRenderer as MapRendererInterface} from "./MapRenderer";
import type {SvgExportOptions} from "./SvgExporter";
import {MapRenderer} from "./rendering/MapRenderer";

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

/**
 * Backward-compatible interactive renderer.
 * Delegates to the unified MapRenderer with the old constructor signature.
 *
 * New code should use MapRenderer directly:
 *   new MapRenderer(mapReader, settings, container)
 */
export class Renderer implements MapRendererInterface {
    private readonly renderer: MapRenderer;

    get settings(): Settings {
        return this.renderer.settings;
    }

    constructor(container: HTMLDivElement, mapReader: MapReader, settings?: Settings) {
        this.renderer = new MapRenderer(mapReader, settings, container);
    }

    drawArea(id: number, zIndex: number) { this.renderer.drawArea(id, zIndex); }
    getCurrentArea(): Area | undefined { return this.renderer.getCurrentArea(); }
    setPosition(roomId: number, center: boolean = true) { this.renderer.setPosition(roomId, center); }
    updatePositionMarker(roomId: number) { this.renderer.updatePositionMarker(roomId); }
    clearPosition() { this.renderer.clearPosition(); }
    centerOn(roomId: number, instant?: boolean) { this.renderer.centerOn(roomId, instant); }
    renderHighlight(roomId: number, color: string) { this.renderer.renderHighlight(roomId, color); }
    removeHighlight(roomId: number) { this.renderer.removeHighlight(roomId); }
    hasHighlight(roomId: number) { return this.renderer.hasHighlight(roomId); }
    clearHighlights() { this.renderer.clearHighlights(); }
    renderPath(locations: number[], color?: string) { this.renderer.renderPath(locations, color); }
    clearPaths() { this.renderer.clearPaths(); }
    exportSvg(options?: SvgExportOptions): string | undefined { return this.renderer.exportSvg(options); }
    exportPng(options?: { pixelRatio?: number }): string | undefined { return this.renderer.exportPng(options); }
    exportPngBlob(options?: { pixelRatio?: number }): Promise<Blob> | undefined { return this.renderer.exportPngBlob(options); }
    setZoom(zoom: number): boolean { return this.renderer.setZoom(zoom); }
    zoomToCenter(zoom: number): boolean { return this.renderer.zoomToCenter(zoom); }
    getZoom() { return this.renderer.getZoom(); }
    getViewportBounds(): ViewportBounds { return this.renderer.getViewportBounds(); }
    getAreaBounds(): ViewportBounds | null { return this.renderer.getAreaBounds(); }
    fitArea() { this.renderer.fitArea(); }
    get centerOnResize(): boolean { return this.renderer.centerOnResize; }
    set centerOnResize(value: boolean) { this.renderer.centerOnResize = value; }
    get minZoom(): number { return this.renderer.minZoom; }
    set minZoom(value: number) { this.renderer.minZoom = value; }
    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void { this.renderer.on(event, handler); }
    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void { this.renderer.off(event, handler); }
    setCullingMode(mode: CullingMode) { this.renderer.setCullingMode(mode); }
    getCullingMode() { return this.renderer.getCullingMode(); }
    refreshCurrentRoomOverlay() { this.renderer.refreshCurrentRoomOverlay(); }
    updateBackground() { this.renderer.updateBackground(); }
    refresh() { this.renderer.refresh(); }
}