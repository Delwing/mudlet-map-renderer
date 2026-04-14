import "konva/canvas-backend";
import Konva from "konva";
import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import {createSettings} from "./Renderer";
import type {Settings} from "./Renderer";
import type {MapRenderer} from "./MapRenderer";
import {SvgExporter} from "./SvgExporter";
import type {SvgExportOptions, SvgOverlays} from "./SvgExporter";
import {SceneBuilder, buildPositionMarker, buildHighlight, buildPathOverlay} from "./SceneBuilder";

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

type HighlightEntry = { color: string; area: number; z: number };
type PathEntry = { locations: number[]; color: string };

/**
 * A headless renderer that uses Konva with the canvas backend for server-side
 * and Node.js rendering. Provides the same stateful API as the browser Renderer
 * for area display, position tracking, path rendering, and highlights.
 *
 * Exports to SVG (via SvgExporter) or PNG (via headless Konva stage).
 *
 * Usage:
 * ```
 * import { HeadlessRenderer } from 'mudlet-map-renderer';
 *
 * const renderer = new HeadlessRenderer(mapReader, settings);
 * renderer.drawArea(areaId, 0);
 * renderer.setPosition(playerRoomId);
 *
 * // SVG export
 * const svg = renderer.exportSvg({ padding: 5 });
 *
 * // PNG export
 * const canvas = renderer.renderToCanvas({ width: 1920, height: 1080 });
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
     * Render the current area to a canvas using headless Konva.
     * Returns the canvas object (node-canvas Canvas in Node.js) for PNG export.
     */
    renderToCanvas(options: CanvasExportOptions & { overlays?: CanvasExportOverlays }): any {
        if (this.currentArea === undefined || this.currentZIndex === undefined) return;

        const area = this.mapReader.getArea(this.currentArea);
        if (!area) return;
        const plane = area.getPlane(this.currentZIndex);
        if (!plane) return;

        const {width, height} = options;
        const padding = options.padding ?? 3;
        const overlays = this.buildOverlays(options.overlays);

        // Compute map bounds
        const bounds = this.computeBounds(area, plane, options.roomId, padding);

        // Compute scale to fit map in canvas
        const scaleX = width / bounds.w;
        const scaleY = height / bounds.h;
        const scale = Math.min(scaleX, scaleY);
        const mapPixelW = bounds.w * scale;
        const mapPixelH = bounds.h * scale;
        const offsetX = (width - mapPixelW) / 2;
        const offsetY = (height - mapPixelH) / 2;

        // Create headless Konva stage
        const stage = new Konva.Stage({ width, height });

        // Background layer
        const bgLayer = new Konva.Layer({ listening: false });
        stage.add(bgLayer);
        bgLayer.add(new Konva.Rect({
            x: 0, y: 0, width, height,
            fill: this.settings.backgroundColor,
        }));

        // Scene layers
        const gridLayer = new Konva.Layer({ listening: false });
        const linkLayer = new Konva.Layer({ listening: false });
        const roomLayer = new Konva.Layer({ listening: false });
        const overlayLayer = new Konva.Layer({ listening: false });

        stage.add(gridLayer);
        stage.add(linkLayer);
        stage.add(roomLayer);
        stage.add(overlayLayer);

        // Apply transform to scene layers
        for (const layer of [gridLayer, linkLayer, roomLayer, overlayLayer]) {
            layer.scaleX(scale);
            layer.scaleY(scale);
            layer.x(offsetX - bounds.x * scale);
            layer.y(offsetY - bounds.y * scale);
        }

        // Build scene
        const sceneBuilder = new SceneBuilder(this.mapReader, this.settings, {
            gridLayer, linkLayer, roomLayer,
        });

        // Compute viewport bounds in map coords for grid rendering
        const viewportBounds = {
            minX: bounds.x - offsetX / scale,
            maxX: bounds.x - offsetX / scale + width / scale,
            minY: bounds.y - offsetY / scale,
            maxY: bounds.y - offsetY / scale + height / scale,
        };

        sceneBuilder.buildScene(area, plane, this.currentZIndex, viewportBounds);

        // Overlays
        if (overlays.paths) {
            for (const path of overlays.paths) {
                overlayLayer.add(buildPathOverlay(
                    this.mapReader, this.settings,
                    path.locations, path.color,
                    this.currentArea, this.currentZIndex,
                ));
            }
        }
        if (overlays.highlights) {
            for (const hl of overlays.highlights) {
                const room = this.mapReader.getRoom(hl.roomId);
                if (room) {
                    overlayLayer.add(buildHighlight(room, hl.color, this.settings));
                }
            }
        }
        if (overlays.position) {
            const room = this.mapReader.getRoom(overlays.position.roomId);
            if (room) {
                overlayLayer.add(buildPositionMarker(room, this.settings));
            }
        }

        // Render and return canvas
        stage.draw();
        return stage.toCanvas({ width, height });
    }

    private computeBounds(area: Area, plane: any, roomId: number | undefined, padding: number) {
        if (roomId !== undefined) {
            const room = this.mapReader.getRoom(roomId);
            if (!room) throw new Error(`Room ${roomId} not found`);
            return { x: room.x - padding, y: room.y - padding, w: padding * 2, h: padding * 2 };
        }
        const b = this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
        const areaName = this.settings.areaName ? area.getAreaName() : undefined;
        const nameOverhead = areaName ? 7 : 0;
        const nameLeftOffset = areaName ? 3.5 : 0;
        const minX = b.minX - nameLeftOffset;
        const minY = b.minY - nameOverhead;
        const nameRight = areaName ? (b.minX - 3.5 + areaName.length * 2.5 * 0.6) : -Infinity;
        const maxX = Math.max(b.maxX, nameRight);
        return { x: minX - padding, y: minY - padding, w: (maxX - minX) + padding * 2, h: (b.maxY - minY) + padding * 2 };
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
