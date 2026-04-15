import type Area from "./reader/Area";
import type {Settings} from "./types/Settings";
import type {SvgExportOptions} from "./SvgTypes";

/**
 * Environment-agnostic interface for map rendering.
 *
 * @deprecated Use the `MapRenderer` class from `rendering/MapRenderer` directly.
 * It handles both interactive (with container) and headless (without container) modes.
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
