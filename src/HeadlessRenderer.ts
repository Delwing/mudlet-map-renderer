import type MapReader from "./reader/MapReader";
import type Area from "./reader/Area";
import type {Settings} from "./types/Settings";
import type {MapRenderer as MapRendererInterface} from "./MapRenderer";
import type {SvgExportOptions} from "./SvgTypes";
import {MapRenderer} from "./rendering/MapRenderer";

export type CanvasExportOptions = {
    /** Width of the output image in pixels. */
    width: number;
    /** Height of the output image in pixels. */
    height: number;
    /** Room ID to center the export on. If omitted, exports the full area. */
    roomId?: number;
    /** Padding in map units around the exported region. Default: 3 */
    padding?: number;
};

export type CanvasExportOverlays = {
    position?: { roomId: number };
    highlights?: Array<{ roomId: number; color: string }>;
    paths?: Array<{ locations: number[]; color: string }>;
};

/**
 * Backward-compatible headless renderer.
 * Delegates to the unified MapRenderer in headless mode (no container).
 *
 * @deprecated Use MapRenderer directly (omit the container argument for headless mode):
 * ```
 * import { MapRenderer, createSettings } from 'mudlet-map-renderer';
 *
 * const renderer = new MapRenderer(mapReader, settings);
 * renderer.drawArea(areaId, 0);
 * renderer.setPosition(playerRoomId);
 *
 * const svg = renderer.exportSvg({ padding: 5 });
 * const canvas = renderer.renderToCanvas({ width: 1920, height: 1080 });
 * ```
 */
export class HeadlessRenderer implements MapRendererInterface {
    private readonly renderer: MapRenderer;

    get settings(): Settings {
        return this.renderer.settings;
    }

    constructor(mapReader: MapReader, settings?: Settings) {
        this.renderer = new MapRenderer(mapReader, settings);
    }

    drawArea(id: number, zIndex: number) {
        this.renderer.drawArea(id, zIndex);
    }

    getCurrentArea(): Area | undefined {
        return this.renderer.getCurrentArea();
    }

    setPosition(roomId: number) {
        // Headless: just track position for overlay export, don't auto-switch area
        this.renderer.state.positionRoomId = roomId;
    }

    clearPosition() {
        this.renderer.state.positionRoomId = undefined;
    }

    renderPath(locations: number[], color: string = '#66E64D') {
        this.renderer.renderPath(locations, color);
    }

    clearPaths() {
        this.renderer.clearPaths();
    }

    renderHighlight(roomId: number, color: string) {
        this.renderer.renderHighlight(roomId, color);
    }

    removeHighlight(roomId: number) {
        this.renderer.removeHighlight(roomId);
    }

    hasHighlight(roomId: number) {
        return this.renderer.hasHighlight(roomId);
    }

    clearHighlights() {
        this.renderer.clearHighlights();
    }

    exportSvg(options?: SvgExportOptions): string | undefined {
        return this.renderer.exportSvg(options);
    }

    renderToCanvas(options: CanvasExportOptions & { overlays?: CanvasExportOverlays }): any {
        return this.renderer.renderToCanvas(options);
    }

    destroy() {
        this.renderer.destroy();
    }
}
