import type {Settings} from "../types/Settings";
import {darkenColor, colorLightness} from "../utils/color";
import MapReader from "../reader/MapReader";

export type RoomColors = {
    fillColor: string;
    strokeColor: string;
    borderWidth: number;
    symbolColor: string;
};

export type EmbossStyle = {
    points: number[];
    stroke: string;
    strokeWidth: number;
} | null;

/**
 * Compute the fill/stroke/border colors for a room based on env color and settings.
 * This is the single source of truth — used by Konva renderer, SVG exporter, and Canvas exporter.
 */
export function computeRoomColors(
    room: MapData.Room,
    mapReader: MapReader,
    settings: Settings,
    strokeOverride?: string,
): RoomColors {
    const envColor = mapReader.getColorValue(room.env);
    const fillColor = settings.coloredMode ? darkenColor(envColor, 0.7)
        : settings.frameMode ? settings.backgroundColor : envColor;
    const strokeColor = strokeOverride
        ? ((settings.frameMode || settings.coloredMode) ? envColor : strokeOverride)
        : ((settings.frameMode || settings.coloredMode) ? envColor : settings.lineColor);
    const borderWidth = settings.borders ? settings.lineWidth : 0;
    const symbolColor = (settings.frameMode || settings.coloredMode)
        ? mapReader.getColorValue(room.env)
        : mapReader.getSymbolColor(room.env);

    return {fillColor, strokeColor, borderWidth, symbolColor};
}

/**
 * Compute the emboss effect line for a room (only for rectangle/roundedRectangle shapes).
 * Returns null if emboss is disabled or shape is circle.
 */
export function computeEmboss(settings: Settings): EmbossStyle {
    if (!settings.emboss || settings.roomShape === "circle") return null;
    const rs = settings.roomSize;
    const isLight = colorLightness(settings.lineColor) > 0.41;
    return {
        points: isLight ? [0, 0, rs, 0, rs, rs] : [0, 0, 0, rs, rs, rs],
        stroke: isLight ? '#000000' : '#ffffff',
        strokeWidth: settings.lineWidth,
    };
}
