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

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

const DoorColors = {
    OPEN: 'rgb(10, 155, 10)',
    CLOSED: 'rgb(226, 205, 59)',
    LOCKED: 'rgb(155, 10, 10)',
};

function getDoorColor(doorType: 1 | 2 | 3): string {
    switch (doorType) {
        case 1: return DoorColors.OPEN;
        case 2: return DoorColors.CLOSED;
        default: return DoorColors.LOCKED;
    }
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}



export type SvgOverlays = {
    position?: { roomId: number };
    highlights?: Array<{ roomId: number; color: string }>;
    paths?: Array<{ locations: number[]; color: string }>;
};

export type SvgExportOptions = {
    /** Room ID to center the export on. If omitted, exports the full area. */
    roomId?: number;
    /** Padding in map units around the exported region. Default: 3 */
    padding?: number;
    /** Overlay data (position marker, highlights, paths) to include in the export. */
    overlays?: SvgOverlays;
};

export class SvgExporter {
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

    export(areaId: number, zIndex: number, options?: SvgExportOptions): string {
        const area = this.mapReader.getArea(areaId);
        if (!area) throw new Error(`Area ${areaId} not found`);
        const plane = area.getPlane(zIndex);
        if (!plane) throw new Error(`Plane z=${zIndex} not found in area ${areaId}`);

        const padding = options?.padding ?? 3;
        const bounds = this.computeBounds(area, plane, options?.roomId, padding);

        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`);
        lines.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(this.settings.backgroundColor)}"/>`);

        // Grid (behind everything)
        if (this.settings.gridEnabled) {
            this.renderGrid(lines, bounds);
        }

        // Labels
        this.renderLabels(lines, plane.getLabels());

        // Link exits (two-way and one-way)
        this.renderLinkExits(lines, area, zIndex);

        // Rooms (with stubs, special exits, inner exits, emboss, symbols)
        const rooms = plane.getRooms();
        this.renderSpecialExits(lines, rooms);
        this.renderStubs(lines, rooms);
        this.renderRooms(lines, rooms);
        this.renderInnerExits(lines, rooms);

        // Overlays
        const overlays = options?.overlays;
        if (overlays) {
            // Paths
            if (overlays.paths) {
                for (const path of overlays.paths) {
                    this.renderPathOverlay(lines, path.locations, path.color, areaId, zIndex);
                }
            }
            // Highlights
            if (overlays.highlights) {
                for (const hl of overlays.highlights) {
                    this.renderHighlightOverlay(lines, hl.roomId, hl.color);
                }
            }
            // Position marker
            if (overlays.position) {
                this.renderPositionMarker(lines, overlays.position.roomId);
            }
        }

        // Area name header
        if (this.settings.areaName) {
            const name = area.getAreaName();
            if (name) {
                const eb = this.getEffectiveBounds(area, plane);
                lines.push(`<text x="${eb.minX - 3.5}" y="${eb.minY - 2}" font-size="2.5" font-family="${escapeXml(this.settings.fontFamily)}" fill="white">${escapeXml(name)}</text>`);
            }
        }

