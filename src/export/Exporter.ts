import type {MapState} from "../MapState";
import type {Style} from "../backend/DrawingBackend";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {InteractiveBackend} from "../rendering/MapRenderer";

/**
 * Context handed to every {@link Exporter} by {@link MapRenderer.export}.
 * Exporters pull whatever they need — state + style for SVG, backend for
 * canvas/PNG rasterization — so callers never have to wire `renderer.backend`
 * (or any other internal) into an exporter themselves.
 */
export interface ExportContext {
    readonly state: MapState;
    readonly backend: InteractiveBackend;
    readonly style: Style;
    readonly sceneOverlays: Iterable<SceneOverlay>;
}

/**
 * Pluggable output format. An {@link Exporter} consumes an {@link ExportContext}
 * and returns an output of type `T` (a string, a Blob promise, a canvas, bytes…).
 *
 * Adding a new output format means implementing `Exporter<T>`. `MapRenderer`'s
 * surface does not change — users just pass the new exporter to `renderer.export`.
 *
 * ```ts
 * renderer.export(new SvgExporter({ padding: 5 }));         // string
 * renderer.export(new PngExporter({ pixelRatio: 2 }));      // string (data URL)
 * renderer.export(new CanvasExporter({ width, height }));   // ExportCanvas
 * ```
 */
export interface Exporter<T> {
    render(context: ExportContext): T;
}

/**
 * Canvas returned by {@link InteractiveBackend.toCanvas} and
 * {@link CanvasExporter}. Structurally covers the browser `HTMLCanvasElement`
 * and the `canvas` package's Node-side Canvas — so library code stays engine-
 * agnostic and callers can use whichever serializer is available:
 *
 *   - Browser: `canvas.toDataURL('image/png')`, `canvas.toBlob(cb)`
 *   - Node:    `canvas.toBuffer('image/png')`
 */
export interface ExportCanvas {
    readonly width: number;
    readonly height: number;
    getContext(contextId: '2d', options?: any): CanvasRenderingContext2D | null;
    toDataURL(type?: string, quality?: any): string;
    toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: any): void;
    /** Node-canvas only. */
    toBuffer?(mimeType?: string, config?: any): Uint8Array;
}
