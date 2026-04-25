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

export type {SketchyOptions, IsometricOptions, IsometricRotation};
