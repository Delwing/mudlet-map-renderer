import MapReader from "./reader/MapReader";
import type {Settings} from "./types/Settings";
import type {DrawingBackend, GroupNode} from "./backend/DrawingBackend";
import {IDENTITY_TRANSFORM} from "./backend/DrawingBackend";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";
import {darkenColor} from "./utils/color";

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

        const emboss = computeEmboss(fillColor, this.settings);
        // When emboss is active, skip the regular border — the emboss lines serve as the border
        const drawBorder = emboss ? 0 : borderWidth;

        // Colored mode draws two concentric rings (outer dark, inner bright) entirely
        // inside the room footprint. Skip on warped backends (iso) — those render
        // rooms as cubes whose silhouette already conveys structure, and extra rect
        // calls would render as flat diamonds outside the cube footprint.
        const isFlatBackend = this.backend.getTransform() === IDENTITY_TRANSFORM;
        const multiRing = this.settings.coloredMode && drawBorder > 0 && isFlatBackend;
        const cornerOf = (ins: number) =>
            this.settings.roomShape === "roundedRectangle" ? Math.max(0, (rs - 2 * ins) * 0.2) : 0;

        if (multiRing) {
            const ringColors = [darkenColor(strokeColor, 0.5), strokeColor];
            const fillInset = borderWidth * 2;

            if (this.settings.roomShape === "circle") {
                this.backend.addCircle(group, {
                    cx: rs / 2, cy: rs / 2, radius: rs / 2 - fillInset,
                    fill: fillColor,
                });
            } else {
                this.backend.addRect(group, {
                    x: fillInset, y: fillInset, width: rs - fillInset * 2, height: rs - fillInset * 2,
                    fill: fillColor,
                    cornerRadius: cornerOf(fillInset),
                });
            }

            for (let i = 0; i < ringColors.length; i++) {
                const ins = borderWidth / 2 + i * borderWidth;
                if (this.settings.roomShape === "circle") {
                    this.backend.addCircle(group, {
                        cx: rs / 2, cy: rs / 2, radius: rs / 2 - ins,
                        stroke: ringColors[i], strokeWidth: borderWidth,
                    });
                } else {
                    this.backend.addRect(group, {
                        x: ins, y: ins, width: rs - ins * 2, height: rs - ins * 2,
                        stroke: ringColors[i], strokeWidth: borderWidth,
                        cornerRadius: cornerOf(ins),
                    });
                }
            }
        } else if (this.settings.roomShape === "circle") {
            this.backend.addCircle(group, {
                cx: rs / 2, cy: rs / 2, radius: rs / 2,
                fill: fillColor, stroke: drawBorder ? strokeColor : undefined, strokeWidth: drawBorder,
            });
        } else {
            this.backend.addRect(group, {
                x: 0, y: 0, width: rs, height: rs,
                fill: fillColor, stroke: drawBorder ? strokeColor : undefined, strokeWidth: drawBorder,
                cornerRadius: this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0,
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
