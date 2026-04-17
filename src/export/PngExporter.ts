import type {MapState} from "../MapState";
import type {Style} from "../backend/DrawingBackend";
import type {Exporter} from "./Exporter";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {InteractiveBackend} from "../rendering/MapRenderer";

export interface PngExportOptions {
    pixelRatio?: number;
}

/**
 * Exports the current interactive canvas as a PNG data URL. Unlike
 * {@link SvgExporter}, this exporter depends on an interactive backend being
 * present — it rasterizes the live canvas rather than running the pipeline
 * headlessly.
 *
 * The `style` parameter is ignored: whatever style is currently applied to
 * the interactive sink is what gets rasterized. To use a different style for
 * PNG than for on-screen rendering, call {@link MapRenderer.setStyle} first.
 *
 * `sceneOverlays` are similarly reflected by whatever the interactive backend
 * has rendered — the rasterizer doesn't re-run overlays.
 */
export class PngExporter implements Exporter<string | undefined> {
    constructor(
        private readonly backend: InteractiveBackend,
        private readonly options: PngExportOptions = {},
    ) {}

    render(
        _state: MapState,
        _style?: Style,
        _sceneOverlays?: Iterable<SceneOverlay>,
    ): string | undefined {
        const canvas = this.backend.exportCanvas(this.options);
        return canvas?.toDataURL('image/png');
    }
}

/**
 * Companion to {@link PngExporter} that returns a Blob instead of a data URL.
 */
export class PngBlobExporter implements Exporter<Promise<Blob> | undefined> {
    constructor(
        private readonly backend: InteractiveBackend,
        private readonly options: PngExportOptions = {},
    ) {}

    render(
        _state: MapState,
        _style?: Style,
        _sceneOverlays?: Iterable<SceneOverlay>,
    ): Promise<Blob> | undefined {
        const canvas = this.backend.exportCanvas(this.options);
        if (!canvas) return;
        return new Promise<Blob>((resolve) => {
            canvas.toBlob((blob: Blob | null) => { if (blob) resolve(blob); }, 'image/png');
        });
    }
}
