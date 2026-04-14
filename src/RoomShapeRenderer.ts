import Konva from "konva";
import MapReader from "./reader/MapReader";
import type {Settings} from "./Renderer";
import {colorLightness, darkenColor} from "./Renderer";
import {measureTextBaselineOffset} from "./utils/textMeasure";

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

    /**
     * Create a Konva.Group for a room with shape, optional emboss, and symbol.
     * @param room The room data
     * @param options.strokeOverride Override the stroke color (used for current-room highlight)
     */
    createRoomGroup(room: MapData.Room, options?: {
        strokeOverride?: string;
    }): Konva.Group {
        const roomGroup = new Konva.Group({
            x: room.x - this.settings.roomSize / 2,
            y: room.y - this.settings.roomSize / 2,
            listening: false,
        });

        const envColor = this.mapReader.getColorValue(room.env);
        const fillColor = this.settings.coloredMode ? darkenColor(envColor, 0.7)
            : this.settings.frameMode ? this.settings.backgroundColor : envColor;
        const strokeColor = options?.strokeOverride
            ? ((this.settings.frameMode || this.settings.coloredMode) ? envColor : options.strokeOverride)
            : ((this.settings.frameMode || this.settings.coloredMode) ? envColor : this.settings.lineColor);
        const borderWidth = this.settings.borders ? this.settings.lineWidth : 0;

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

        if (this.settings.emboss && this.settings.roomShape !== "circle") {
            const rs = this.settings.roomSize;
            const isLight = colorLightness(this.settings.lineColor) > 0.41;
            roomGroup.add(new Konva.Line({
                points: isLight ? [0, 0, rs, 0, rs, rs] : [0, 0, 0, rs, rs, rs],
                stroke: isLight ? '#000000' : '#ffffff',
                strokeWidth: this.settings.lineWidth,
                perfectDrawEnabled: false,
                listening: false,
            }));
        }

        this.renderSymbol(room, roomGroup);

        return roomGroup;
    }

    private getSymbolColor(envId: number, opacity?: number): string {
        if (this.settings.frameMode) {
            return this.mapReader.getColorValue(envId);
        }
        return this.mapReader.getSymbolColor(envId, opacity);
    }

    private renderSymbol(room: MapData.Room, roomGroup: Konva.Group) {
        if (room.roomChar !== undefined) {
            const fontSize = this.settings.roomSize * 0.75;
            const baselineRatio = measureTextBaselineOffset(room.roomChar, this.settings.fontFamily);
            const refBaselineRatio = measureTextBaselineOffset("M", this.settings.fontFamily);
            const roomChar = new Konva.Text({
                x: 0,
                y: 0,
                text: room.roomChar,
                fontSize: fontSize,
                fontStyle: "bold",
                fill: this.getSymbolColor(room.env),
                align: "center",
                verticalAlign: "middle",
                width: this.settings.roomSize,
                height: this.settings.roomSize,
                offsetY: (refBaselineRatio - baselineRatio) * fontSize,
                perfectDrawEnabled: false,
                listening: false,
            });
            roomGroup.add(roomChar);
        }
    }
}
