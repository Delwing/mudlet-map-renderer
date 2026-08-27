/**
 * Target-agnostic visual styles. Each style is a {@link Style} that transforms
 * world-space {@link Shape}s before they hit culling, hit-testing, and the
 * draw-command pipeline. The same style drives interactive canvas rendering,
 * SVG export, and Canvas / PNG rasterization.
 *
 * Usage:
 * ```ts
 * import {compose, Parchment, Sketchy, Isometric} from 'mudlet-map-renderer';
 *
 * const style = compose(
 *     Parchment,
 *     Sketchy({jitter: 0.012, color: '#4a3728'}),
 *     Isometric({rotation: 30, depth: 0.18}),
 * );
 * renderer.setStyle(style);
 * ```
 */

import type {Style} from "./Style";
import {parchmentShapeStyle} from "./shape/ParchmentStyle";
import {blueprintShapeStyle} from "./shape/BlueprintStyle";
import {neonShapeStyle} from "./shape/NeonStyle";
import {sketchyShapeStyle, type SketchyOptions} from "./shape/SketchyStyle";
import {isometricShapeStyle, type IsometricOptions, type IsometricRotation} from "./shape/IsometricStyle";
import {constructionShapeStyle} from "./shape/ConstructionStyle";
import {scifiShapeStyle} from "./shape/SciFiStyle";
import {gradientRoomsStyle, type GradientRoomsOptions} from "./shape/GradientRoomsStyle";
import {stainedGlassShapeStyle} from "./shape/StainedGlassStyle";
import {graphPaperShapeStyle} from "./shape/GraphPaperStyle";
import {topographicShapeStyle} from "./shape/TopographicStyle";
import {watercolorShapeStyle, type WatercolorOptions} from "./shape/WatercolorStyle";
import {darkModernShapeStyle} from "./shape/DarkModernStyle";
import {treasureMapShapeStyle, treasureMapDecorations} from "./shape/TreasureMapStyle";
import {transitShapeStyle} from "./shape/TransitStyle";
import {circuitShapeStyle} from "./shape/CircuitStyle";
import {terminalShapeStyle} from "./shape/TerminalStyle";
import {pixelArtShapeStyle, type PixelArtOptions} from "./shape/PixelStyle";

export {compose, identityStyle} from "./Style";
export type {Style, StyleContext} from "./Style";
export {applyStyleToShapes} from "./applyStyle";

/** Warm sepia / old-parchment palette. */
export const Parchment: Style = parchmentShapeStyle;

/** Technical blueprint aesthetic — white lines on deep blue. */
export const Blueprint: Style = blueprintShapeStyle;

/** Cyberpunk / neon aesthetic — glowing outlines on dark background. */
export const Neon: Style = neonShapeStyle;

/** Hand-drawn pencil wobble. */
export function Sketchy(options: SketchyOptions): Style {
    return sketchyShapeStyle(options);
}

/** 2:1 isometric projection with optional cube depth. */
export function Isometric(options: IsometricOptions = {}): Style {
    return isometricShapeStyle(options);
}

/** Construction-site hazard aesthetic — safety yellow on asphalt, orange exits. */
export const Construction: Style = constructionShapeStyle;

/** Sci-fi / space-exploration aesthetic — holographic cyan glow on void black. */
export const SciFi: Style = scifiShapeStyle;

/**
 * Replace flat room fills with a vertical linear gradient (lighter top,
 * darker bottom). Compose with palette styles to keep their tones — the
 * gradient stops are recoloured per stop.
 */
export function GradientRooms(options: GradientRoomsOptions = {}): Style {
    return gradientRoomsStyle(options);
}

/** Stained-glass aesthetic — saturated panes framed by fat near-black leading. */
export const StainedGlass: Style = stainedGlassShapeStyle;

/** Old-school graph-paper dungeon — pale rooms inked in navy over blue grid. */
export const GraphPaper: Style = graphPaperShapeStyle;

/** Topographic relief — earthy rooms with concentric contour rings. */
export const Topographic: Style = topographicShapeStyle;

/** Hand-painted watercolour — translucent edge-bled washes that pool on overlap. */
export function Watercolor(options: WatercolorOptions = {}): Style {
    return watercolorShapeStyle(options);
}

/** Flat dark "modern UI" theme — muted dark rooms with subtle elevation shadows. */
export const DarkModern: Style = darkModernShapeStyle;

/**
 * Aged treasure-map palette — weathered-paper rooms inked in faded brown.
 * Pair with {@link treasureMapDecorations} (a scene overlay) for the compass
 * rose and double border frame:
 * ```ts
 * renderer.setStyle(TreasureMap);
 * renderer.addSceneOverlay('treasure-decor', treasureMapDecorations());
 * ```
 */
export const TreasureMap: Style = treasureMapShapeStyle;

/**
 * Transit / metro-map aesthetic — fat axis-coloured routes with the rooms
 * reduced to white station discs ringed in their own colour. Rooms with three
 * or more exits become fatter interchange discs.
 */
export const Transit: Style = transitShapeStyle;

/** Printed-circuit board — gold pads and copper traces on dark solder mask. */
export const Circuit: Style = circuitShapeStyle;

/**
 * Terminal / phosphor CRT — one green ramp, scanlined room cells, and exits
 * drawn as the two rails of a box-drawing rule.
 */
export const Terminal: Style = terminalShapeStyle;

/**
 * Pixel art — geometry snapped to a pixel grid, colours quantized to a fixed
 * 16-entry palette, corners squared off.
 */
export function PixelArt(options: PixelArtOptions = {}): Style {
    return pixelArtShapeStyle(options);
}

export {treasureMapDecorations};

export type {
    SketchyOptions, IsometricOptions, IsometricRotation, GradientRoomsOptions,
    WatercolorOptions, PixelArtOptions,
};
