import type {MapState} from "../MapState";
import type {Style} from "../backend/DrawingBackend";
import type {SceneOverlay} from "../overlay/SceneOverlay";

/**
 * Pluggable output format. An {@link Exporter} takes a {@link MapState} plus an
 * optional {@link Style} and produces an output of type `T` (a string, a Blob
 * promise, a byte array, …).
 *
 * Adding a new output format — say PDF — means implementing `Exporter<Uint8Array>`
 * and shipping it. No changes to `MapRenderer`, no new methods on the facade:
 *
 * ```ts
 * renderer.export(new SvgExporter());                 // string
 * renderer.export(new PngExporter({pixelRatio: 2}));  // Promise<Blob>
 * renderer.export(new PdfExporter({pageSize: 'A4'})); // Uint8Array
 * ```
 */
export interface Exporter<T> {
    render(
        state: MapState,
        style?: Style,
        overlays?: Iterable<SceneOverlay>,
    ): T;
}
