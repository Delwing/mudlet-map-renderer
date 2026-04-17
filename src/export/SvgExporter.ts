import {SvgBackend, SvgGroupNode, SvgLayerNode} from "../backend/SvgBackend";
import {ScenePipeline} from "../ScenePipeline";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeAmbientLight} from "../scene/AmbientLightStyle";
import {renderHighlight, renderPositionMarker, renderPathOverlay, renderAmbientLight} from "../scene/OverlayRenderer";
import type {SvgExportOptions, SvgOverlays} from "../SvgTypes";
import type {MapState} from "../MapState";
import type {DrawingBackend, Style} from "../backend/DrawingBackend";
import type {Exporter} from "./Exporter";
import type {SceneOverlay} from "../overlay/SceneOverlay";

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Exports the current scene as an SVG string through the shared
 * {@link ScenePipeline}. The optional `style` applies the same decorator chain
 * used on the interactive canvas, so e.g. `Isometric` or `Parchment` renders
 * identically across targets.
 *
 * Applies any {@link SceneOverlay}s passed in `overlays`; interactive-only
 * `LiveEffect`s are ignored by design.
 */
export class SvgExporter implements Exporter<string | undefined> {
    constructor(private readonly options: SvgExportOptions = {}) {}

    render(
        state: MapState,
        style?: Style,
        sceneOverlays?: Iterable<SceneOverlay>,
    ): string | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);

        const rawSvgBackend = new SvgBackend();
        const svgBackend: DrawingBackend = style ? style(rawSvgBackend) : rawSvgBackend;
        const gridLayer = new SvgLayerNode();
        const linkLayer = new SvgLayerNode();
        const roomLayer = new SvgLayerNode();

        const pipeline = new ScenePipeline(state.mapReader, settings, svgBackend, {
            gridLayer, linkLayer, roomLayer,
        });

        const viewportBounds = {
            minX: bounds.x, maxX: bounds.x + bounds.w,
            minY: bounds.y, maxY: bounds.y + bounds.h,
        };

        pipeline.buildScene(area, plane, currentZIndex, viewportBounds);

        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`);
        lines.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(settings.backgroundColor)}"/>`);

        const gridSvg = gridLayer.toSvg();
        if (gridSvg) lines.push(gridSvg);
        const linkSvg = linkLayer.toSvg();
        if (linkSvg) lines.push(linkSvg);
        const roomSvg = roomLayer.toSvg();
        if (roomSvg) lines.push(roomSvg);

        const overlays = state.getOverlaysForArea(this.options.overlays);
        this.renderBuiltInOverlays(overlays, svgBackend, state, viewportBounds, lines);

        // User-provided SceneOverlays render into an SVG group each.
        if (sceneOverlays) {
            for (const overlay of sceneOverlays) {
                const out = overlay.render(svgBackend, state, viewportBounds);
                const nodes = out === undefined ? [] : Array.isArray(out) ? out : [out];
                for (const node of nodes) {
                    if (node instanceof SvgGroupNode) {
                        const svg = node.toSvg();
                        if (svg) lines.push(svg);
                    }
                }
            }
        }

        lines.push('</svg>');
        return lines.join('\n');
    }

    private renderBuiltInOverlays(
        overlays: SvgOverlays | undefined,
        svgBackend: DrawingBackend,
        state: MapState,
        viewportBounds: { minX: number; maxX: number; minY: number; maxY: number },
        lines: string[],
    ) {
        if (!overlays) return;
        const settings = state.settings;

        if (overlays.paths) {
            for (const path of overlays.paths) {
                const data = computePathOverlay(
                    state.mapReader, settings, path.locations, path.color,
                    state.currentArea!, state.currentZIndex!,
                );
                const group = renderPathOverlay(svgBackend, data) as SvgGroupNode;
                const svg = group.toSvg();
                if (svg) lines.push(svg);
            }
        }
        if (overlays.highlights) {
            for (const hl of overlays.highlights) {
                const room = state.mapReader.getRoom(hl.roomId);
                if (!room) continue;
                const data = computeHighlight(room, hl.color, settings);
                const group = renderHighlight(svgBackend, data) as SvgGroupNode;
                const svg = group.toSvg();
                if (svg) lines.push(svg);
            }
        }
        if (overlays.position) {
            if (settings.ambientLight.enabled) {
                const room = state.mapReader.getRoom(overlays.position.roomId);
                if (room) {
                    const alData = computeAmbientLight(room.x, room.y, viewportBounds, settings);
                    const alGroup = renderAmbientLight(svgBackend, alData) as SvgGroupNode;
                    const alSvg = alGroup.toSvg();
                    if (alSvg) lines.push(alSvg);
                }
            }

            const room = state.mapReader.getRoom(overlays.position.roomId);
            if (room) {
                const data = computePositionMarker(room, settings);
                const group = renderPositionMarker(svgBackend, data) as SvgGroupNode;
                const svg = group.toSvg();
                if (svg) lines.push(svg);
            }
        }
    }
}
