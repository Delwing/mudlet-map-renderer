import {ScenePipeline} from "../ScenePipeline";
import {Camera} from "../camera/Camera";
import {buildDrawCommands} from "../draw/DrawCommandBuilder";
import {svgFromBatches} from "../render/SvgRenderer";
import type {Shape} from "../scene/Shape";
import type {SvgExportOptions} from "../SvgTypes";
import {applyStyleToShapes} from "../style/applyStyle";
import {identityStyle} from "../style/Style";
import type {Style} from "../style/Style";
import type {Exporter, ExportContext} from "./Exporter";
import {flushSceneShapes} from "./flushSceneShapes";
import {clipSceneToViewport} from "./clipSceneToViewport";
import {projectExportBoundsToScene} from "./sceneBounds";

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

    render({state, style, sceneOverlays}: ExportContext): string | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);
        const exportCamera = Camera.forMapBounds(bounds.x, bounds.x + bounds.w, bounds.y, bounds.y + bounds.h);
        const viewportBounds = exportCamera.getViewportBounds();

        const pipeline = new ScenePipeline(state.mapReader, settings);
        const result = pipeline.buildScene(area, plane, currentZIndex, state.lens);
        const transforms = {
            forward: style.worldToScene ? (x: number, y: number) => style.worldToScene!(x, y) : undefined,
            inverse: style.sceneToWorld ? (x: number, y: number) => style.sceneToWorld!(x, y) : undefined,
        };
        const clipped = clipSceneToViewport(result, viewportBounds, settings, transforms);
        const ctx = {scale: 1, roomSize: settings.roomSize};
        const styled = (shapes: Shape[]): Shape[] =>
            style === identityStyle ? shapes : applyStyleToShapes(shapes, style as Style, ctx);

        // Coordinate-warping styles (Isometric) render shapes in scene space —
        // the viewBox and background rect must follow the projection so rooms
        // don't drift off the background. Scene-pad covers projection-unaware
        // decorations (cube depth, glow halos, …).
        const sceneBounds = projectExportBoundsToScene(bounds, style, settings.roomSize * 0.5);

        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sceneBounds.x} ${sceneBounds.y} ${sceneBounds.w} ${sceneBounds.h}">`);
        lines.push(`<rect x="${sceneBounds.x}" y="${sceneBounds.y}" width="${sceneBounds.w}" height="${sceneBounds.h}" fill="${escapeXml(settings.backgroundColor)}"/>`);

        const flush = (shapes: Shape[]) => {
            if (shapes.length === 0) return;
            lines.push(...svgFromBatches(buildDrawCommands(styled(shapes), IDENTITY_CAMERA)));
        };

        flushSceneShapes(
            clipped,
            {state, viewportBounds, sceneOverlays, overlays: this.options.overlays},
            flush,
        );

        lines.push("</svg>");
        return lines.join("\n");
    }
}
