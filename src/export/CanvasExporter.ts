import Konva from "konva";
import {SvgBackend, SvgLayerNode} from "../backend/SvgBackend";
import {ScenePipeline} from "../ScenePipeline";
import {computeHighlight, computePathOverlay, computePositionMarker} from "../scene/OverlayStyle";
import {
    highlightToShapes,
    pathToShapes,
    positionMarkerToShape,
} from "../scene/elements/OverlayLayout";
import {buildDrawCommands} from "../draw/DrawCommandBuilder";
import {renderToCanvas} from "../render/CanvasRenderer";
import type {Shape} from "../scene/Shape";
import type {MapState} from "../MapState";
import type {Exporter, ExportContext, ExportCanvas} from "./Exporter";
import {canvasToBytes} from "./canvasToBytes";

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
        highlights?: Array<{ roomId: number; color: string }>;
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

    render({state, sceneOverlays}: ExportContext): ExportCanvas | undefined {
        const {currentArea, currentZIndex, currentAreaInstance} = state;
        if (currentArea === undefined || currentZIndex === undefined || !currentAreaInstance) return;

        const area = currentAreaInstance;
        const plane = area.getPlane(currentZIndex);
        if (!plane) return;

        const settings = state.settings;
        const {width, height} = this.options;
        const padding = this.options.padding ?? 3;
        const bounds = state.computeExportBounds(area, plane, this.options.roomId, padding);
        const viewportBounds = {
            minX: bounds.x, maxX: bounds.x + bounds.w,
            minY: bounds.y, maxY: bounds.y + bounds.h,
        };

        // Run the pipeline against an SvgBackend purely to drive its internal
        // addNode plumbing — `result.sceneShapes` is the source of truth for
        // the canvas output. SvgBackend is chosen because it has zero Konva
        // coupling, so this works in headless Node environments.
        const noopBackend = new SvgBackend();
        const pipeline = new ScenePipeline(state.mapReader, settings, noopBackend, {
            gridLayer: new SvgLayerNode(),
            linkLayer: new SvgLayerNode(),
            roomLayer: new SvgLayerNode(),
            topLabelLayer: new SvgLayerNode(),
        });
        const result = pipeline.buildScene(area, plane, currentZIndex, viewportBounds);

        // Fit world bounds into the requested canvas size, preserving aspect
        // ratio and centring the framed region. The resulting linear camera
        // is what {@link buildDrawCommands} bakes into render-space coords.
        const scale = Math.min(width / bounds.w, height / bounds.h);
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        const offsetX = (width - mapPixelW) / 2 - bounds.x * scale;
        const offsetY = (height - mapPixelH) / 2 - bounds.y * scale;
        const camera = {scale, offsetX, offsetY};

        const canvas = Konva.Util.createCanvasElement() as unknown as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = settings.backgroundColor;
        ctx.fillRect(0, 0, width, height);

        const flush = (shapes: Shape[]) => {
            if (shapes.length === 0) return;
            renderToCanvas(ctx, buildDrawCommands(shapes, camera));
        };

        flush(result.sceneShapes.grid);
        flush(result.sceneShapes.link);
        flush(result.sceneShapes.room);
        flush(this.buildBuiltInOverlayShapes(state));

        for (const overlay of sceneOverlays) {
            const out = overlay.render(state, viewportBounds);
            if (!out) continue;
            flush(Array.isArray(out) ? out : [out]);
        }

        flush(result.sceneShapes.topLabel);

        return canvas as unknown as ExportCanvas;
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
