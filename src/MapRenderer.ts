import type Area from "./reader/Area";
import type {Settings} from "./Renderer";
import type {SvgExportOptions} from "./SvgExporter";

/**
 * Environment-agnostic interface for map rendering.
 *
 * Both the browser {@link Renderer} (Konva.js, requires DOM) and
 * {@link HeadlessRenderer} (no DOM, export-only) implement this interface.
 *
 * Use this type to write code that works in both environments:
 * ```typescript
 * function setupMap(renderer: MapRenderer) {
 *     renderer.drawArea(1, 0);
 *     renderer.setPosition(42);
 *     renderer.renderHighlight(100, '#ff0000');
 * }
 * ```
 */
export interface MapRenderer {
    readonly settings: Settings;

    drawArea(id: number, zIndex: number): void;

    getCurrentArea(): Area | undefined;

    setPosition(roomId: number): void;

    clearPosition(): void;

    renderPath(locations: number[], color?: string): void;

    clearPaths(): void;

    renderHighlight(roomId: number, color: string): void;

    removeHighlight(roomId: number): void;

    hasHighlight(roomId: number): boolean;

    clearHighlights(): void;

    exportSvg(options?: SvgExportOptions): string | undefined;
}
