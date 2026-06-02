const defaultRoomSize = 0.6;
const defaultLineWidth = 0.025;
const lineColor = 'rgb(225, 255, 225)';

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
 * Style configuration for room highlights.
 * Highlights are rings drawn around rooms registered via {@link MapRenderer.renderHighlight}.
 * The highlight's color is supplied per-call; this style controls everything else.
 */
export type HighlightStyle = {
    /**
     * Opacity for the highlight's stroke/ring (0.0 = fully transparent, 1.0 = fully opaque).
     */
    strokeAlpha: number;

    /**
     * Opacity for the fill (0.0 = fully transparent / hollow, 1.0 = fully opaque).
     * The fill uses the per-highlight color. Defaults to 0 to preserve the hollow ring look.
     */
    fillAlpha: number;

    /**
     * Width of the highlight stroke in map units (typically 0.01-0.3).
     */
    strokeWidth: number;

    /**
     * Size multiplier relative to the room size.
     * - 1.0 = highlight matches room size
     * - Values > 1.0 produce a ring outside the room
     * - Values < 1.0 produce a smaller marker inside the room
     */
    sizeFactor: number;

    /**
     * Dash pattern for the stroke as an array of [dash length, gap length].
     * Only applied when dashEnabled is true.
     */
    dash?: number[];

    /**
     * Whether to apply the dash pattern to the stroke.
     * When false, the stroke is solid regardless of the dash property.
     */
    dashEnabled: boolean;

    /**
     * @deprecated Use {@link shape} instead. Only consulted when `shape` is
     * `'match'` (or omitted): when true (the default) the highlight follows the
     * current roomShape (rectangle / roundedRectangle / circle); when false it
     * is always a circle.
     */
    matchRoomShape?: boolean;

    /**
     * Outline shape of the highlight. `'match'` (the default when omitted)
     * follows the current roomShape; the other values force that specific shape
     * regardless of the room's shape.
     */
    shape?: 'match' | 'rectangle' | 'roundedRectangle' | 'circle';
};


/**
 * Settings for map rendering.
 * All properties can be modified at runtime to change the map's appearance and behavior.
 * Create with {@link createSettings} and pass to the renderer constructor.
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
    /** Style configuration for room highlights (added via {@link MapRenderer.renderHighlight}). */
    highlight: HighlightStyle;
    /** Whether to render a background grid. Default: false */
    gridEnabled: boolean;
    /** Grid line spacing in map units. Default: 1 */
    gridSize: number;
    /** Color of grid lines as CSS color string. Default: 'rgba(255, 255, 255, 0.07)' */
    gridColor: string;
    /** Width of grid lines in map units. Default: 0.02 */
    gridLineWidth: number;
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
    /** When true, renders a small text label next to area-exit arrows showing the target area name.
     *  Exits leading to the same target area are grouped — one label per area at the cluster centroid. Default: false */
    areaExitLabels: boolean;
    /** Font size (in map units) for area-exit labels. Padding, corner radius, and stroke
     *  scale proportionally. Default: 0.3 */
    areaExitLabelFontSize: number;
    /** When true, drop fine detail (labels, emboss, dashes, arrowheads; rooms become
     *  flat fills) once zoom drops below {@link lodZoomThreshold}, for faster low-zoom
     *  overviews. Interactive zoom only — exports always render full detail. Default: false */
    lodEnabled: boolean;
    /** Zoom level below which level-of-detail simplification kicks in. Default: 0.4 */
    lodZoomThreshold: number;
    /** When true, drawArea() schedules a background prefetch of adjacent areas (reachable
     *  via cross-area exits) so a later switch to them is instant. Default: false */
    prefetchAdjacentAreas: boolean;
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
        highlight: {
            strokeAlpha: 1.0,
            fillAlpha: 0.0,
            strokeWidth: 0.1,
            sizeFactor: 1.425,
            dash: [0.05, 0.05],
            dashEnabled: true,
            matchRoomShape: true,
            shape: 'match',
        },
        gridEnabled: false,
        gridSize: 1,
        gridColor: 'rgba(200, 200, 200, 0.15)',
        gridLineWidth: 0.03,
        borders: true,
        frameMode: false,
        coloredMode: false,
        emboss: false,
        areaName: true,
        fontFamily: 'sans-serif',
        uniformLevelSize: false,
        areaExitLabels: false,
        areaExitLabelFontSize: 0.3,
        lodEnabled: false,
        lodZoomThreshold: 0.4,
        prefetchAdjacentAreas: false,
    };
}
