import type {MapState} from "../MapState";
import type {Style} from "../backend/DrawingBackend";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {ScenePipeline} from "../ScenePipeline";

/**
 * Minimal handle to the renderer exposed to exporters. Decouples exporters
 * from the full MapRenderer type to avoid circular imports.
 */
export interface RendererHandle {
    toCanvas(options: {
        width: number;
        height: number;
        roomId?: number;
        padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): ExportCanvas | undefined;
    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined;
}

/**
 * Context handed to every {@link Exporter} by {@link MapRenderer.export}.
 */
export interface ExportContext {
    readonly state: MapState;
    readonly renderer: RendererHandle;
    readonly pipeline: ScenePipeline;
    readonly style: Style;
    readonly sceneOverlays: Iterable<SceneOverlay>;
}

/**
 * Pluggable output format. An {@link Exporter} consumes an {@link ExportContext}
 * and returns an output of type `T`.
 */
export interface Exporter<T> {
    render(context: ExportContext): T;
}

/**
 * Canvas returned by {@link RendererHandle.toCanvas} and {@link CanvasExporter}.
 */
export interface ExportCanvas {
    readonly width: number;
    readonly height: number;
    getContext(contextId: '2d', options?: any): CanvasRenderingContext2D | null;
    toDataURL(type?: string, quality?: any): string;
    /** Browser only; undefined in Node. */
    toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: any): void;
}
