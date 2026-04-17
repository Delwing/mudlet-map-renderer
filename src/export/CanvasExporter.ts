import type {Exporter, ExportContext, ExportCanvas} from "./Exporter";

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

    render({backend}: ExportContext): ExportCanvas | undefined {
        return backend.toCanvas(this.options);
    }
}
