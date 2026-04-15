import type {Settings} from "../types/Settings";
import {darkenColor, lightenColor, colorLightness} from "../utils/color";
import MapReader from "../reader/MapReader";

export type RoomColors = {
    fillColor: string;
    strokeColor: string;
    borderWidth: number;
    symbolColor: string;
    envColor: string;
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
    const fillColor = settings.coloredMode ? darkenColor(envColor, 0.5)
        : settings.frameMode ? settings.backgroundColor : envColor;
    const brightEnvColor = settings.coloredMode ? lightenColor(envColor, 0.1) : envColor;
    const strokeColor = strokeOverride
        ? ((settings.frameMode || settings.coloredMode) ? brightEnvColor : strokeOverride)
        : ((settings.frameMode || settings.coloredMode) ? brightEnvColor : settings.lineColor);
    const borderWidth = settings.borders ? settings.lineWidth : 0;
    const symbolColor = (settings.frameMode || settings.coloredMode)
        ? brightEnvColor
        : mapReader.getSymbolColor(room.env);

    return {fillColor, strokeColor, borderWidth, symbolColor, envColor};
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
