/**
 * Target-agnostic visual styles. Each style is a {@link Style} function that
 * wraps a target in a brand-preserving decorator.
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
 *
 * Styles work over any branded target (interactive canvas or SVG export), so
 * the same style drives on-screen rendering, SVG export, and PNG rasterization.
 */

import type {DrawingBackend, Style} from "../backend/DrawingBackend";
import {ParchmentBackend} from "../backend/ParchmentBackend";
import {BlueprintBackend} from "../backend/BlueprintBackend";
import {NeonBackend} from "../backend/NeonBackend";
import {SketchyBackend} from "../backend/SketchyBackend";
import {IsometricBackend} from "../backend/IsometricBackend";
import type {IsometricRotation} from "../backend/IsometricBackend";

export {compose, identityStyle} from "../backend/DrawingBackend";
export type {Style} from "../backend/DrawingBackend";

/** Warm sepia / old-parchment palette. */
export const Parchment: Style = (<T extends DrawingBackend>(t: T) =>
    new ParchmentBackend(t)) as Style;

/** Technical blueprint aesthetic — white lines on deep blue. */
export const Blueprint: Style = (<T extends DrawingBackend>(t: T) =>
    new BlueprintBackend(t)) as Style;

/** Cyberpunk / neon aesthetic — glowing outlines on dark background. */
export const Neon: Style = (<T extends DrawingBackend>(t: T) =>
    new NeonBackend(t)) as Style;

export interface SketchyOptions {
    /** Jitter amount in map units. */
    jitter: number;
    /** Pencil color (hex or rgb). */
    color: string;
}

/** Hand-drawn pencil wobble. */
export function Sketchy(options: SketchyOptions): Style {
    return (<T extends DrawingBackend>(t: T) =>
        new SketchyBackend(t, options.jitter, options.color)) as Style;
}

export interface IsometricOptions {
    /** Cube side face height. Defaults to 0.18. */
    depth?: number;
    /** Rotation angle in degrees. Defaults to 0. */
    rotation?: IsometricRotation;
}

/** 2:1 isometric projection with optional cube depth. */
export function Isometric(options: IsometricOptions = {}): Style {
    return (<T extends DrawingBackend>(t: T) =>
        new IsometricBackend(t, options)) as Style;
}
