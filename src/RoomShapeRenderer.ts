import Konva from "konva";
import MapReader from "./reader/MapReader";
import type {Settings} from "./Renderer";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";

/**
 * Creates Konva groups for individual rooms — shape, emboss, and symbol.
 * Used by the main Renderer for both the room layer and the overlay layer.
 */
export class RoomShapeRenderer {

    private readonly mapReader: MapReader;
    private readonly settings: Settings;

    constructor(mapReader: MapReader, settings: Settings) {
        this.mapReader = mapReader;
        this.settings = settings;
    }

    createRoomGroup(room: MapData.Room, options?: {
        strokeOverride?: string;
    }): Konva.Group {
        const {fillColor, strokeColor, borderWidth, symbolColor} = computeRoomColors(
            room, this.mapReader, this.settings, options?.strokeOverride,
        );

        const roomGroup = new Konva.Group({
            x: room.x - this.settings.roomSize / 2,
            y: room.y - this.settings.roomSize / 2,
            listening: false,
        });

        const roomShape = this.settings.roomShape === "circle"
            ? new Konva.Circle({
                x: this.settings.roomSize / 2,
                y: this.settings.roomSize / 2,
                radius: this.settings.roomSize / 2,
                fill: fillColor,
                strokeWidth: borderWidth,
                stroke: strokeColor,
                perfectDrawEnabled: false,
                listening: false,
            })
            : new Konva.Rect({
                x: 0,
                y: 0,
                width: this.settings.roomSize,
                height: this.settings.roomSize,
                fill: fillColor,
                strokeWidth: borderWidth,
                stroke: strokeColor,
                cornerRadius: this.settings.roomShape === "roundedRectangle" ? this.settings.roomSize * 0.2 : 0,
                perfectDrawEnabled: false,
                listening: false,
            });

        roomGroup.add(roomShape);

        const emboss = computeEmboss(this.settings);
        if (emboss) {
            roomGroup.add(new Konva.Line({
                points: emboss.points,
                stroke: emboss.stroke,
                strokeWidth: emboss.strokeWidth,
                perfectDrawEnabled: false,
                listening: false,
            }));
        }

        if (room.roomChar !== undefined) {
            const fontSize = this.settings.roomSize * 0.75;
            const baselineRatio = measureTextBaselineOffset(room.roomChar, this.settings.fontFamily);
            const refBaselineRatio = measureTextBaselineOffset("M", this.settings.fontFamily);
            roomGroup.add(new Konva.Text({
                x: 0,
                y: 0,
                text: room.roomChar,
                fontSize,
                fontStyle: "bold",
                fill: symbolColor,
                align: "center",
                verticalAlign: "middle",
                width: this.settings.roomSize,
                height: this.settings.roomSize,
                offsetY: (refBaselineRatio - baselineRatio) * fontSize,
                perfectDrawEnabled: false,
                listening: false,
            }));
        }

        return roomGroup;
    }
}
