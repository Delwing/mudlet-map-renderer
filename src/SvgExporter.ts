import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import Plane from "./reader/Plane";
import ExitRenderer from "./ExitRenderer";
import type {Settings} from "./Renderer";
import {measureTextBaselineOffset} from "./utils/textMeasure";
import {computeRoomColors, computeEmboss} from "./scene/RoomStyle";
import {computeInnerExits} from "./scene/InnerExitStyle";
import {computeStubs} from "./scene/StubStyle";
import {computeSpecialExits} from "./scene/SpecialExitStyle";
import {drawExitDataToSvgLines} from "./scene/ExitDataRenderer";
import {computeGrid} from "./scene/GridStyle";
import {computeHighlight, computePositionMarker, computePathOverlay} from "./scene/OverlayStyle";

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
        this.exitRenderer = new ExitRenderer(mapReader, settings);
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

    // --- Grid ---

    private renderGrid(lines: string[], bounds: { x: number; y: number; w: number; h: number }) {
        const grid = computeGrid(this.settings, bounds);
        const color = escapeXml(grid.stroke);
        for (const l of grid.lines) {
            lines.push(`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${color}" stroke-width="${grid.strokeWidth}"/>`);
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
            drawExitDataToSvgLines(lines, data);
        }
    }

    // --- Stubs ---

    private renderStubs(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const stub of computeStubs(room, this.settings)) {
                lines.push(`<line x1="${stub.x1}" y1="${stub.y1}" x2="${stub.x2}" y2="${stub.y2}" stroke="${escapeXml(stub.stroke)}" stroke-width="${stub.strokeWidth}"/>`);
            }
        }
    }

    // --- Special Exits (custom lines) ---

    private renderSpecialExits(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const se of computeSpecialExits(room, this.settings)) {
                const pts = se.line.points.map(p => p.toString()).join(' ');
                const dash = se.line.dash ? ` stroke-dasharray="${se.line.dash.join(' ')}"` : '';
                lines.push(`<polyline points="${pts}" stroke="${escapeXml(se.line.stroke)}" stroke-width="${se.line.strokeWidth}" fill="none"${dash}/>`);
                if (se.arrow) {
                    const a = se.arrow;
                    lines.push(`<polygon points="${a.tipX},${a.tipY} ${a.x1},${a.y1} ${a.x2},${a.y2}" fill="${escapeXml(a.fill)}" stroke="${escapeXml(a.stroke)}" stroke-width="${a.strokeWidth}"/>`);
                }
                if (se.door) {
                    const d = se.door;
                    lines.push(`<rect x="${d.x}" y="${d.y}" width="${d.width}" height="${d.height}" stroke="${escapeXml(d.stroke)}" stroke-width="${d.strokeWidth}" fill="none"/>`);
                }
            }
        }
    }

    // --- Rooms ---

    private renderRooms(lines: string[], rooms: MapData.Room[]) {
        const rs = this.settings.roomSize;
        const halfRs = rs / 2;

        for (const room of rooms) {
            const {fillColor, strokeColor, borderWidth, symbolColor} = computeRoomColors(
                room, this.mapReader, this.settings,
            );

            if (this.settings.roomShape === "circle") {
                lines.push(`<circle cx="${room.x}" cy="${room.y}" r="${halfRs}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${borderWidth}"/>`);
            } else {
                const rx = room.x - halfRs;
                const ry = room.y - halfRs;
                const cr = this.settings.roomShape === "roundedRectangle" ? rs * 0.2 : 0;
                const crAttr = cr > 0 ? ` rx="${cr}" ry="${cr}"` : '';
                lines.push(`<rect x="${rx}" y="${ry}" width="${rs}" height="${rs}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${borderWidth}"${crAttr}/>`);

                const emboss = computeEmboss(this.settings);
                if (emboss) {
                    const pts = emboss.points;
                    const svgPts = `${rx + pts[0]},${ry + pts[1]} ${rx + pts[2]},${ry + pts[3]} ${rx + pts[4]},${ry + pts[5]}`;
                    lines.push(`<polyline points="${svgPts}" stroke="${emboss.stroke}" stroke-width="${emboss.strokeWidth}" fill="none"/>`);
                }
            }

            if (room.roomChar) {
                const fontSize = rs * 0.75;
                const baselineY = room.y + measureTextBaselineOffset(room.roomChar, this.settings.fontFamily) * fontSize;
                lines.push(`<text x="${room.x}" y="${baselineY}" font-size="${fontSize}" font-weight="bold" font-family="${escapeXml(this.settings.fontFamily)}" fill="${escapeXml(symbolColor)}" text-anchor="middle">${escapeXml(room.roomChar)}</text>`);
            }
        }
    }

    // --- Inner Exits (up/down/in/out triangles) ---

    private renderInnerExits(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            const {triangles} = computeInnerExits(room, this.mapReader, this.settings);
            for (const tri of triangles) {
                lines.push(this.svgPolygon(tri.vertices, tri.fill, tri.stroke, tri.strokeWidth));
            }
        }
    }

    private svgPolygon(vertices: number[], fill: string, stroke: string, strokeWidth: number): string {
        const points: string[] = [];
        for (let i = 0; i < vertices.length; i += 2) {
            points.push(`${vertices[i]},${vertices[i + 1]}`);
        }
        return `<polygon points="${points.join(' ')}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"/>`;
    }

    // --- Overlay: Paths ---

    private renderPathOverlay(lines: string[], locations: number[], color: string, areaId: number, zIndex: number) {
        const data = computePathOverlay(this.mapReader, this.settings, locations, color, areaId, zIndex);
        for (const seg of data.segments) {
            const pts = seg.points.map(p => p.toString()).join(' ');
            lines.push(`<polyline points="${pts}" stroke="black" stroke-width="${data.outlineWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
            lines.push(`<polyline points="${pts}" stroke="${escapeXml(data.color)}" stroke-width="${data.lineWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
        }
        for (const tri of data.triangles) {
            lines.push(this.svgPolygon(tri.vertices, data.color, 'black', this.settings.lineWidth));
        }
    }

    // --- Overlay: Highlights ---

    private renderHighlightOverlay(lines: string[], roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const hl = computeHighlight(room, color, this.settings);
        const dashAttr = ` stroke-dasharray="${hl.dash.join(' ')}"`;
        if (hl.shape === 'circle') {
            lines.push(`<circle cx="${hl.cx}" cy="${hl.cy}" r="${hl.size}" stroke="${escapeXml(hl.stroke)}" stroke-width="${hl.strokeWidth}"${dashAttr} fill="none"/>`);
        } else {
            const crAttr = hl.cornerRadius > 0 ? ` rx="${hl.cornerRadius}" ry="${hl.cornerRadius}"` : '';
            lines.push(`<rect x="${hl.cx - hl.size}" y="${hl.cy - hl.size}" width="${hl.size * 2}" height="${hl.size * 2}" stroke="${escapeXml(hl.stroke)}" stroke-width="${hl.strokeWidth}"${dashAttr} fill="none"${crAttr}/>`);
        }
    }

    // --- Overlay: Position Marker ---

    private renderPositionMarker(lines: string[], roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const pm = computePositionMarker(room, this.settings);
        const dashAttr = pm.dashEnabled && pm.dash ? ` stroke-dasharray="${pm.dash.join(' ')}"` : '';
        const fillOpacity = pm.fillAlpha > 0 ? ` fill="${pm.fillColor}" fill-opacity="${pm.fillAlpha}"` : ' fill="none"';
        const strokeAttrs = `stroke="${pm.strokeColor}" stroke-width="${pm.strokeWidth}" stroke-opacity="${pm.strokeAlpha}"${dashAttr}${fillOpacity}`;

        if (pm.shape === 'rect') {
            const crAttr = pm.cornerRadius > 0 ? ` rx="${pm.cornerRadius}" ry="${pm.cornerRadius}"` : '';
            lines.push(`<rect x="${pm.cx - pm.size}" y="${pm.cy - pm.size}" width="${pm.size * 2}" height="${pm.size * 2}" ${strokeAttrs}${crAttr}/>`);
        } else {
            lines.push(`<circle cx="${pm.cx}" cy="${pm.cy}" r="${pm.size}" ${strokeAttrs}/>`);
        }
    }
}
