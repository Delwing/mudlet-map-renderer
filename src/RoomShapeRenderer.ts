import MapReader from "./reader/MapReader";
import type {Settings} from "./Renderer";
import type {DrawingBackend, GroupNode} from "./backend/DrawingBackend";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";

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
        const {fillColor, strokeColor, borderWidth, symbolColor} = computeRoomColors(
            room, this.mapReader, this.settings, options?.strokeOverride,
        );

        const rs = this.settings.roomSize;
        const group = this.backend.createGroup(room.x - rs / 2, room.y - rs / 2);

        if (this.settings.roomShape === "circle") {
            this.backend.addCircle(group, {
                cx: rs / 2, cy: rs / 2, radius: rs / 2,
                fill: fillColor, stroke: strokeColor, strokeWidth: borderWidth,
            });
        } else {
            this.backend.addRect(group, {
                x: 0, y: 0, width: rs, height: rs,
                fill: fillColor, stroke: strokeColor, strokeWidth: borderWidth,
                cornerRadius: this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0,
            });
        }

        const emboss = computeEmboss(this.settings);
        if (emboss) {
            this.backend.addLine(group, {
                points: emboss.points,
                stroke: emboss.stroke,
                strokeWidth: emboss.strokeWidth,
            });
        }

        if (room.roomChar) {
            const fontSize = rs * 0.75;
            const baselineRatio = measureTextBaselineOffset(room.roomChar, this.settings.fontFamily);
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
            });
        }

        return group;
    }
}
