import type {MapState} from "../MapState";
import type {Style} from "../backend/DrawingBackend";
import type {Exporter} from "./Exporter";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {InteractiveBackend} from "../rendering/MapRenderer";

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
 * The resulting canvas is the node-canvas-compatible object returned by
 * {@link InteractiveBackend.toCanvas} and can be serialized to PNG (Node:
 * `.toBuffer('image/png')`; browser: `.toDataURL('image/png')`).
 *
 * Unlike {@link PngExporter} which rasterizes the current on-screen viewport,
 * `CanvasExporter` is the headless/programmatic path.
 */
export class CanvasExporter implements Exporter<any> {
    constructor(
        private readonly backend: InteractiveBackend,
        private readonly options: CanvasExportOptions,
    ) {}

    render(
        _state: MapState,
        _style?: Style,
        _sceneOverlays?: Iterable<SceneOverlay>,
    ): any {
        return this.backend.toCanvas(this.options);
    }
}
