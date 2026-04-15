import MapReader from "./reader/MapReader";
import type {Settings} from "./types/Settings";
import type {DrawingBackend, GroupNode} from "./backend/DrawingBackend";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";
import {lightenColor} from "./utils/color";

/**
 * Creates visual room groups via a DrawingBackend — shape, emboss, and symbol.
 * No direct Konva dependency.
 */
export class RoomShapeRenderer {

    private readonly mapReader: MapReader;
    private readonly settings: Settings;
    private readonly backend: DrawingBackend;

    constructor(mapReader: MapReader, settings: Settings, backend: DrawingBackend) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.backend = backend;
    }

    createRoomGroup(room: MapData.Room, options?: {
        strokeOverride?: string;
    }): GroupNode {
        const {fillColor, strokeColor, borderWidth, symbolColor, envColor} = computeRoomColors(
            room, this.mapReader, this.settings, options?.strokeOverride,
        );

        const rs = this.settings.roomSize;
        const group = this.backend.createGroup(room.x - rs / 2, room.y - rs / 2);

        // Border glow in colored mode: soft luminous halos behind the border stroke
        if (this.settings.coloredMode && borderWidth > 0) {
            const match = envColor.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (match) {
                const brightColor = lightenColor(envColor, 0.6);
                const bm = brightColor.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                const br = bm ? bm[1] : match[1], bg = bm ? bm[2] : match[2], bb = bm ? bm[3] : match[3];
                const inset = borderWidth / 2;
                const baseRadius = rs / 2 - inset;
                const baseCorner = this.settings.roomShape === "roundedRectangle" ? (rs - borderWidth) * 0.2 : 0;
                const glowLayers = [
                    {width: borderWidth * 3, r: match[1], g: match[2], b: match[3], alpha: 0.35},
                    {width: borderWidth * 1.2, r: br, g: bg, b: bb, alpha: 0.6},
                ];
                for (const gl of glowLayers) {
                    const glowStroke = `rgba(${gl.r}, ${gl.g}, ${gl.b}, ${gl.alpha})`;
                    if (this.settings.roomShape === "circle") {
                        this.backend.addCircle(group, {
                            cx: rs / 2, cy: rs / 2, radius: baseRadius,
                            stroke: glowStroke, strokeWidth: gl.width,
                        });
                    } else {
                        this.backend.addRect(group, {
                            x: inset, y: inset, width: rs - borderWidth, height: rs - borderWidth,
                            stroke: glowStroke, strokeWidth: gl.width,
                            cornerRadius: baseCorner,
                        });
                    }
                }
            }
        }

        // Inset shape by half the stroke width so the border stays inside the room bounds.
        const inset = borderWidth / 2;

        const emboss = computeEmboss(fillColor, this.settings);
        // When emboss is active, skip the regular border — the emboss lines serve as the border
        const drawBorder = emboss ? 0 : borderWidth;

        if (this.settings.roomShape === "circle") {
            this.backend.addCircle(group, {
                cx: rs / 2, cy: rs / 2, radius: rs / 2 - inset,
                fill: fillColor, stroke: drawBorder ? strokeColor : undefined, strokeWidth: drawBorder,
            });
        } else {
            this.backend.addRect(group, {
                x: inset, y: inset, width: rs - borderWidth, height: rs - borderWidth,
                fill: fillColor, stroke: drawBorder ? strokeColor : undefined, strokeWidth: drawBorder,
                cornerRadius: this.settings.roomShape === "roundedRectangle" ? (rs - borderWidth) * 0.2 : 0,
            });
        }
        if (emboss) {
            this.backend.addLine(group, {
                points: emboss.shadow.points,
                stroke: emboss.shadow.stroke,
                strokeWidth: emboss.shadow.strokeWidth,
                lineCap: emboss.shadow.lineCap,
                lineJoin: emboss.shadow.lineJoin,
            });
            this.backend.addLine(group, {
                points: emboss.highlight.points,
                stroke: emboss.highlight.stroke,
                strokeWidth: emboss.highlight.strokeWidth,
                lineCap: emboss.highlight.lineCap,
                lineJoin: emboss.shadow.lineJoin,
            });
        }

        if (room.roomChar) {
            const fontSize = rs * 0.75;
            const { baselineRatio, konvaCorrectionRatio } = measureTextBaselineOffset(room.roomChar, this.settings.fontFamily);
            // Use a wide text box to prevent Konva word-wrapping multi-char symbols.
            // The group doesn't clip, so oversized width is fine for centering.
            const textWidth = Math.max(rs, room.roomChar.length * fontSize * 0.8);
            const textOffset = (textWidth - rs) / 2;
            this.backend.addText(group, {
                x: -textOffset,
                y: 0,
                text: room.roomChar,
                fontSize,
                fontFamily: this.settings.fontFamily,
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

        return group;
    }
}
