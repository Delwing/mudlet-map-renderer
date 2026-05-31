import type {Settings} from "../types/Settings";
import type {IMapReader} from "../reader/MapReader";
import {computePathData} from "../PathData";
import {computeInnerExitTrianglesForDirection} from "./InnerExitStyle";

// --- Highlight ---

export type HighlightData = {
    shape: 'circle' | 'rect';
    cx: number; cy: number;
    /** For circle: radius. For rect: half-size. */
    size: number;
    cornerRadius: number;
    /**
     * One or more colours. A single colour draws the classic ring/marker; two
     * or more split the highlight into that many equal pie wedges (one colour
     * each).
     */
    colors: string[];
    strokeAlpha: number;
    strokeWidth: number;
    fillAlpha: number;
    dash?: number[];
    dashEnabled: boolean;
};

/**
 * Resolve the concrete highlight outline shape. `'match'` follows the
 * highlight's {@link HighlightStyle.matchRoomShape} flag against the current
 * roomShape (circle rooms fall back to a circle highlight); any other value
 * forces that shape explicitly.
 */
function resolveHighlightShapeKind(
    hl: Settings['highlight'],
    roomShape: Settings['roomShape'],
): 'rectangle' | 'roundedRectangle' | 'circle' {
    const sel = hl.shape ?? 'match';
    if (sel !== 'match') return sel;
    const matchRoom = hl.matchRoomShape ?? true;
    if (matchRoom && roomShape !== "circle") {
        return roomShape === "roundedRectangle" ? 'roundedRectangle' : 'rectangle';
    }
    return 'circle';
}

export function computeHighlight(room: MapData.Room, color: string | string[], settings: Settings): HighlightData {
    const hl = settings.highlight;
    const rs = settings.roomSize;
    const factor = hl.sizeFactor;
    const kind = resolveHighlightShapeKind(hl, settings.roomShape);
    const colors = Array.isArray(color) ? (color.length > 0 ? [...color] : ['#ffffff']) : [color];
    return {
        shape: kind === 'circle' ? 'circle' : 'rect',
        cx: room.x,
        cy: room.y,
        size: rs / 2 * factor,
        cornerRadius: kind === 'roundedRectangle' ? rs * factor * 0.2 : 0,
        colors,
        strokeAlpha: hl.strokeAlpha,
        strokeWidth: hl.strokeWidth,
        fillAlpha: hl.fillAlpha,
        dash: hl.dash,
        dashEnabled: hl.dashEnabled,
    };
}

// --- Position Marker ---

export type PositionMarkerData = {
    shape: 'circle' | 'rect';
    cx: number; cy: number;
    size: number;
    cornerRadius: number;
    strokeColor: string;
    strokeWidth: number;
    strokeAlpha: number;
    fillColor: string;
    fillAlpha: number;
    dash?: number[];
    dashEnabled: boolean;
};

export function computePositionMarker(room: MapData.Room, settings: Settings): PositionMarkerData {
    const pm = settings.playerMarker;
    const size = settings.roomSize * pm.sizeFactor;
    const useRoomShape = pm.matchRoomShape && settings.roomShape !== "circle";
    return {
        shape: useRoomShape ? 'rect' : 'circle',
        cx: room.x,
        cy: room.y,
        size: size / 2,
        cornerRadius: useRoomShape && settings.roomShape === "roundedRectangle" ? size * 0.2 : 0,
        strokeColor: pm.strokeColor,
        strokeWidth: pm.strokeWidth,
        strokeAlpha: pm.strokeAlpha,
        fillColor: pm.fillColor,
        fillAlpha: pm.fillAlpha,
        dash: pm.dash,
        dashEnabled: pm.dashEnabled,
    };
}

// --- Path Overlay ---

export type PathOverlaySegment = {
    points: number[];
};

export type PathOverlayTriangle = {
    vertices: number[];
};

export type PathOverlayData = {
    segments: PathOverlaySegment[];
    triangles: PathOverlayTriangle[];
    color: string;
    outlineWidth: number;
    lineWidth: number;
};

export function computePathOverlay(
    mapReader: IMapReader,
    settings: Settings,
    locations: number[],
    color: string,
    areaId: number,
    zIndex: number,
): PathOverlayData {
    const result = computePathData(mapReader, settings, locations, areaId, zIndex);
    const lw = settings.lineWidth;

    const segments: PathOverlaySegment[] = [];
    for (const seg of result.segments) {
        if (seg.points.length >= 4) segments.push({points: seg.points});
    }
    for (const cl of result.customLines) {
        if (cl.points.length >= 4) segments.push({points: cl.points});
    }

    const triangles: PathOverlayTriangle[] = [];
    for (const marker of result.innerMarkers) {
        for (const tri of computeInnerExitTrianglesForDirection(marker.room, marker.direction, settings)) {
            triangles.push({vertices: tri.vertices});
        }
    }

    return {segments, triangles, color, outlineWidth: lw * 8, lineWidth: lw * 4};
}
