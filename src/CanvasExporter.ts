import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import Plane from "./reader/Plane";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData} from "./ExitRenderer";
import type {Settings} from "./Renderer";
import {computePathData} from "./PathData";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";
import {computeInnerExits, computeTriangleVertices} from "./scene/InnerExitStyle";
import {computeStubs} from "./scene/StubStyle";
import {computeSpecialExits} from "./scene/SpecialExitStyle";
import {drawExitDataToCanvas} from "./scene/ExitDataRenderer";

export type CanvasExportOverlays = {
    position?: { roomId: number };
    highlights?: Array<{ roomId: number; color: string }>;
    paths?: Array<{ locations: number[]; color: string }>;
};

export type CanvasExportOptions = {
    /** Width of the output image in pixels. */
    width: number;
    /** Height of the output image in pixels. */
    height: number;
    /** Room ID to center the export on. If omitted, exports the full area. */
    roomId?: number;
    /** Padding in map units around the exported region. Default: 3 */
    padding?: number;
    /** Overlay data (position marker, highlights, paths). */
    overlays?: CanvasExportOverlays;
};

/**
 * Renders map data directly to a Canvas2D context.
 * Works in both browser (OffscreenCanvas / regular Canvas) and Node.js (with the 'canvas' npm package).
 *
 * Usage (Node.js):
 * ```
 * import { createCanvas } from 'canvas';
 * const canvas = createCanvas(width, height);
 * const exporter = new CanvasExporter(mapReader, settings);
 * exporter.render(canvas.getContext('2d'), areaId, zIndex, { width, height });
 * const buffer = canvas.toBuffer('image/png');
 * ```
 *
 * Usage (Browser):
 * ```
 * const canvas = new OffscreenCanvas(width, height);
 * const exporter = new CanvasExporter(mapReader, settings);
 * exporter.render(canvas.getContext('2d'), areaId, zIndex, { width, height });
 * const blob = await canvas.convertToBlob({ type: 'image/png' });
 * ```
 */
export class CanvasExporter {
    private readonly mapReader: MapReader;
    private readonly settings: Settings;
    private readonly exitRenderer: ExitRenderer;

    constructor(mapReader: MapReader, settings: Settings) {
        this.mapReader = mapReader;
        this.settings = settings;
        this.exitRenderer = new ExitRenderer(mapReader, null, settings);
    }

