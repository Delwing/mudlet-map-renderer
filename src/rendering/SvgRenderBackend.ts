import {SvgBackend, SvgGroupNode, SvgLayerNode} from "../backend/SvgBackend";
import {ScenePipeline} from "../ScenePipeline";
import {drawExitDataToSvgLines} from "../scene/ExitDataRenderer";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {renderHighlight, renderPositionMarker, renderPathOverlay} from "../scene/OverlayRenderer";
import type {SvgOverlays} from "../SvgTypes";
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

        // Overlays (rendered through DrawingBackend like KonvaRenderBackend)
        const overlays = options?.overlays;
        if (overlays) {
            if (overlays.paths) {
                for (const path of overlays.paths) {
                    const data = computePathOverlay(this.state.mapReader, settings, path.locations, path.color, currentArea, currentZIndex);
                    const group = renderPathOverlay(svgBackend, data) as SvgGroupNode;
                    const svg = group.toSvg();
                    if (svg) lines.push(svg);
                }
            }
            if (overlays.highlights) {
                for (const hl of overlays.highlights) {
                    const room = this.state.mapReader.getRoom(hl.roomId);
                    if (!room) continue;
                    const data = computeHighlight(room, hl.color, settings);
                    const group = renderHighlight(svgBackend, data) as SvgGroupNode;
                    const svg = group.toSvg();
                    if (svg) lines.push(svg);
                }
            }
            if (overlays.position) {
                const room = this.state.mapReader.getRoom(overlays.position.roomId);
                if (room) {
                    const data = computePositionMarker(room, settings);
                    const group = renderPositionMarker(svgBackend, data) as SvgGroupNode;
                    const svg = group.toSvg();
                    if (svg) lines.push(svg);
                }
            }
        }

        lines.push('</svg>');
        return lines.join('\n');
    }
}
