import MapReader from "../../reader/MapReader";
import type {Settings} from "../../types/Settings";
import {measureTextBaselineOffset} from "../../utils/textMeasure";
import {computeRoomColors, computeEmboss} from "../RoomStyle";
import {darkenColor} from "../../utils/color";
import type {GroupShape, Shape} from "../Shape";

export interface RoomLayoutOptions {
    /** Override stroke colour (used for highlighted rooms). */
    strokeOverride?: string;
    /**
     * Whether the active style preserves a flat coordinate space. Iso-style
     * pipelines pass `false` to suppress concentric rings (which would render
     * as flat diamonds outside the cube footprint).
     */
    flatPipeline: boolean;
}

/**
 * Pure layout for a single room. Returns a {@link GroupShape} positioned at
 * the room's top-left, with rect/circle/line/text children for the body,
 * border, emboss, and symbol.
 */
export function layoutRoom(
    room: MapData.Room,
    mapReader: MapReader,
    settings: Settings,
    options: RoomLayoutOptions,
): GroupShape {
    const {fillColor, strokeColor, borderWidth, symbolColor} = computeRoomColors(
        room, mapReader, settings, options.strokeOverride,
    );

    const rs = settings.roomSize;
    const children: Shape[] = [];

    const emboss = computeEmboss(fillColor, settings);
    // When emboss is active, skip the regular border — the emboss lines serve as the border.
    const drawBorder = emboss ? 0 : borderWidth;

    const multiRing = settings.coloredMode && drawBorder > 0 && options.flatPipeline;
    const cornerOf = (ins: number) =>
        settings.roomShape === "roundedRectangle" ? Math.max(0, (rs - 2 * ins) * 0.2) : 0;

    if (multiRing) {
        const ringColors = [darkenColor(strokeColor, 0.5), strokeColor];
        const fillInset = borderWidth * 2;

        if (settings.roomShape === "circle") {
            children.push({
                type: "circle",
                cx: rs / 2, cy: rs / 2, radius: rs / 2 - fillInset,
                paint: {fill: fillColor},
            });
        } else {
            children.push({
                type: "rect",
                x: fillInset, y: fillInset,
                width: rs - fillInset * 2, height: rs - fillInset * 2,
                cornerRadius: cornerOf(fillInset),
                paint: {fill: fillColor},
            });
        }

        for (let i = 0; i < ringColors.length; i++) {
            const ins = borderWidth / 2 + i * borderWidth;
            if (settings.roomShape === "circle") {
                children.push({
                    type: "circle",
                    cx: rs / 2, cy: rs / 2, radius: rs / 2 - ins,
                    paint: {stroke: ringColors[i], strokeWidth: borderWidth},
                });
            } else {
                children.push({
                    type: "rect",
                    x: ins, y: ins,
                    width: rs - ins * 2, height: rs - ins * 2,
                    cornerRadius: cornerOf(ins),
                    paint: {stroke: ringColors[i], strokeWidth: borderWidth},
                });
            }
        }
    } else if (settings.roomShape === "circle") {
        children.push({
            type: "circle",
            cx: rs / 2, cy: rs / 2, radius: rs / 2,
            paint: {
                fill: fillColor,
                stroke: drawBorder ? strokeColor : undefined,
                strokeWidth: drawBorder,
            },
        });
    } else {
        children.push({
            type: "rect",
            x: 0, y: 0, width: rs, height: rs,
            cornerRadius: settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0,
            paint: {
                fill: fillColor,
                stroke: drawBorder ? strokeColor : undefined,
                strokeWidth: drawBorder,
            },
        });
    }

    if (emboss) {
        children.push({
            type: "line",
            points: emboss.shadow.points,
            paint: {
                stroke: emboss.shadow.stroke,
                strokeWidth: emboss.shadow.strokeWidth,
            },
            lineCap: emboss.shadow.lineCap as "butt" | "round" | "square" | undefined,
            lineJoin: emboss.shadow.lineJoin as "miter" | "round" | "bevel" | undefined,
        });
        children.push({
            type: "line",
            points: emboss.highlight.points,
            paint: {
                stroke: emboss.highlight.stroke,
                strokeWidth: emboss.highlight.strokeWidth,
            },
            lineCap: emboss.highlight.lineCap as "butt" | "round" | "square" | undefined,
            // Original used emboss.shadow.lineJoin here — preserve that quirk for parity.
            lineJoin: emboss.shadow.lineJoin as "miter" | "round" | "bevel" | undefined,
        });
    }

    if (room.roomChar) {
        const fontSize = rs * 0.75;
        const {baselineRatio, konvaCorrectionRatio} = measureTextBaselineOffset(
            room.roomChar, settings.fontFamily,
        );
        const textWidth = Math.max(rs, room.roomChar.length * fontSize * 0.8);
        const textOffset = (textWidth - rs) / 2;
        children.push({
            type: "text",
            x: -textOffset,
            y: 0,
            text: room.roomChar,
            fontSize,
            fontFamily: settings.fontFamily,
            fontStyle: "bold",
            fill: symbolColor,
            align: "center",
            verticalAlign: "middle",
            width: textWidth,
            height: rs,
            baselineRatio,
            konvaCorrectionRatio,
        });
    }

    return {
        type: "group",
        x: room.x - rs / 2,
        y: room.y - rs / 2,
        layer: "room",
        hit: {kind: "room", id: room.id, payload: room},
        children,
    };
}