    /**
     * Render the map area to a Canvas2D context.
     * The caller creates the canvas and context; this method draws to it.
     */
    render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, areaId: number, zIndex: number, options: CanvasExportOptions) {
        const area = this.mapReader.getArea(areaId);
        if (!area) throw new Error(`Area ${areaId} not found`);
        const plane = area.getPlane(zIndex);
        if (!plane) throw new Error(`Plane z=${zIndex} not found in area ${areaId}`);

        const padding = options.padding ?? 3;
        const bounds = this.computeBounds(area, plane, options.roomId, padding);

        // Set up transform: map coords → pixel coords
        const scaleX = options.width / bounds.w;
        const scaleY = options.height / bounds.h;
        const scale = Math.min(scaleX, scaleY);

        ctx.save();

        // Background
        ctx.fillStyle = this.settings.backgroundColor;
        ctx.fillRect(0, 0, options.width, options.height);

        // Center the map in the canvas
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        ctx.translate((options.width - mapPixelW) / 2, (options.height - mapPixelH) / 2);
        ctx.scale(scale, scale);
        ctx.translate(-bounds.x, -bounds.y);

        // Grid (behind everything) — compute full visible area in map coords
        if (this.settings.gridEnabled) {
            const offsetX = (options.width - mapPixelW) / 2;
            const offsetY = (options.height - mapPixelH) / 2;
            const visibleBounds = {
                x: bounds.x - offsetX / scale,
                y: bounds.y - offsetY / scale,
                w: options.width / scale,
                h: options.height / scale,
            };
            this.renderGrid(ctx, visibleBounds);
        }

        // Render layers in order
        this.renderLabels(ctx, plane.getLabels());
        this.renderLinkExits(ctx, area, zIndex);
        this.renderSpecialExits(ctx, plane.getRooms());
        this.renderStubs(ctx, plane.getRooms());
        this.renderRooms(ctx, plane.getRooms());
        this.renderInnerExits(ctx, plane.getRooms());

        // Overlays
        const overlays = options.overlays;
        if (overlays) {
            if (overlays.paths) {
                for (const path of overlays.paths) {
                    this.renderPathOverlay(ctx, path.locations, path.color, areaId, zIndex);
                }
            }
            if (overlays.highlights) {
                for (const hl of overlays.highlights) {
                    this.renderHighlightOverlay(ctx, hl.roomId, hl.color);
                }
            }
            if (overlays.position) {
                this.renderPositionMarker(ctx, overlays.position.roomId);
            }
        }

        // Area name header
        if (this.settings.areaName) {
            const name = area.getAreaName();
            if (name) {
                const eb = this.getEffectiveBounds(area, plane);
                ctx.fillStyle = 'white';
                ctx.font = `2.5px ${this.settings.fontFamily}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(name, eb.minX - 3.5, eb.minY - 2);
            }
        }

        ctx.restore();
    }

    private computeBounds(area: Area, plane: Plane, roomId: number | undefined, padding: number) {
        if (roomId !== undefined) {
            const room = this.mapReader.getRoom(roomId);
            if (!room) throw new Error(`Room ${roomId} not found`);
            return { x: room.x - padding, y: room.y - padding, w: padding * 2, h: padding * 2 };
        }
        const b = this.getEffectiveBounds(area, plane);
        const areaName = this.settings.areaName ? area.getAreaName() : undefined;
        const nameOverhead = areaName ? 7 : 0;
        const nameLeftOffset = areaName ? 3.5 : 0;
        const minX = b.minX - nameLeftOffset;
        const minY = b.minY - nameOverhead;
        const nameRight = areaName ? (b.minX - 3.5 + areaName.length * 2.5 * 0.6) : -Infinity;
        const maxX = Math.max(b.maxX, nameRight);
        return { x: minX - padding, y: minY - padding, w: (maxX - minX) + padding * 2, h: (b.maxY - minY) + padding * 2 };
    }

    private getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    // --- Grid ---

    private renderGrid(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bounds: { x: number; y: number; w: number; h: number }) {
        const gs = this.settings.gridSize;
        const left = Math.floor(bounds.x / gs) * gs;
        const right = Math.ceil((bounds.x + bounds.w) / gs) * gs;
        const top = Math.floor(bounds.y / gs) * gs;
        const bottom = Math.ceil((bounds.y + bounds.h) / gs) * gs;

        ctx.strokeStyle = this.settings.gridColor;
        ctx.lineWidth = this.settings.gridLineWidth;
        ctx.setLineDash([]);

        // Vertical lines
        for (let x = left; x <= right; x += gs) {
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
        }

        // Horizontal lines
        for (let y = top; y <= bottom; y += gs) {
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
        }
    }

    // --- Labels ---

    private renderLabels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, labels: MapData.Label[]) {
        for (const label of labels) {
            const lx = label.X;
            const ly = -label.Y;

            // Note: image mode labels are not supported in synchronous canvas export
            // because loading base64 images requires async Image.onload. Always uses data mode.

            if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
                const a = (label.BgColor.alpha ?? 255) / 255;
                ctx.fillStyle = `rgba(${label.BgColor.r},${label.BgColor.g},${label.BgColor.b},${a})`;
                ctx.fillRect(lx, ly, label.Width, label.Height);
            }

            if (label.Text) {
                const a = (label.FgColor?.alpha ?? 255) / 255;
                ctx.fillStyle = `rgba(${label.FgColor?.r ?? 0},${label.FgColor?.g ?? 0},${label.FgColor?.b ?? 0},${a})`;
                const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
                const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));
                ctx.font = `${fontSize}px ${this.settings.fontFamily}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.Text, lx + label.Width / 2, ly + label.Height / 2);
            }
        }
    }

    // --- Link Exits ---

    private renderLinkExits(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, area: Area, zIndex: number) {
        const exits = area.getLinkExits(zIndex);
        for (const exit of exits) {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) continue;
            drawExitDataToCanvas(ctx as CanvasRenderingContext2D, data);
        }
    }

    // --- Stubs ---

    private renderStubs(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        ctx.setLineDash([]);
        for (const room of rooms) {
            for (const stub of computeStubs(room, this.settings)) {
                ctx.beginPath();
                ctx.moveTo(stub.x1, stub.y1);
                ctx.lineTo(stub.x2, stub.y2);
                ctx.strokeStyle = stub.stroke;
                ctx.lineWidth = stub.strokeWidth;
                ctx.stroke();
            }
        }
    }

    // --- Special Exits ---

    private renderSpecialExits(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const se of computeSpecialExits(room, this.settings)) {
                const pts = se.line.points;
                ctx.strokeStyle = se.line.stroke;
                ctx.lineWidth = se.line.strokeWidth;
                ctx.setLineDash(se.line.dash ?? []);
                ctx.beginPath();
                ctx.moveTo(pts[0], pts[1]);
                for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
                ctx.stroke();

                if (se.arrow) {
                    ctx.beginPath();
                    ctx.setLineDash([]);
                    ctx.moveTo(se.arrow.tipX, se.arrow.tipY);
                    ctx.lineTo(se.arrow.x1, se.arrow.y1);
                    ctx.lineTo(se.arrow.x2, se.arrow.y2);
                    ctx.closePath();
                    ctx.fillStyle = se.arrow.fill;
                    ctx.fill();
                }

                if (se.door) {
                    ctx.beginPath();
                    ctx.rect(se.door.x, se.door.y, se.door.width, se.door.height);
                    ctx.strokeStyle = se.door.stroke;
                    ctx.lineWidth = se.door.strokeWidth;
                    ctx.setLineDash([]);
                    ctx.stroke();
                }
            }
        }
    }

    // --- Rooms ---

    private renderRooms(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        const rs = this.settings.roomSize;
        const halfRs = rs / 2;

        for (const room of rooms) {
            const {fillColor, strokeColor, borderWidth, symbolColor} = computeRoomColors(
                room, this.mapReader, this.settings,
            );

            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = borderWidth;
            ctx.setLineDash([]);

            if (this.settings.roomShape === "circle") {
                ctx.beginPath();
                ctx.arc(room.x, room.y, halfRs, 0, Math.PI * 2);
                ctx.fill();
                if (borderWidth > 0) ctx.stroke();
            } else {
                const rx = room.x - halfRs;
                const ry = room.y - halfRs;
                const cr = this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0;
                if (cr > 0) {
                    this.roundRect(ctx, rx, ry, rs, rs, cr);
                    ctx.fill();
                    if (borderWidth > 0) ctx.stroke();
                } else {
                    ctx.fillRect(rx, ry, rs, rs);
                    if (borderWidth > 0) ctx.strokeRect(rx, ry, rs, rs);
                }

                const emboss = computeEmboss(this.settings);
                if (emboss) {
                    ctx.beginPath();
                    ctx.moveTo(rx + emboss.points[0], ry + emboss.points[1]);
                    ctx.lineTo(rx + emboss.points[2], ry + emboss.points[3]);
                    ctx.lineTo(rx + emboss.points[4], ry + emboss.points[5]);
                    ctx.strokeStyle = emboss.stroke;
                    ctx.lineWidth = emboss.strokeWidth;
                    ctx.stroke();
                }
            }

            if (room.roomChar) {
                const fontSize = rs * 0.75;
                ctx.fillStyle = symbolColor;
                ctx.font = `bold ${fontSize}px ${this.settings.fontFamily}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const baselineRatio = measureTextBaselineOffset(room.roomChar, this.settings.fontFamily);
                ctx.fillText(room.roomChar, room.x, room.y + baselineRatio * fontSize);
            }
        }
    }

    private roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // --- Inner Exits ---

    private renderInnerExits(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        for (const room of rooms) {
            const {triangles} = computeInnerExits(room, this.mapReader, this.settings);
            for (const tri of triangles) {
                this.drawPolygon(ctx, tri.vertices, tri.fill, tri.stroke, tri.strokeWidth);
            }
        }
    }

    private drawPolygon(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, vertices: number[], fill: string, stroke: string, strokeWidth: number) {
        ctx.beginPath();
        ctx.moveTo(vertices[0], vertices[1]);
        for (let i = 2; i < vertices.length; i += 2) {
            ctx.lineTo(vertices[i], vertices[i + 1]);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
    }

    // --- Overlay: Paths ---

    private renderPathOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, locations: number[], color: string, areaId: number, zIndex: number) {
        const result = computePathData(this.mapReader, this.settings, locations, areaId, zIndex);
        const lw = this.settings.lineWidth;

        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);

        const drawSegment = (points: number[]) => {
            if (points.length < 4) return;
            // Black outline
            ctx.beginPath();
            ctx.moveTo(points[0], points[1]);
            for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = lw * 8;
            ctx.stroke();
            // Colored line
            ctx.beginPath();
            ctx.moveTo(points[0], points[1]);
            for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
            ctx.strokeStyle = color;
            ctx.lineWidth = lw * 4;
            ctx.stroke();
        };

        for (const segment of result.segments) drawSegment(segment.points);
        for (const cl of result.customLines) drawSegment(cl.points);

        const triRadius = this.settings.roomSize / 5;
        for (const marker of result.innerMarkers) {
            const rot = marker.direction === "up" ? 0 : marker.direction === "down" ? 180 : marker.direction === "in" ? 90 : -90;
            const vertices = computeTriangleVertices(marker.room.x, marker.room.y, triRadius, rot);
            this.drawPolygon(ctx, vertices, color, 'black', this.settings.lineWidth);
        }

        ctx.restore();
    }

    // --- Overlay: Highlights ---

    private renderHighlightOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const factor = 1.5;
        const rs = this.settings.roomSize;

        ctx.strokeStyle = color;
        ctx.lineWidth = 0.1;
        ctx.setLineDash([0.05, 0.05]);

        if (this.settings.roomShape === "circle") {
            ctx.beginPath();
            ctx.arc(room.x, room.y, rs / 2 * factor, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const sz = rs * factor;
            ctx.strokeRect(room.x - sz / 2, room.y - sz / 2, sz, sz);
        }
        ctx.setLineDash([]);
    }

    // --- Overlay: Position Marker ---

    private renderPositionMarker(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const pm = this.settings.playerMarker;
        const size = this.settings.roomSize * pm.sizeFactor;

        ctx.save();
        ctx.globalAlpha = pm.strokeAlpha;
        ctx.strokeStyle = pm.strokeColor;
        ctx.lineWidth = pm.strokeWidth;
        ctx.setLineDash(pm.dashEnabled && pm.dash ? pm.dash : []);

        const useRoomShape = pm.matchRoomShape && this.settings.roomShape !== "circle";
        if (useRoomShape) {
            const halfSize = size / 2;
            const cr = this.settings.roomShape === "roundedRectangle" ? size * 0.2 : 0;
            if (cr > 0) {
                this.roundRect(ctx, room.x - halfSize, room.y - halfSize, size, size, cr);
            } else {
                ctx.beginPath();
                ctx.rect(room.x - halfSize, room.y - halfSize, size, size);
            }
        } else {
            ctx.beginPath();
            ctx.arc(room.x, room.y, size / 2, 0, Math.PI * 2);
        }
        ctx.stroke();

        if (pm.fillAlpha > 0) {
            ctx.globalAlpha = pm.fillAlpha;
            ctx.fillStyle = pm.fillColor;
            ctx.fill();
        }

        ctx.restore();
    }
}
