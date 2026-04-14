import ExitRenderer from "../ExitRenderer";
import {RoomShapeRenderer} from "../RoomShapeRenderer";
import {SvgBackend, SvgGroupNode} from "../backend/SvgBackend";
import {drawExitDataToSvgLines} from "../scene/ExitDataRenderer";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {computeInnerExits} from "../scene/InnerExitStyle";
import {computeGrid} from "../scene/GridStyle";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import type {SvgOverlays} from "../SvgExporter";
import type {MapState} from "../MapState";

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * SVG rendering backend. Builds an SVG string from MapState using the same
 * pure-math scene computation as the Konva backend (scene/*.ts + DrawingBackend).
 *
 * Rooms and grid go through DrawingBackend (SvgBackend) for engine-agnostic rendering.
 * Exits, labels, and overlays use the existing pure-data functions.
 */
export class SvgRenderBackend {
    private readonly state: MapState;
    private readonly backend: SvgBackend;
    private readonly roomShapeRenderer: RoomShapeRenderer;
    private readonly exitRenderer: ExitRenderer;

    constructor(state: MapState) {
        this.state = state;
        this.backend = new SvgBackend();
        this.roomShapeRenderer = new RoomShapeRenderer(state.mapReader, state.settings, this.backend);
        this.exitRenderer = new ExitRenderer(state.mapReader, state.settings);
    }

    /**
     * Export the current area as an SVG string.
     */
    exportSvg(options?: { roomId?: number; padding?: number; overlays?: SvgOverlays }): string | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = this.state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = this.state.settings;
        const mapReader = this.state.mapReader;
        const padding = options?.padding ?? 3;
        const bounds = this.state.computeExportBounds(area, plane, options?.roomId, padding);

        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`);
        lines.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(settings.backgroundColor)}"/>`);

        // Grid
        if (settings.gridEnabled) {
            const grid = computeGrid(settings, bounds);
            const color = escapeXml(grid.stroke);
            for (const l of grid.lines) {
                lines.push(`<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${color}" stroke-width="${grid.strokeWidth}"/>`);
            }
        }

        // Labels
        this.renderLabels(lines, plane.getLabels());

        // Link exits
        const exits = area.getLinkExits(currentZIndex);
        for (const exit of exits) {
            const data = this.exitRenderer.renderData(exit, currentZIndex);
            if (!data) continue;
            drawExitDataToSvgLines(lines, data);
        }

        // Special exits, stubs, rooms, inner exits
        const rooms = plane.getRooms() ?? [];
        this.renderSpecialExits(lines, rooms);
        this.renderStubs(lines, rooms);
        this.renderRooms(lines, rooms);
        this.renderInnerExits(lines, rooms);

        // Overlays
        const overlays = options?.overlays;
        if (overlays) {
            if (overlays.paths) {
                for (const path of overlays.paths) {
                    this.renderPathOverlay(lines, path.locations, path.color, currentArea, currentZIndex);
                }
            }
            if (overlays.highlights) {
                for (const hl of overlays.highlights) {
                    this.renderHighlight(lines, hl.roomId, hl.color);
                }
            }
            if (overlays.position) {
                this.renderPositionMarker(lines, overlays.position.roomId);
            }
        }

        // Area name
        if (settings.areaName) {
            const name = area.getAreaName();
            if (name) {
                const eb = this.state.getEffectiveBounds(area, plane);
                lines.push(`<text x="${eb.minX - 3.5}" y="${eb.minY - 2}" font-size="2.5" font-family="${escapeXml(settings.fontFamily)}" fill="white">${escapeXml(name)}</text>`);
            }
        }

        lines.push('</svg>');
        return lines.join('\n');
    }

    // --- Rooms (through DrawingBackend) ---

    private renderRooms(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            const group = this.roomShapeRenderer.createRoomGroup(room) as SvgGroupNode;
            const svg = group.toSvg();
            if (svg) lines.push(svg);
        }
    }

    // --- Labels ---

    private renderLabels(lines: string[], labels: MapData.Label[]) {
        const settings = this.state.settings;
        if (settings.labelRenderMode === "none") return;

        for (const label of labels) {
            const lx = label.X;
            const ly = -label.Y;

            if (settings.labelRenderMode === "image" && label.pixMap) {
                lines.push(`<image x="${lx}" y="${ly}" width="${label.Width}" height="${label.Height}" href="data:image/png;base64,${label.pixMap}"/>`);
                continue;
            }

            if ((label.BgColor?.alpha ?? 0) > 0 && !settings.transparentLabels) {
                const bg = this.labelColor(label.BgColor);
                lines.push(`<rect x="${lx}" y="${ly}" width="${label.Width}" height="${label.Height}" fill="${bg}"/>`);
            }

            if (label.Text) {
                const fg = this.labelColor(label.FgColor);
                const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
                const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));
                lines.push(`<text x="${lx + label.Width / 2}" y="${ly + label.Height / 2}" font-size="${fontSize}" font-family="${escapeXml(settings.fontFamily)}" fill="${fg}" text-anchor="middle" dominant-baseline="central">${escapeXml(label.Text)}</text>`);
            }
        }
    }

    private labelColor(color: MapData.Color): string {
        const alpha = (color?.alpha ?? 255) / 255;
        const clamp = (v: number) => Math.min(255, Math.max(0, v ?? 0));
        return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
    }

    // --- Stubs ---

    private renderStubs(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const stub of computeStubs(room, this.state.settings)) {
                lines.push(`<line x1="${stub.x1}" y1="${stub.y1}" x2="${stub.x2}" y2="${stub.y2}" stroke="${escapeXml(stub.stroke)}" stroke-width="${stub.strokeWidth}"/>`);
            }
        }
    }

    // --- Special Exits ---

    private renderSpecialExits(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            for (const se of computeSpecialExits(room, this.state.settings)) {
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

    // --- Inner Exits ---

    private renderInnerExits(lines: string[], rooms: MapData.Room[]) {
        for (const room of rooms) {
            const {triangles} = computeInnerExits(room, this.state.mapReader, this.state.settings);
            for (const tri of triangles) {
                const points: string[] = [];
                for (let i = 0; i < tri.vertices.length; i += 2) {
                    points.push(`${tri.vertices[i]},${tri.vertices[i + 1]}`);
                }
                lines.push(`<polygon points="${points.join(' ')}" fill="${escapeXml(tri.fill)}" stroke="${escapeXml(tri.stroke)}" stroke-width="${tri.strokeWidth}"/>`);
            }
        }
    }

    // --- Overlays ---

    private renderPathOverlay(lines: string[], locations: number[], color: string, areaId: number, zIndex: number) {
        const data = computePathOverlay(this.state.mapReader, this.state.settings, locations, color, areaId, zIndex);
        for (const seg of data.segments) {
            const pts = seg.points.map(p => p.toString()).join(' ');
            lines.push(`<polyline points="${pts}" stroke="black" stroke-width="${data.outlineWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
            lines.push(`<polyline points="${pts}" stroke="${escapeXml(data.color)}" stroke-width="${data.lineWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.8"/>`);
        }
        for (const tri of data.triangles) {
            const points: string[] = [];
            for (let i = 0; i < tri.vertices.length; i += 2) {
                points.push(`${tri.vertices[i]},${tri.vertices[i + 1]}`);
            }
            lines.push(`<polygon points="${points.join(' ')}" fill="${escapeXml(data.color)}" stroke="black" stroke-width="${this.state.settings.lineWidth}"/>`);
        }
    }

    private renderHighlight(lines: string[], roomId: number, color: string) {
        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;
        const hl = computeHighlight(room, color, this.state.settings);
        const dashAttr = ` stroke-dasharray="${hl.dash.join(' ')}"`;
        if (hl.shape === 'circle') {
            lines.push(`<circle cx="${hl.cx}" cy="${hl.cy}" r="${hl.size}" stroke="${escapeXml(hl.stroke)}" stroke-width="${hl.strokeWidth}"${dashAttr} fill="none"/>`);
        } else {
            const crAttr = hl.cornerRadius > 0 ? ` rx="${hl.cornerRadius}" ry="${hl.cornerRadius}"` : '';
            lines.push(`<rect x="${hl.cx - hl.size}" y="${hl.cy - hl.size}" width="${hl.size * 2}" height="${hl.size * 2}" stroke="${escapeXml(hl.stroke)}" stroke-width="${hl.strokeWidth}"${dashAttr} fill="none"${crAttr}/>`);
        }
    }

    private renderPositionMarker(lines: string[], roomId: number) {
        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;
        const pm = computePositionMarker(room, this.state.settings);
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
