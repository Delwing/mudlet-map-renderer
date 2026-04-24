import type {Exporter, ExportContext} from "./Exporter";

export interface PngExportOptions {
    pixelRatio?: number;
}

/**
 * Exports the current interactive canvas as a PNG data URL. Rasterizes the
 * live Konva stage — whatever style the renderer currently has applied is
 * what gets captured.
 *
 * For re-framing with an explicit width/height (e.g. server-side rendering),
 * use {@link CanvasExporter} and serialize its output yourself.
 */
export class PngExporter implements Exporter<string | undefined> {
    constructor(private readonly options: PngExportOptions = {}) {}

    render({renderer}: ExportContext): string | undefined {
        const canvas = renderer.exportCanvas(this.options);
        return canvas?.toDataURL('image/png');
    }
}

/** Companion to {@link PngExporter} that returns a Blob instead of a data URL. */
export class PngBlobExporter implements Exporter<Promise<Blob> | undefined> {
    constructor(private readonly options: PngExportOptions = {}) {}

    render({renderer}: ExportContext): Promise<Blob> | undefined {
        const canvas = renderer.exportCanvas(this.options);
        if (!canvas || !canvas.toBlob) return;
        const toBlob = canvas.toBlob.bind(canvas);
        return new Promise<Blob>((resolve) => {
            toBlob((blob: Blob | null) => { if (blob) resolve(blob); }, 'image/png');
        });
    }
}
