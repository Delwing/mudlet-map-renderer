import type {SceneShapesByLayer} from "../ScenePipeline";
import type {Shape} from "../scene/Shape";
import type {MapState} from "../MapState";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {ViewportBounds} from "../types/Settings";
import type {SvgOverlays} from "../SvgTypes";
import {computeHighlight, computePathOverlay, computePositionMarker} from "../scene/OverlayStyle";
import {
    highlightToShape,
    pathToShapes,
    positionMarkerToShape,
} from "../scene/elements/OverlayLayout";

export interface SceneFlushContext {
    state: MapState;
    viewportBounds: ViewportBounds;
    sceneOverlays: Iterable<SceneOverlay>;
    overlays?: SvgOverlays;
}

/**
 * Walk the canonical scene-layer order, calling `flush` once per layer.
 * Order: grid → link → room → built-in overlays → scene overlays → topLabel.
 *
 * Single source of truth for what static exporters must render — adding a new
 * exporter no longer means re-typing the sequence and risking a silent omission.
 */
export function flushSceneShapes(
    sceneShapes: SceneShapesByLayer,
    context: SceneFlushContext,
    flush: (shapes: Shape[], sceneSpace?: boolean) => void,
): void {
    flush(sceneShapes.grid);
    flush(sceneShapes.link);
    flush(sceneShapes.room);
    flush(buildBuiltInOverlayShapes(context.state, context.overlays));
    for (const overlay of context.sceneOverlays) {
        const out = overlay.render(context.state, context.viewportBounds);
        if (!out) continue;
        // Scene-space overlays return geometry already in rendered space;
        // signal the exporter to skip the Style transform so warping styles
        // (Isometric) don't project it twice.
        flush(Array.isArray(out) ? out : [out], overlay.sceneSpace);
    }
    flush(sceneShapes.topLabel);
}

export function buildBuiltInOverlayShapes(
    state: MapState,
    overlaysInput?: SvgOverlays,
): Shape[] {
    const overlays = state.getOverlaysForArea(overlaysInput);
    if (!overlays) return [];
    const settings = state.settings;
    const out: Shape[] = [];

    if (overlays.paths) {
        for (const path of overlays.paths) {
            const data = computePathOverlay(
                state.mapReader, settings, path.locations, path.color,
                state.currentArea!, state.currentZIndex!,
            );
            out.push(...pathToShapes(data));
        }
    }
    if (overlays.highlights) {
        for (const hl of overlays.highlights) {
            const room = state.mapReader.getRoom(hl.roomId);
            if (!room) continue;
            out.push(highlightToShape(computeHighlight(room, hl.color, settings)));
        }
    }
    if (overlays.position) {
        const room = state.mapReader.getRoom(overlays.position.roomId);
        if (room) {
            out.push(positionMarkerToShape(computePositionMarker(room, settings)));
        }
    }
    return out;
}
