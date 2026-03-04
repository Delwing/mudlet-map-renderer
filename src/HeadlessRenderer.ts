import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import {createSettings} from "./Renderer";
import type {Settings} from "./Renderer";
import type {MapRenderer} from "./MapRenderer";
import {SvgExporter} from "./SvgExporter";
import type {SvgExportOptions, SvgOverlays} from "./SvgExporter";
import {CanvasExporter} from "./CanvasExporter";
import type {CanvasExportOptions, CanvasExportOverlays} from "./CanvasExporter";

type HighlightEntry = { color: string; area: number; z: number };
type PathEntry = { locations: number[]; color: string };

/**
 * A headless (no DOM / no Konva) renderer for server-side and backend use.
 * Provides the same stateful API as the browser Renderer for area display,
 * position tracking, path rendering, and highlights — then exports to SVG or
 * renders to a caller-provided Canvas2D context for PNG output.
 *
 * Usage:
 * ```
 * const renderer = new HeadlessRenderer(mapReader, settings);
 * renderer.drawArea(areaId, 0);
 * renderer.setPosition(playerRoomId);
 * renderer.renderPath([roomA, roomB, roomC], '#ff0000');
 *
 * // SVG export (always available)
 * const svg = renderer.exportSvg({ padding: 5 });
 *
 * // PNG export (Node.js with 'canvas' package)
 * import { createCanvas } from 'canvas';
 * const canvas = createCanvas(1920, 1080);
 * renderer.renderToCanvas(canvas.getContext('2d'), { width: 1920, height: 1080 });
 * fs.writeFileSync('map.png', canvas.toBuffer('image/png'));
 * ```
 */
export class HeadlessRenderer implements MapRenderer {
    private readonly mapReader: MapReader;
    readonly settings: Settings;

    private currentArea?: number;
    private currentAreaInstance?: Area;
    private currentZIndex?: number;
    private positionRoomId?: number;
    private highlights: Map<number, HighlightEntry> = new Map();
    private paths: PathEntry[] = [];

    constructor(mapReader: MapReader, settings?: Settings) {
        this.mapReader = mapReader;
        this.settings = settings ?? createSettings();
    }

    drawArea(id: number, zIndex: number) {
        const area = this.mapReader.getArea(id);
        if (!area) return;
        const plane = area.getPlane(zIndex);
        if (!plane) return;
        this.currentArea = id;
        this.currentAreaInstance = area;
        this.currentZIndex = zIndex;
    }

    getCurrentArea(): Area | undefined {
        return this.currentAreaInstance;
    }

    setPosition(roomId: number) {
        this.positionRoomId = roomId;
    }

    clearPosition() {
        this.positionRoomId = undefined;
    }

    renderPath(locations: number[], color: string = '#66E64D') {
        this.paths.push({locations, color});
    }

    clearPaths() {
        this.paths = [];
    }

    renderHighlight(roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        this.highlights.set(roomId, {color, area: room.area, z: room.z});
    }

    removeHighlight(roomId: number) {
        this.highlights.delete(roomId);
    }

    hasHighlight(roomId: number) {
        return this.highlights.has(roomId);
    }

    clearHighlights() {
        this.highlights.clear();
    }

    /**
     * Export the current area as an SVG string.
     */
    exportSvg(options?: SvgExportOptions): string | undefined {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;

        const mergedOptions: SvgExportOptions = {
            ...options,
            overlays: this.buildOverlays(options?.overlays),
        };

        const exporter = new SvgExporter(this.mapReader, this.settings);
        return exporter.export(this.currentArea, this.currentZIndex, mergedOptions);
    }

    /**
     * Render the current area to a Canvas2D context (for PNG export).
     * The caller provides the canvas and context — works with `canvas` npm package (Node.js)
     * or OffscreenCanvas (browser).
     */
    renderToCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, options: Omit<CanvasExportOptions, 'overlays'> & { overlays?: CanvasExportOverlays }) {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;

        const canvasOptions: CanvasExportOptions = {
            ...options,
            overlays: this.buildOverlays(options?.overlays),
        };

        const exporter = new CanvasExporter(this.mapReader, this.settings);
        exporter.render(ctx, this.currentArea, this.currentZIndex, canvasOptions);
    }

    private buildOverlays(extra?: SvgOverlays | CanvasExportOverlays): SvgOverlays {
        const overlays: SvgOverlays = {...extra};

        // Position
        if (this.positionRoomId !== undefined) {
            const room = this.mapReader.getRoom(this.positionRoomId);
            if (room && room.area === this.currentArea && room.z === this.currentZIndex) {
                overlays.position = {roomId: this.positionRoomId};
            }
        }

        // Highlights (only for current area/z)
        const highlights: Array<{ roomId: number; color: string }> = [...(extra?.highlights ?? [])];
        for (const [roomId, entry] of this.highlights) {
            if (entry.area === this.currentArea && entry.z === this.currentZIndex) {
                highlights.push({roomId, color: entry.color});
            }
        }
        if (highlights.length > 0) overlays.highlights = highlights;

        // Paths
        const paths: Array<{ locations: number[]; color: string }> = [...(extra?.paths ?? [])];
        paths.push(...this.paths);
        if (paths.length > 0) overlays.paths = paths;

        return overlays;
    }
}
