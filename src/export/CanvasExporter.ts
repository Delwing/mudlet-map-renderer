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
 * Renders the current scene into a canvas at the requested width/height,
 * reframing the viewport to fit the area (or a specific room) with padding.
 *
 * The returned {@link ExportCanvas} is the node-canvas-compatible object
 * produced by Konva. Serialize with `.toBuffer('image/png')` in Node or
 * `.toDataURL('image/png')` / `.toBlob(cb)` in the browser.
 *
 * Unlike {@link PngExporter} (which rasterizes the current on-screen viewport),
 * `CanvasExporter` is the headless/programmatic path.
 */
export class CanvasExporter implements Exporter<ExportCanvas | undefined> {
    constructor(private readonly options: CanvasExportOptions) {}

    render({renderer}: ExportContext): ExportCanvas | undefined {
        return renderer.toCanvas(this.options);
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
    constructor(private readonly options: PngBytesExportOptions) {}

    render(context: ExportContext): Uint8Array | undefined {
        const canvas = context.renderer.toCanvas(this.options);
        if (!canvas) return;
        return canvasToBytes(canvas, this.options.mimeType, this.options.quality);
    }
}
