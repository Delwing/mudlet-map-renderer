import type {Settings} from "../types/Settings";
import type {IMapReader} from "../reader/MapReader";
import {computePathData} from "../PathData";
import {computeTriangleVertices} from "./InnerExitStyle";

// --- Highlight ---

export type HighlightData = {
    shape: 'circle' | 'rect';
    cx: number; cy: number;
    /** For circle: radius. For rect: half-size. */
    size: number;
    cornerRadius: number;
    strokeColor: string;
    strokeAlpha: number;
    strokeWidth: number;
    fillColor: string;
    fillAlpha: number;
    dash?: number[];
    dashEnabled: boolean;
};

export function computeHighlight(room: MapData.Room, color: string, settings: Settings): HighlightData {
    const hl = settings.highlight;
    const rs = settings.roomSize;
    const factor = hl.sizeFactor;
    const useRoomShape = hl.matchRoomShape && settings.roomShape !== "circle";
    return {
        shape: useRoomShape ? 'rect' : 'circle',
        cx: room.x,
        cy: room.y,
        size: rs / 2 * factor,
        cornerRadius: useRoomShape && settings.roomShape === "roundedRectangle" ? rs * factor * 0.2 : 0,
        strokeColor: color,
        strokeAlpha: hl.strokeAlpha,
        strokeWidth: hl.strokeWidth,
        fillColor: color,
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
    const triRadius = settings.roomSize / 5;

    const segments: PathOverlaySegment[] = [];
    for (const seg of result.segments) {
        if (seg.points.length >= 4) segments.push({points: seg.points});
    }
    for (const cl of result.customLines) {
        if (cl.points.length >= 4) segments.push({points: cl.points});
    }

    const triangles: PathOverlayTriangle[] = [];
    for (const marker of result.innerMarkers) {
        const rot = marker.direction === "up" ? 0 : marker.direction === "down" ? 180 : marker.direction === "in" ? 90 : -90;
        triangles.push({vertices: computeTriangleVertices(marker.room.x, marker.room.y, triRadius, rot)});
    }

    return {segments, triangles, color, outlineWidth: lw * 8, lineWidth: lw * 4};
}
