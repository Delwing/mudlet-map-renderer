import {Camera} from '../Camera';
import {SvgRenderingBackend} from '../rendering/SvgRenderingBackend';
import type {MapRenderer} from '../rendering/MapRenderer';
import {computeHighlight, computePositionMarker, computePathOverlay} from '../scene/OverlayStyle';
import {renderHighlight, renderPositionMarker, renderPathOverlay} from '../scene/OverlayRenderer';
import type {SvgExportOptions, SvgOverlays} from '../SvgTypes';
import type {MapState} from '../MapState';
import type {Exporter, ExportContext} from './Exporter';
import type {ViewportBounds} from '../types/Settings';

/**
 * Renders the current scene as an SVG string via SvgRenderingBackend.
 * Attaches a backend with an export camera, optionally renders custom
 * overlays into the backend's overlay layer, then serialises and destroys.
 */
export class SvgExporter implements Exporter<string | undefined> {
    constructor(private readonly options: SvgExportOptions = {}) {}

    render({ state, renderer, style, sceneOverlays }: ExportContext): string | undefined {
        const { currentArea, currentZIndex, currentAreaInstance } = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);
        const viewportBounds: ViewportBounds = {
            minX: bounds.x, maxX: bounds.x + bounds.w,
            minY: bounds.y, maxY: bounds.y + bounds.h,
        };

        // Build an export camera whose viewport covers exactly the export bounds.
        // fitToMapBounds with dimensions = bounds * BASE_SCALE yields zoom=1,
        // so getViewportBounds() == { minX: bounds.x, maxX: bounds.x+w, ... }.
        const exportCam = new Camera(1, 1);
        const baseScale = exportCam.getScale(); // BASE_SCALE * zoom=1
        exportCam.width  = Math.max(1, Math.ceil(bounds.w * baseScale));
        exportCam.height = Math.max(1, Math.ceil(bounds.h * baseScale));
        exportCam.fitToMapBounds(bounds.x, bounds.x + bounds.w, bounds.y, bounds.y + bounds.h);

        // Attach SVG backend — scene builds immediately in _attachBackend.
        // renderer is always a MapRenderer at runtime; ExportContext uses RendererHandle for decoupling.
        const svgBackend = new SvgRenderingBackend(renderer as unknown as MapRenderer, exportCam, style);

        // Render custom built-in overlays (options.overlays) into the overlay layer.
        const overlays = state.getOverlaysForArea(this.options.overlays);
        if (overlays) {
            this.renderOverlaysToBackend(overlays, svgBackend, state, viewportBounds);
        }

        // Render scene overlays into the overlay layer.
        for (const overlay of sceneOverlays) {
            const out = overlay.render(svgBackend.drawingBackend, state, viewportBounds);
            if (!out) continue;
            const nodes = Array.isArray(out) ? out : [out];
            for (const node of nodes) svgBackend.overlayLayer.addNode(node);
        }

        const svg = svgBackend.toSvg(bounds);
        svgBackend.destroy();
        return svg;
    }

    private renderOverlaysToBackend(
        overlays: SvgOverlays,
        svgBackend: SvgRenderingBackend,
        state: MapState,
        _viewportBounds: ViewportBounds,
    ) {
        const settings = state.settings;
        const db = svgBackend.drawingBackend;

        if (overlays.paths) {
            for (const path of overlays.paths) {
                const data = computePathOverlay(
                    state.mapReader, settings, path.locations, path.color,
                    state.currentArea!, state.currentZIndex!,
                );
                svgBackend.overlayLayer.addNode(renderPathOverlay(db, data));
            }
        }
        if (overlays.highlights) {
            for (const hl of overlays.highlights) {
                const room = state.mapReader.getRoom(hl.roomId);
                if (!room) continue;
                const data = computeHighlight(room, hl.color, settings);
                svgBackend.overlayLayer.addNode(renderHighlight(db, data));
            }
        }
        if (overlays.position) {
            const room = state.mapReader.getRoom(overlays.position.roomId);
            if (room) {
                const data = computePositionMarker(room, settings);
                svgBackend.overlayLayer.addNode(renderPositionMarker(db, data));
            }
        }
    }
}
