import type {Settings} from "../types/Settings";
import {darkenColor, lightenColor} from "../utils/color";
import type {IMapReader} from "../reader/MapReader";
import {getRoomBorderColor, getRoomBorderThickness} from "./RoomFlags";

export type RoomColors = {
    fillColor: string;
    strokeColor: string;
    borderWidth: number;
    symbolColor: string;
    envColor: string;
    /** True when the room carries an explicit per-room border colour (userData). */
    customBorder: boolean;
};

export type EmbossEdge = {
    points: number[];
    stroke: string;
    strokeWidth: number;
    lineCap?: string;
    lineJoin?: string;
};

export type EmbossStyle = {
    highlight: EmbossEdge;
    shadow: EmbossEdge;
} | null;

/**
 * Compute the fill/stroke/border colors for a room based on env color and settings.
 * This is the single source of truth — used by Konva renderer, SVG exporter, and Canvas exporter.
 */
export function computeRoomColors(
    room: MapData.Room,
    mapReader: IMapReader,
    settings: Settings,
    strokeOverride?: string,
): RoomColors {
    const envColor = mapReader.getColorValue(room.env);
    const fillColor = settings.coloredMode ? darkenColor(envColor, 0.5)
        : settings.frameMode ? settings.backgroundColor : envColor;
    const brightEnvColor = settings.coloredMode ? lightenColor(envColor, 0.1) : envColor;
    let strokeColor = strokeOverride
        ? ((settings.frameMode || settings.coloredMode) ? brightEnvColor : strokeOverride)
        : ((settings.frameMode || settings.coloredMode) ? brightEnvColor : settings.lineColor);
    let borderWidth = settings.borders ? settings.lineWidth : 0;

    // Per-room border overrides (Mudlet "room.ui.border_color" / "room.ui.border_thickness").
    // An explicit per-room border wins over the global/env-derived stroke and is
    // drawn even when global borders are off — matching Mudlet, where a room's
    // border colour overrides the map border colour for that room.
    const borderColor = getRoomBorderColor(room);
    const borderThickness = getRoomBorderThickness(room);
    if (borderColor) strokeColor = borderColor;
    if (borderThickness !== undefined) {
        borderWidth = settings.lineWidth * borderThickness;
    } else if (borderColor && borderWidth === 0) {
        borderWidth = settings.lineWidth;
    }

    const symbolColor = room.userData?.["system.fallback_symbol_color"]
        ?? ((settings.frameMode || settings.coloredMode)
            ? brightEnvColor
            : mapReader.getSymbolColor(room.env));

    return {fillColor, strokeColor, borderWidth, symbolColor, envColor, customBorder: borderColor !== undefined};
}

/**
 * Compute the emboss bevel for a room.
 * Returns highlight (top+left) and shadow (bottom+right) edges using
 * lightened/darkened versions of the fill color for a raised 3D look.
 * Works for all room shapes: rectangle, roundedRectangle, and circle.
 */
export function computeEmboss(fillColor: string, settings: Settings): EmbossStyle {
    if (!settings.emboss) return null;
    const rs = settings.roomSize;
    const inset = settings.borders ? settings.lineWidth / 2 : 0;
    const sw = settings.lineWidth;
    const hi = lightenColor(fillColor, 0.35);
    const sh = darkenColor(fillColor, 0.45);

    if (settings.roomShape === "circle") {
        const cx = rs / 2;
        const cy = rs / 2;
        const r = rs / 2 - inset;
        const segs = 48;

        // Full circle in shadow color (base)
        const shPoints: number[] = [];
        for (let i = 0; i <= segs; i++) {
            const a = (i / segs) * 360 * Math.PI / 180;
            shPoints.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }

        // Highlight arc on top-left only (~140°), drawn on top of the shadow circle
        const hiPoints: number[] = [];
        const hiSegs = Math.round(segs * 140 / 360);
        for (let i = 0; i <= hiSegs; i++) {
            const a = (200 + (i / hiSegs) * 140) * Math.PI / 180;
            hiPoints.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }

        return {
            shadow: { points: shPoints, stroke: sh, strokeWidth: sw, lineCap: 'round', lineJoin: 'round' },
            highlight: { points: hiPoints, stroke: hi, strokeWidth: sw, lineCap: 'round', lineJoin: 'round' },
        };
    }

    if (settings.roomShape === "roundedRectangle") {
        const cr = (rs - inset * 2) * 0.2;
        const x1 = inset, y1 = inset;
        const x2 = rs - inset, y2 = rs - inset;
        const segs = 10;

        // Generate perimeter clockwise starting from bottom-left diagonal (135°).
        // This way the first half = left + top (highlight), second half = right + bottom (shadow).
        const perimeter: number[] = [];

        // Bottom-left corner: 135° → 180° (half corner)
        for (let i = 0; i <= segs / 2; i++) {
            const a = (135 + (i / (segs / 2)) * 45) * Math.PI / 180;
            perimeter.push(x1 + cr + Math.cos(a) * cr, y2 - cr + Math.sin(a) * cr);
        }
        // Top-left corner: 180° → 270° (full corner)
        for (let i = 1; i <= segs; i++) {
            const a = (180 + (i / segs) * 90) * Math.PI / 180;
            perimeter.push(x1 + cr + Math.cos(a) * cr, y1 + cr + Math.sin(a) * cr);
        }
        // Top-right corner: 270° → 315° (half corner)
        for (let i = 1; i <= segs / 2; i++) {
            const a = (270 + (i / (segs / 2)) * 45) * Math.PI / 180;
            perimeter.push(x2 - cr + Math.cos(a) * cr, y1 + cr + Math.sin(a) * cr);
        }

        const hiPoints = perimeter.slice();

        // Continue for shadow: top-right 315° → 360° (half corner)
        const shPerimeter: number[] = [];
        for (let i = 0; i <= segs / 2; i++) {
            const a = (315 + (i / (segs / 2)) * 45) * Math.PI / 180;
            shPerimeter.push(x2 - cr + Math.cos(a) * cr, y1 + cr + Math.sin(a) * cr);
        }
        // Bottom-right corner: 0° → 90° (full corner)
        for (let i = 1; i <= segs; i++) {
            const a = (i / segs) * 90 * Math.PI / 180;
            shPerimeter.push(x2 - cr + Math.cos(a) * cr, y2 - cr + Math.sin(a) * cr);
        }
        // Bottom-left corner: 90° → 135° (half corner)
        for (let i = 1; i <= segs / 2; i++) {
            const a = (90 + (i / (segs / 2)) * 45) * Math.PI / 180;
            shPerimeter.push(x1 + cr + Math.cos(a) * cr, y2 - cr + Math.sin(a) * cr);
        }

        return {
            highlight: { points: hiPoints, stroke: hi, strokeWidth: sw, lineCap: 'round', lineJoin: 'round' },
            shadow: { points: shPerimeter, stroke: sh, strokeWidth: sw, lineCap: 'round', lineJoin: 'round' },
        };
    }

    // Plain rectangle: simple L-shapes
    return {
        highlight: {
            points: [inset, rs - inset, inset, inset, rs - inset, inset],
            stroke: hi,
            strokeWidth: sw,
        },
        shadow: {
            points: [inset, rs - inset, rs - inset, rs - inset, rs - inset, inset],
            stroke: sh,
            strokeWidth: sw,
        },
    };
}
