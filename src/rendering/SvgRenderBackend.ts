import {SvgBackend, SvgLayerNode} from "../backend/SvgBackend";
import {ScenePipeline} from "../ScenePipeline";
import {drawExitDataToSvgLines} from "../scene/ExitDataRenderer";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import type {SvgOverlays} from "../SvgExporter";
import type {MapState} from "../MapState";

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * SVG rendering backend. Uses the shared ScenePipeline with SvgBackend
 * to produce SVG output through the same DrawingBackend interface as Konva.
 *
 * Grid, labels, rooms (with stubs + inner exits), special exits, and area name
 * all go through ScenePipeline → DrawingBackend. Link exits and overlays are
 * serialized directly from pure data.
 */
export class SvgRenderBackend {
    private readonly state: MapState;

    constructor(state: MapState) {
        this.state = state;
    }

    exportSvg(options?: { roomId?: number; padding?: number; overlays?: SvgOverlays }): string | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = this.state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = this.state.settings;
        const padding = options?.padding ?? 3;
        const bounds = this.state.computeExportBounds(area, plane, options?.roomId, padding);

        // Set up SVG layers
        const svgBackend = new SvgBackend();
        const gridLayer = new SvgLayerNode();
        const linkLayer = new SvgLayerNode();
        const roomLayer = new SvgLayerNode();

        // Build scene through shared pipeline
        const pipeline = new ScenePipeline(this.state.mapReader, settings, svgBackend, {
            gridLayer, linkLayer, roomLayer,
        });

        const viewportBounds = {
            minX: bounds.x, maxX: bounds.x + bounds.w,
            minY: bounds.y, maxY: bounds.y + bounds.h,
        };

        const result = pipeline.buildScene(area, plane, currentZIndex, viewportBounds);

        // Assemble SVG
        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`);
        lines.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(settings.backgroundColor)}"/>`);

        // Grid layer
        const gridSvg = gridLayer.toSvg();
        if (gridSvg) lines.push(gridSvg);

        // Link layer (labels + special exits from pipeline)
        const linkSvg = linkLayer.toSvg();
        if (linkSvg) lines.push(linkSvg);

        // Link exits (serialized directly from exit data)
        for (const data of result.exitDrawData) {
            drawExitDataToSvgLines(lines, data);
        }

        // Room layer (rooms with stubs + inner exits + area name)
        const roomSvg = roomLayer.toSvg();
        if (roomSvg) lines.push(roomSvg);

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

        lines.push('</svg>');
        return lines.join('\n');
    }

    // --- Overlays (not yet in pipeline — use pure-math scene functions) ---

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