        lines.push('</svg>');
        return lines.join('\n');
    }

    private computeBounds(area: Area, plane: Plane, roomId: number | undefined, padding: number) {
        if (roomId !== undefined) {
            const room = this.mapReader.getRoom(roomId);
            if (!room) throw new Error(`Room ${roomId} not found`);
            return {
                x: room.x - padding,
                y: room.y - padding,
                w: padding * 2,
                h: padding * 2,
            };
        }
        const b = this.getEffectiveBounds(area, plane);
        const areaName = this.settings.areaName ? area.getAreaName() : undefined;
        const nameOverhead = areaName ? 7 : 0;
        const nameLeftOffset = areaName ? 3.5 : 0;
        const minX = b.minX - nameLeftOffset;
        const minY = b.minY - nameOverhead;
        // Estimate text width: font-size 2.5, ~0.6 char width ratio
        const nameRight = areaName ? (b.minX - 3.5 + areaName.length * 2.5 * 0.6) : -Infinity;
        const maxX = Math.max(b.maxX, nameRight);
        return {
            x: minX - padding,
            y: minY - padding,
            w: (maxX - minX) + padding * 2,
            h: (b.maxY - minY) + padding * 2,
        };
    }

    private getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    private getRoomEdgePoint(x: number, y: number, direction: MapData.direction, distance: number) {
        if (this.settings.roomShape === "circle") {
            return movePointCircle(x, y, direction, distance);
        } else if (this.settings.roomShape === "roundedRectangle") {
            return movePointRoundedRect(x, y, direction, distance, this.settings.roomSize * 0.2);
        }
        return movePoint(x, y, direction, distance);
    }

    // --- Grid ---

    private renderGrid(lines: string[], bounds: { x: number; y: number; w: number; h: number }) {
        const gs = this.settings.gridSize;
        const left = Math.floor(bounds.x / gs) * gs;
        const right = Math.ceil((bounds.x + bounds.w) / gs) * gs;
        const top = Math.floor(bounds.y / gs) * gs;
        const bottom = Math.ceil((bounds.y + bounds.h) / gs) * gs;

        const color = escapeXml(this.settings.gridColor);
        const lw = this.settings.gridLineWidth;

        // Vertical lines
        for (let x = left; x <= right; x += gs) {
            lines.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${color}" stroke-width="${lw}"/>`);
        }

        // Horizontal lines
        for (let y = top; y <= bottom; y += gs) {
            lines.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${color}" stroke-width="${lw}"/>`);
        }
    }

    // --- Labels ---

    private renderLabels(lines: string[], labels: MapData.Label[]) {
        for (const label of labels) {
            const lx = label.X;
            const ly = -label.Y;

            if (this.settings.labelRenderMode === "image" && label.pixMap) {
                lines.push(`<image x="${lx}" y="${ly}" width="${label.Width}" height="${label.Height}" href="data:image/png;base64,${label.pixMap}"/>`);
                continue;
            }

            // Background
            if ((label.BgColor?.alpha ?? 0) > 0 && !this.settings.transparentLabels) {
                const bg = this.labelColor(label.BgColor);
                lines.push(`<rect x="${lx}" y="${ly}" width="${label.Width}" height="${label.Height}" fill="${bg}"/>`);
            }

            // Text
            if (label.Text) {
                const fg = this.labelColor(label.FgColor);
                const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
                const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));
                lines.push(`<text x="${lx + label.Width / 2}" y="${ly + label.Height / 2}" font-size="${fontSize}" font-family="${escapeXml(this.settings.fontFamily)}" fill="${fg}" text-anchor="middle" dominant-baseline="central">${escapeXml(label.Text)}</text>`);
            }
        }
    }

    private labelColor(color: MapData.Color): string {
        const alpha = (color?.alpha ?? 255) / 255;
        const clamp = (v: number) => Math.min(255, Math.max(0, v ?? 0));
        return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
    }

    // --- Link Exits ---

    private renderLinkExits(lines: string[], area: Area, zIndex: number) {
        const exits = area.getLinkExits(zIndex);
        for (const exit of exits) {
            const data = this.exitRenderer.renderData(exit, zIndex);
            if (!data) continue;
            this.renderExitData(lines, data);
        }
    }

    private renderExitData(lines: string[], data: ExitDrawData) {
        for (const line of data.lines) {
            this.renderSvgLine(lines, line);
        }
        for (const arrow of data.arrows) {
            this.renderSvgArrow(lines, arrow);
        }
        for (const door of data.doors) {
            this.renderSvgDoor(lines, door);
        }
    }

    private renderSvgLine(lines: string[], line: ExitDrawLine) {
        if (line.points.length < 4) return;
        const points = line.points.map(p => p.toString()).join(' ');
        const dash = line.dash ? ` stroke-dasharray="${line.dash.join(' ')}"` : '';
        lines.push(`<polyline points="${points}" stroke="${escapeXml(line.stroke)}" stroke-width="${line.strokeWidth}" fill="none"${dash}/>`);
    }

    private renderSvgArrow(lines: string[], arrow: ExitDrawArrow) {
        if (arrow.points.length < 4) return;
        // Line
        const points = arrow.points.map(p => p.toString()).join(' ');
        const dash = arrow.dash ? ` stroke-dasharray="${arrow.dash.join(' ')}"` : '';
        lines.push(`<polyline points="${points}" stroke="${escapeXml(arrow.stroke)}" stroke-width="${arrow.strokeWidth}" fill="none"${dash}/>`);

        // Arrowhead
        const lastIdx = arrow.points.length - 2;
        const tipX = arrow.points[lastIdx];
        const tipY = arrow.points[lastIdx + 1];
        const prevX = arrow.points[lastIdx - 2];
        const prevY = arrow.points[lastIdx - 1];
        const angle = Math.atan2(tipY - prevY, tipX - prevX);
        const pl = arrow.pointerLength;
        const pw = arrow.pointerWidth / 2;
        const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
        const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
        const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
        const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));
        lines.push(`<polygon points="${tipX},${tipY} ${x1},${y1} ${x2},${y2}" fill="${escapeXml(arrow.fill)}" stroke="${escapeXml(arrow.stroke)}" stroke-width="${arrow.strokeWidth}"/>`);
    }

    private renderSvgDoor(lines: string[], door: ExitDrawDoor) {
        lines.push(`<rect x="${door.x}" y="${door.y}" width="${door.width}" height="${door.height}" stroke="${escapeXml(door.stroke)}" stroke-width="${door.strokeWidth}" fill="none"/>`);
    }

    // --- Stubs ---

    private renderStubs(lines: string[], rooms: MapData.Room[]) {
        const color = this.settings.lineColor;
        for (const room of rooms) {
            for (const stub of room.stubs) {
                const direction = dirNumbers[stub];
                if (!direction) continue;
                const start = this.getRoomEdgePoint(room.x, room.y, direction, this.settings.roomSize / 2);
                const end = movePoint(room.x, room.y, direction, this.settings.roomSize / 2 + 0.5);
                lines.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${escapeXml(color)}" stroke-width="${this.settings.lineWidth}"/>`);
            }
        }
    }

    // --- Special Exits (custom lines) ---

    private renderSpecialExits(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const [dir, line] of Object.entries(room.customLines)) {
                const points: number[] = [room.x, room.y];
                for (const pt of line.points) {
                    points.push(pt.x, -pt.y);
                }
                const strokeColor = `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`;
                let dashAttr = '';
                if (line.attributes.style === "dot line") {
                    dashAttr = ' stroke-dasharray="0.05 0.05"';
                } else if (line.attributes.style === "dash line") {
                    dashAttr = ' stroke-dasharray="0.4 0.2"';
                }

                const pointsStr = points.map(p => p.toString()).join(' ');
                if (line.attributes.arrow && points.length >= 4) {
                    // Draw line + arrowhead
                    lines.push(`<polyline points="${pointsStr}" stroke="${escapeXml(strokeColor)}" stroke-width="${this.settings.lineWidth}" fill="none"${dashAttr}/>`);
                    // Arrowhead at last segment
                    const li = points.length - 2;
                    const tipX = points[li], tipY = points[li + 1];
                    const prevX = points[li - 2], prevY = points[li - 1];
                    const angle = Math.atan2(tipY - prevY, tipX - prevX);
                    const pl = 0.3, pw = 0.1;
                    const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
                    const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
                    const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
                    const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));
                    lines.push(`<polygon points="${tipX},${tipY} ${x1},${y1} ${x2},${y2}" fill="${escapeXml(strokeColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${this.settings.lineWidth}"/>`);
                } else {
                    lines.push(`<polyline points="${pointsStr}" stroke="${escapeXml(strokeColor)}" stroke-width="${this.settings.lineWidth}" fill="none"${dashAttr}/>`);
                }

                // Door on special exit
                const doorType = room.doors[dir];
                if (doorType && points.length >= 4) {
                    const dx = points[0] + (points[2] - points[0]) / 2;
                    const dy = points[1] + (points[3] - points[1]) / 2;
                    const s = this.settings.roomSize / 2;
                    lines.push(`<rect x="${dx - s / 2}" y="${dy - s / 2}" width="${s}" height="${s}" stroke="${getDoorColor(doorType)}" stroke-width="${this.settings.lineWidth}" fill="none"/>`);
                }
            }
        }
    }

    // --- Rooms ---

    private renderRooms(lines: string[], rooms: MapData.Room[]) {
        const rs = this.settings.roomSize;
        const halfRs = rs / 2;

        for (const room of rooms) {
            const envColor = this.mapReader.getColorValue(room.env);
            const fillColor = this.settings.frameMode ? this.settings.backgroundColor : envColor;
            const strokeColor = this.settings.frameMode ? envColor : this.settings.lineColor;

            if (this.settings.roomShape === "circle") {
                lines.push(`<circle cx="${room.x}" cy="${room.y}" r="${halfRs}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${this.settings.lineWidth}"/>`);
            } else {
                const rx = room.x - halfRs;
                const ry = room.y - halfRs;
                const cr = this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0;
                const crAttr = cr > 0 ? ` rx="${cr}" ry="${cr}"` : '';
                lines.push(`<rect x="${rx}" y="${ry}" width="${rs}" height="${rs}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${this.settings.lineWidth}"${crAttr}/>`);

                // Emboss
                if (this.settings.emboss) {
                    const isLight = colorLightness(this.settings.lineColor) > 0.41;
                    const embossColor = isLight ? '#000000' : '#ffffff';
                    const pts = isLight
                        ? `${rx},${ry} ${rx + rs},${ry} ${rx + rs},${ry + rs}`
                        : `${rx},${ry} ${rx},${ry + rs} ${rx + rs},${ry + rs}`;
                    lines.push(`<polyline points="${pts}" stroke="${embossColor}" stroke-width="${this.settings.lineWidth}" fill="none"/>`);
                }
            }

            // Room symbol
            if (room.roomChar) {
                const symbolColor = this.getSymbolColor(room.env);
                const fontSize = rs * 0.75;
                lines.push(`<text x="${room.x}" y="${room.y}" dy="0.35em" font-size="${fontSize}" font-weight="bold" font-family="${escapeXml(this.settings.fontFamily)}" fill="${escapeXml(symbolColor)}" text-anchor="middle">${escapeXml(room.roomChar)}</text>`);
            }
        }
    }

    // --- Inner Exits (up/down/in/out triangles) ---

    private renderInnerExits(lines: string[], rooms: MapData.Room[]) {
        const rs = this.settings.roomSize;
        const triRadius = rs / 5;

        for (const room of rooms) {
            for (const exit of innerExits) {
                if (!room.exits[exit]) continue;

                const symbolColor = this.getSymbolColor(room.env);
                const symbolFill = this.getSymbolColor(room.env, 0.6);
                let doorStroke: string | undefined;
                const doorType = room.doors[exit];
                if (doorType !== undefined) {
                    doorStroke = getDoorColor(doorType);
                }
                const stroke = doorStroke ?? symbolColor;

                // Generate triangle(s) based on exit direction
                switch (exit) {
                    case "up": {
                        const pos = movePoint(room.x, room.y, "south", rs / 4);
                        lines.push(this.svgTriangle(pos.x, pos.y, triRadius, 0, symbolFill, stroke));
                        break;
                    }
                    case "down": {
                        const pos = movePoint(room.x, room.y, "north", rs / 4);
                        lines.push(this.svgTriangle(pos.x, pos.y, triRadius, 180, symbolFill, stroke));
                        break;
                    }
                    case "in": {
                        const posW = movePoint(room.x, room.y, "west", rs / 4);
                        const posE = movePoint(room.x, room.y, "east", rs / 4);
                        lines.push(this.svgTriangle(posW.x, posW.y, triRadius, 90, symbolFill, stroke));
                        lines.push(this.svgTriangle(posE.x, posE.y, triRadius, -90, symbolFill, stroke));
                        break;
                    }
                    case "out": {
                        const posW = movePoint(room.x, room.y, "west", rs / 4);
                        const posE = movePoint(room.x, room.y, "east", rs / 4);
                        lines.push(this.svgTriangle(posW.x, posW.y, triRadius, -90, symbolFill, stroke));
                        lines.push(this.svgTriangle(posE.x, posE.y, triRadius, 90, symbolFill, stroke));
                        break;
                    }
                }
            }
        }
    }

    private svgTriangle(cx: number, cy: number, radius: number, rotationDeg: number, fill: string, stroke: string): string {
        // Generate a 3-sided regular polygon (triangle pointing up at 0 deg)
        // Konva uses scaleX=1.4, scaleY=0.8 on the triangles
        const scaleX = 1.4, scaleY = 0.8;
        const angleRad = rotationDeg * Math.PI / 180;
        const points: string[] = [];
        for (let i = 0; i < 3; i++) {
            // Regular polygon vertex: starting at top (-PI/2 offset for pointing up)
            const a = (2 * Math.PI * i / 3) - Math.PI / 2;
            let px = Math.cos(a) * radius * scaleX;
            let py = Math.sin(a) * radius * scaleY;
            // Rotate
            const rx = px * Math.cos(angleRad) - py * Math.sin(angleRad);
            const ry = px * Math.sin(angleRad) + py * Math.cos(angleRad);
            points.push(`${cx + rx},${cy + ry}`);
        }
        return `<polygon points="${points.join(' ')}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${this.settings.lineWidth}"/>`;
    }

    // --- Overlay: Paths ---

    private renderPathOverlay(lines: string[], locations: number[], color: string, areaId: number, zIndex: number) {
        const result = computePathData(this.mapReader, this.settings, locations, areaId, zIndex);
        const lw = this.settings.lineWidth;

        for (const segment of result.segments) {
            const pts = segment.points.map(p => p.toString()).join(' ');
            // Black outline
            lines.push(`<polyline points="${pts}" stroke="black" stroke-width="${lw * 8}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
            // Colored line
            lines.push(`<polyline points="${pts}" stroke="${escapeXml(color)}" stroke-width="${lw * 4}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
        }

        for (const cl of result.customLines) {
            const pts = cl.points.map(p => p.toString()).join(' ');
            lines.push(`<polyline points="${pts}" stroke="black" stroke-width="${lw * 8}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
            lines.push(`<polyline points="${pts}" stroke="${escapeXml(color)}" stroke-width="${lw * 4}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
        }

        const triRadius = this.settings.roomSize / 5;
        for (const marker of result.innerMarkers) {
            lines.push(this.svgTriangle(marker.room.x, marker.room.y, triRadius, this.innerExitRotation(marker.direction), color, 'black'));
        }
    }

    private innerExitRotation(direction: MapData.direction): number {
        switch (direction) {
            case "up": return 0;
            case "down": return 180;
            case "in": return 90;
            case "out": return -90;
            default: return 0;
        }
    }

    // --- Overlay: Highlights ---

    private renderHighlightOverlay(lines: string[], roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const factor = 1.5;
        const rs = this.settings.roomSize;
        const dash = '0.05 0.05';

        if (this.settings.roomShape === "circle") {
            lines.push(`<circle cx="${room.x}" cy="${room.y}" r="${rs / 2 * factor}" stroke="${escapeXml(color)}" stroke-width="0.1" stroke-dasharray="${dash}" fill="none"/>`);
        } else {
            const sz = rs * factor;
            lines.push(`<rect x="${room.x - sz / 2}" y="${room.y - sz / 2}" width="${sz}" height="${sz}" stroke="${escapeXml(color)}" stroke-width="0.1" stroke-dasharray="${dash}" fill="none"/>`);
        }
    }

    // --- Overlay: Position Marker ---

    private renderPositionMarker(lines: string[], roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const pm = this.settings.playerMarker;
        const rs = this.settings.roomSize;
        const size = rs * pm.sizeFactor;
        const dashAttr = pm.dashEnabled && pm.dash ? ` stroke-dasharray="${pm.dash.join(' ')}"` : '';
        const fillOpacity = pm.fillAlpha > 0 ? ` fill="${pm.fillColor}" fill-opacity="${pm.fillAlpha}"` : ' fill="none"';

        lines.push(`<circle cx="${room.x}" cy="${room.y}" r="${size / 2}" stroke="${pm.strokeColor}" stroke-width="${pm.strokeWidth}" stroke-opacity="${pm.strokeAlpha}"${dashAttr}${fillOpacity}/>`);
    }
}
