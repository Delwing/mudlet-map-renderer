import type {MapState} from "../MapState";
import type {DrawingBackend, Style} from "../backend/DrawingBackend";
import type {SvgOverlays} from "../SvgTypes";
import {SvgExporter} from "../export/SvgExporter";

/**
 * @deprecated Use {@link SvgExporter} via `renderer.export(new SvgExporter(options))`.
 *
 * Thin back-compat shim over {@link SvgExporter}. Preserved so the previous
 * `new SvgRenderBackend(state, factory).exportSvg()` call shape keeps working
 * — kept for existing tests and external scripts during the transition.
 */
export class SvgRenderBackend {
    private readonly state: MapState;
    private readonly style?: Style;

    constructor(
        state: MapState,
        drawingBackendFactory?: (innerSvgBackend: DrawingBackend) => DrawingBackend,
    ) {
        this.state = state;
        this.style = drawingBackendFactory as unknown as Style | undefined;
    }

    exportSvg(options?: { roomId?: number; padding?: number; overlays?: SvgOverlays }): string | undefined {
        return new SvgExporter(options).render(this.state, this.style);
    }
}
