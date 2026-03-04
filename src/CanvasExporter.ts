import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import Plane from "./reader/Plane";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData, ExitDrawLine, ExitDrawArrow, ExitDrawDoor} from "./ExitRenderer";
import type {Settings} from "./Renderer";
import {colorLightness} from "./Renderer";
import {movePoint, movePointCircle, movePointRoundedRect} from "./directions";
import {computePathData} from "./PathData";

const dirNumbers: Record<number, MapData.direction> = {
    1: "north", 2: "northeast", 3: "northwest", 4: "east", 5: "west",
    6: "south", 7: "southeast", 8: "southwest", 9: "up", 10: "down",
    11: "in", 12: "out",
};

const innerExitDirections: MapData.direction[] = ["up", "down", "in", "out"];

const DoorColors: Record<number, string> = {
    1: 'rgb(10, 155, 10)',
    2: 'rgb(226, 205, 59)',
    3: 'rgb(155, 10, 10)',
};



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

    private getSymbolColor(envId: number, opacity?: number): string {
        if (this.settings.frameMode) {
            return this.mapReader.getColorValue(envId);
        }
        return this.mapReader.getSymbolColor(envId, opacity);
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

    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        if (this.settings.roomShape === "circle") return movePointCircle(x, y, direction, distance);
        if (this.settings.roomShape === "roundedRectangle") return movePointRoundedRect(x, y, direction, distance, this.settings.roomSize * 0.2);
        return movePoint(x, y, direction, distance);
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
            this.drawExitData(ctx, data);
        }
    }

    private drawExitData(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, data: ExitDrawData) {
        for (const line of data.lines) {
            ctx.beginPath();
            ctx.moveTo(line.points[0], line.points[1]);
            for (let i = 2; i < line.points.length; i += 2) {
                ctx.lineTo(line.points[i], line.points[i + 1]);
            }
            ctx.strokeStyle = line.stroke;
            ctx.lineWidth = line.strokeWidth;
            ctx.setLineDash(line.dash ?? []);
            ctx.stroke();
        }

        for (const arrow of data.arrows) {
            ctx.beginPath();
            ctx.moveTo(arrow.points[0], arrow.points[1]);
            for (let i = 2; i < arrow.points.length; i += 2) {
                ctx.lineTo(arrow.points[i], arrow.points[i + 1]);
            }
            ctx.strokeStyle = arrow.stroke;
            ctx.lineWidth = arrow.strokeWidth;
            ctx.setLineDash(arrow.dash ?? []);
            ctx.stroke();

            // Arrowhead
            const lastIdx = arrow.points.length - 2;
            const tipX = arrow.points[lastIdx], tipY = arrow.points[lastIdx + 1];
            const prevX = arrow.points[lastIdx - 2], prevY = arrow.points[lastIdx - 1];
            const angle = Math.atan2(tipY - prevY, tipX - prevX);
            const pl = arrow.pointerLength, pw = arrow.pointerWidth / 2;
            ctx.beginPath();
            ctx.setLineDash([]);
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - pl * Math.cos(angle - Math.atan2(pw, pl)), tipY - pl * Math.sin(angle - Math.atan2(pw, pl)));
            ctx.lineTo(tipX - pl * Math.cos(angle + Math.atan2(pw, pl)), tipY - pl * Math.sin(angle + Math.atan2(pw, pl)));
            ctx.closePath();
            ctx.fillStyle = arrow.fill;
            ctx.fill();
            ctx.strokeStyle = arrow.stroke;
            ctx.lineWidth = arrow.strokeWidth;
            ctx.stroke();
        }

        for (const door of data.doors) {
            ctx.beginPath();
            ctx.rect(door.x, door.y, door.width, door.height);
            ctx.strokeStyle = door.stroke;
            ctx.lineWidth = door.strokeWidth;
            ctx.setLineDash([]);
            ctx.stroke();
        }
    }

    // --- Stubs ---

    private renderStubs(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        ctx.strokeStyle = this.settings.lineColor;
        ctx.lineWidth = this.settings.lineWidth;
        ctx.setLineDash([]);
        for (const room of rooms) {
            for (const stub of room.stubs) {
                const direction = dirNumbers[stub];
                if (!direction) continue;
                const start = this.getRoomEdgePoint(room.x, room.y, direction, this.settings.roomSize / 2);
                const end = movePoint(room.x, room.y, direction, this.settings.roomSize / 2 + 0.5);
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
            }
        }
    }

    // --- Special Exits ---

    private renderSpecialExits(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const [dir, line] of Object.entries(room.customLines)) {
                const points: number[] = [room.x, room.y];
                for (const pt of line.points) {
                    points.push(pt.x, -pt.y);
                }
                const strokeColor = `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = this.settings.lineWidth;

                if (line.attributes.style === "dot line") {
                    ctx.setLineDash([0.05, 0.05]);
                } else if (line.attributes.style === "dash line") {
                    ctx.setLineDash([0.4, 0.2]);
                } else {
                    ctx.setLineDash([]);
                }

                ctx.beginPath();
                ctx.moveTo(points[0], points[1]);
                for (let i = 2; i < points.length; i += 2) {
                    ctx.lineTo(points[i], points[i + 1]);
                }
                ctx.stroke();

                if (line.attributes.arrow && points.length >= 4) {
                    const li = points.length - 2;
                    const tipX = points[li], tipY = points[li + 1];
                    const prevX = points[li - 2], prevY = points[li - 1];
                    const angle = Math.atan2(tipY - prevY, tipX - prevX);
                    const pl = 0.3, pw = 0.1;
                    ctx.beginPath();
                    ctx.setLineDash([]);
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(tipX - pl * Math.cos(angle - Math.atan2(pw, pl)), tipY - pl * Math.sin(angle - Math.atan2(pw, pl)));
                    ctx.lineTo(tipX - pl * Math.cos(angle + Math.atan2(pw, pl)), tipY - pl * Math.sin(angle + Math.atan2(pw, pl)));
                    ctx.closePath();
                    ctx.fillStyle = strokeColor;
                    ctx.fill();
                }

                const doorType = room.doors[dir];
                if (doorType && points.length >= 4) {
                    const dx = points[0] + (points[2] - points[0]) / 2;
                    const dy = points[1] + (points[3] - points[1]) / 2;
                    const s = this.settings.roomSize / 2;
                    ctx.beginPath();
                    ctx.rect(dx - s / 2, dy - s / 2, s, s);
                    ctx.strokeStyle = DoorColors[doorType] ?? DoorColors[3];
                    ctx.lineWidth = this.settings.lineWidth;
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
            const envColor = this.mapReader.getColorValue(room.env);
            const fillColor = this.settings.frameMode ? this.settings.backgroundColor : envColor;
            const strokeColor = this.settings.frameMode ? envColor : this.settings.lineColor;

            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = this.settings.lineWidth;
            ctx.setLineDash([]);

            if (this.settings.roomShape === "circle") {
                ctx.beginPath();
                ctx.arc(room.x, room.y, halfRs, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else {
                const rx = room.x - halfRs;
                const ry = room.y - halfRs;
                const cr = this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0;
                if (cr > 0) {
                    this.roundRect(ctx, rx, ry, rs, rs, cr);
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.fillRect(rx, ry, rs, rs);
                    ctx.strokeRect(rx, ry, rs, rs);
                }

                // Emboss
                if (this.settings.emboss) {
                    const isLight = colorLightness(this.settings.lineColor) > 0.41;
                    ctx.beginPath();
                    if (isLight) {
                        ctx.moveTo(rx, ry);
                        ctx.lineTo(rx + rs, ry);
                        ctx.lineTo(rx + rs, ry + rs);
                    } else {
                        ctx.moveTo(rx, ry);
                        ctx.lineTo(rx, ry + rs);
                        ctx.lineTo(rx + rs, ry + rs);
                    }
                    ctx.strokeStyle = isLight ? '#000000' : '#ffffff';
                    ctx.lineWidth = this.settings.lineWidth;
                    ctx.stroke();
                }
            }

            // Symbol
            if (room.roomChar) {
                const symbolColor = this.getSymbolColor(room.env);
                const fontSize = rs * 0.75;
                ctx.fillStyle = symbolColor;
                ctx.font = `bold ${fontSize}px ${this.settings.fontFamily}`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                const metrics = ctx.measureText(room.roomChar);
                ctx.fillText(room.roomChar, room.x - metrics.width / 2, room.y + fontSize * 0.35);
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
        const rs = this.settings.roomSize;
        const triRadius = rs / 5;

        for (const room of rooms) {
            for (const exit of innerExitDirections) {
                if (!room.exits[exit]) continue;

                const symbolColor = this.getSymbolColor(room.env);
                const symbolFill = this.getSymbolColor(room.env, 0.6);
                const doorType = room.doors[exit];
                const stroke = doorType !== undefined ? (DoorColors[doorType] ?? DoorColors[3]) : symbolColor;

                switch (exit) {
                    case "up": {
                        const pos = movePoint(room.x, room.y, "south", rs / 4);
                        this.drawTriangle(ctx, pos.x, pos.y, triRadius, 0, symbolFill, stroke);
                        break;
                    }
                    case "down": {
                        const pos = movePoint(room.x, room.y, "north", rs / 4);
                        this.drawTriangle(ctx, pos.x, pos.y, triRadius, 180, symbolFill, stroke);
                        break;
                    }
                    case "in": {
                        const posW = movePoint(room.x, room.y, "west", rs / 4);
                        const posE = movePoint(room.x, room.y, "east", rs / 4);
                        this.drawTriangle(ctx, posW.x, posW.y, triRadius, 90, symbolFill, stroke);
                        this.drawTriangle(ctx, posE.x, posE.y, triRadius, -90, symbolFill, stroke);
                        break;
                    }
                    case "out": {
                        const posW = movePoint(room.x, room.y, "west", rs / 4);
                        const posE = movePoint(room.x, room.y, "east", rs / 4);
                        this.drawTriangle(ctx, posW.x, posW.y, triRadius, -90, symbolFill, stroke);
                        this.drawTriangle(ctx, posE.x, posE.y, triRadius, 90, symbolFill, stroke);
                        break;
                    }
                }
            }
        }
    }

    private drawTriangle(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cx: number, cy: number, radius: number, rotationDeg: number, fill: string, stroke: string) {
        const scaleX = 1.4, scaleY = 0.8;
        const angleRad = rotationDeg * Math.PI / 180;

        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const a = (2 * Math.PI * i / 3) - Math.PI / 2;
            let px = Math.cos(a) * radius * scaleX;
            let py = Math.sin(a) * radius * scaleY;
            const rx = px * Math.cos(angleRad) - py * Math.sin(angleRad);
            const ry = px * Math.sin(angleRad) + py * Math.cos(angleRad);
            if (i === 0) ctx.moveTo(cx + rx, cy + ry);
            else ctx.lineTo(cx + rx, cy + ry);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = this.settings.lineWidth;
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
            this.drawTriangle(ctx, marker.room.x, marker.room.y, triRadius, rot, color, 'black');
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

        ctx.beginPath();
        ctx.arc(room.x, room.y, size / 2, 0, Math.PI * 2);
        ctx.stroke();

        if (pm.fillAlpha > 0) {
            ctx.globalAlpha = pm.fillAlpha;
            ctx.fillStyle = pm.fillColor;
            ctx.fill();
        }

        ctx.restore();
    }
}
