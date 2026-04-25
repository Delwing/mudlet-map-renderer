import {ScenePipeline} from "../ScenePipeline";
import {computeHighlight, computePathOverlay, computePositionMarker} from "../scene/OverlayStyle";
import {
    highlightToShapes,
    pathToShapes,
    positionMarkerToShape,
} from "../scene/elements/OverlayLayout";
import {buildDrawCommands} from "../draw/DrawCommandBuilder";
import {svgFromBatches} from "../render/SvgRenderer";
import type {Shape} from "../scene/Shape";
import type {SvgExportOptions} from "../SvgTypes";
import type {MapState} from "../MapState";
import type {Exporter, ExportContext} from "./Exporter";

const IDENTITY_CAMERA = {scale: 1, offsetX: 0, offsetY: 0};

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Renders the current scene as an SVG string by driving
 * {@link ScenePipeline} → {@link buildDrawCommands} → {@link svgFromBatches}.
 *
 * The pipeline is rebuilt with bounded viewport bounds (so the grid layout
 * matches the export region), then `sceneShapes` is flushed through the
 * draw-command pipeline at scale 1 — coordinates land inside the SVG
 * viewBox in world space, identical to the legacy SvgBackend output. Active
 * {@link SceneOverlay}s are still rendered against an {@link SvgBackend}
 * so user code that builds custom overlays via the DrawingBackend keeps
 * working until the overlay API is migrated to shapes.
 */
export class SvgExporter implements Exporter<string | undefined> {
    constructor(private readonly options: SvgExportOptions = {}) {}

    render({state, sceneOverlays}: ExportContext): string | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);
        const viewportBounds = {
            minX: bounds.x, maxX: bounds.x + bounds.w,
            minY: bounds.y, maxY: bounds.y + bounds.h,
        };

        const pipeline = new ScenePipeline(state.mapReader, settings);
        const result = pipeline.buildScene(area, plane, currentZIndex, viewportBounds);

        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}">`);
        lines.push(`<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" fill="${escapeXml(settings.backgroundColor)}"/>`);

        const flush = (shapes: Shape[]) => {
            if (shapes.length === 0) return;
            lines.push(...svgFromBatches(buildDrawCommands(shapes, IDENTITY_CAMERA)));
        };

        flush(result.sceneShapes.grid);
        flush(result.sceneShapes.link);
        flush(result.sceneShapes.room);

        // Built-in overlays (paths under highlights under the position marker)
        // emit at the same z as the legacy `renderBuiltInOverlays` did:
        // appended after the room layer, before the top-label layer.
        flush(this.buildBuiltInOverlayShapes(state));

        // SceneOverlays return shapes; flush them through the same
        // DrawCommandBuilder + SvgRenderer path as the rest of the scene.
        for (const overlay of sceneOverlays) {
            const out = overlay.render(state, viewportBounds);
            if (!out) continue;
            const overlayShapes = Array.isArray(out) ? out : [out];
            flush(overlayShapes);
        }

        flush(result.sceneShapes.topLabel);

        lines.push("</svg>");
        return lines.join("\n");
    }

    private buildBuiltInOverlayShapes(state: MapState): Shape[] {
        const overlays = state.getOverlaysForArea(this.options.overlays);
        if (!overlays) return [];
        const settings = state.settings;
        const out: Shape[] = [];

        if (overlays.paths) {
            for (const path of overlays.paths) {
                const data = computePathOverlay(
                    state.mapReader, settings, path.locations, path.color,
                    state.currentArea!, state.currentZIndex!,
                );
                out.push(...pathToShapes(data));
            }
        }
        if (overlays.highlights) {
            for (const hl of overlays.highlights) {
                const room = state.mapReader.getRoom(hl.roomId);
                if (!room) continue;
                out.push(...highlightToShapes(computeHighlight(room, hl.color, settings)));
            }
        }
        if (overlays.position) {
            const room = state.mapReader.getRoom(overlays.position.roomId);
            if (room) {
                out.push(positionMarkerToShape(computePositionMarker(room, settings)));
            }
        }
        return out;
    }
}
