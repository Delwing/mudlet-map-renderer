import Konva from "konva";
import {ScenePipeline} from "../ScenePipeline";
import {Camera} from "../camera/Camera";
import {applyStyleToShapes} from "../style/applyStyle";
import {identityStyle} from "../style/Style";
import type {Style} from "../style/Style";
import {buildDrawCommands} from "../draw/DrawCommandBuilder";
import {renderToCanvas} from "../render/CanvasRenderer";
import type {Shape} from "../scene/Shape";
import type {Exporter, ExportContext, ExportCanvas} from "./Exporter";
import {canvasToBytes} from "./canvasToBytes";
import {flushSceneShapes} from "./flushSceneShapes";
import {clipSceneToViewport} from "./clipSceneToViewport";
import {projectExportBoundsToScene} from "./sceneBounds";
import {pushExportViewport} from "./exportViewport";

export interface CanvasExportOptions {
    /** Width of the output image in pixels. */
    width: number;
    /** Height of the output image in pixels. */
    height: number;
    /** Room ID to center the export on. If omitted, exports the full area. */
    roomId?: number;
    /** Padding in map units around the exported region. Default: 3 */
    padding?: number;
    /** Overlays to render over the scene (position marker, highlights, paths). */
    overlays?: {
        position?: { roomId: number };
        highlights?: Array<{ roomId: number; color: string | string[] }>;
        paths?: Array<{ locations: number[]; color: string }>;
    };
}

/**
 * Renders the current scene into a canvas at the requested width/height by
 * driving {@link ScenePipeline} → {@link buildDrawCommands} →
 * {@link renderToCanvas}.
 *
 * Decoupled from the live Konva stage: the pipeline is rebuilt against the
 * export bounds, shapes are projected through a fitted camera transform, and
 * the result is rasterized onto a fresh 2D canvas. Background colour is
 * filled before any draw commands replay, so PNG / JPEG output looks identical
 * to the on-screen map.
 *
 * Unlike {@link PngExporter} (which captures the on-screen viewport via the
 * live Konva stage), `CanvasExporter` is fully headless and reproducible.
 */
export class CanvasExporter implements Exporter<ExportCanvas | undefined> {
    constructor(private readonly options: CanvasExportOptions) {}

    render({state, style, sceneOverlays}: ExportContext): ExportCanvas | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const {width, height} = this.options;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);

        // Fit scene-space bounds (post-style-projection) into the requested
        // canvas size. Coordinate-warping styles (Isometric) render outside
        // the world AABB, so fitting world bounds clips/offsets the scene.
        const sceneBounds = projectExportBoundsToScene(bounds, style, settings.roomSize * 0.5);
        const scale = Math.min(width / sceneBounds.w, height / sceneBounds.h);
        const mapPixelW = sceneBounds.w * scale;
        const mapPixelH = sceneBounds.h * scale;
        const offsetX = (width - mapPixelW) / 2 - sceneBounds.x * scale;
        const offsetY = (height - mapPixelH) / 2 - sceneBounds.y * scale;
        const renderCam = {scale, offsetX, offsetY};

        // Culling must cover the full canvas, not just the tight export region.
        // Camera.forRenderCamera reproduces the letterbox-extended viewport from
        // the fitted transform, so rooms in aspect-ratio padding areas are not
        // incorrectly culled.
        const cullingCamera = Camera.forRenderCamera(width, height, scale, offsetX, offsetY);

        const transforms = {
            forward: style.worldToScene ? (x: number, y: number) => style.worldToScene!(x, y) : undefined,
            inverse: style.sceneToWorld ? (x: number, y: number) => style.sceneToWorld!(x, y) : undefined,
        };

        // See pushExportViewport: a viewport-virtualized reader (SkeletonMapReader)
        // only materialises rooms inside whatever viewport was last pushed onto
        // it, which for the live interactive camera can be a render (rAF) behind
        // — an export must push its own to be correct and reproducible.
        const restoreViewport = pushExportViewport(state.mapReader, bounds);
        try {
            const pipeline = new ScenePipeline(state.mapReader, settings);
            const result = pipeline.buildScene(area, plane, currentZIndex, state.lens);
            const clipped = clipSceneToViewport(result, cullingCamera.getViewportBounds(), settings, transforms);

            const canvas = Konva.Util.createCanvasElement() as unknown as HTMLCanvasElement;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.fillStyle = settings.backgroundColor;
            ctx.fillRect(0, 0, width, height);

            const styleCtx = {scale, roomSize: settings.roomSize};
            const styled = (shapes: Shape[]): Shape[] =>
                style === identityStyle ? shapes : applyStyleToShapes(shapes, style as Style, styleCtx);

            const flush = (shapes: Shape[], sceneSpace?: boolean) => {
                if (shapes.length === 0) return;
                renderToCanvas(ctx, buildDrawCommands(sceneSpace ? shapes : styled(shapes), renderCam));
            };

            const viewportBounds = Camera.forMapBounds(bounds.x, bounds.x + bounds.w, bounds.y, bounds.y + bounds.h).getViewportBounds();
            flushSceneShapes(
                clipped,
                {state, viewportBounds, sceneOverlays, overlays: this.options.overlays},
                flush,
            );

            return canvas as unknown as ExportCanvas;
        } finally {
            restoreViewport();
        }
    }
}

export interface PngBytesExportOptions extends CanvasExportOptions {
    /** MIME type to encode. Defaults to `'image/png'`. */
    mimeType?: string;
    /** Encoder quality (0..1). Only used for lossy formats like `'image/jpeg'`. */
    quality?: number;
}

/**
 * Headless PNG/JPEG bytes at a specific width × height.
 *
 * Composes {@link CanvasExporter} with a portable `toDataURL` → `Uint8Array`
 * decode, so callers get bytes directly without touching a canvas or casting
 * to platform-specific types:
 *
 * ```ts
 * const png = renderer.export(new PngBytesExporter({ width: 1920, height: 1080 }));
 * fs.writeFileSync('out.png', png!);              // Node
 * new Blob([png!], { type: 'image/png' });        // Browser
 * ```
 *
 * For JPEG: `new PngBytesExporter({ width, height, mimeType: 'image/jpeg', quality: 0.9 })`.
 */
export class PngBytesExporter implements Exporter<Uint8Array | undefined> {
    private readonly canvasExporter: CanvasExporter;

    constructor(private readonly options: PngBytesExportOptions) {
        this.canvasExporter = new CanvasExporter(options);
    }

    render(context: ExportContext): Uint8Array | undefined {
        const canvas = this.canvasExporter.render(context);
        if (!canvas) return;
        return canvasToBytes(canvas, this.options.mimeType, this.options.quality);
    }
}
