/**
 * Engine IR — flat, replayable draw commands consumed by per-engine renderers
 * ({@link KonvaRenderer}, {@link SvgRenderer}, {@link CanvasRenderer}).
 *
 * A {@link DrawCommandBuilder} translates {@link Shape}s plus a {@link Camera}
 * transform into {@link DrawCommand}s. Commands carry final paint values; all
 * style transforms are baked in by the time the IR is produced.
 *
 * Coordinates in commands are in render space (camera transform already
 * applied) unless wrapped between push/pop transform pairs.
 */

import type {LayerId} from "../scene/Shape";

export interface RectCommand {
    type: "rect";
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    stroke?: string;
    /** Stroke width in render units. */
    sw: number;
    /** Corner radius in render units. */
    cr: number;
    dash?: number[];
}

export interface CircleCommand {
    type: "circle";
    cx: number;
    cy: number;
    r: number;
    fill?: string;
    stroke?: string;
    sw: number;
    dash?: number[];
}

export interface LineCommand {
    type: "line";
    /** Flat list of [x0, y0, x1, y1, …] in render space. */
    points: number[];
    stroke?: string;
    sw: number;
    dash?: number[];
    lineCap?: "butt" | "round" | "square";
    lineJoin?: "miter" | "round" | "bevel";
    /** 0..1 multiplier. */
    alpha?: number;
}

export interface PolygonCommand {
    type: "polygon";
    vertices: number[];
    fill?: string;
    stroke?: string;
    sw: number;
}

export interface TextCommand {
    type: "text";
    x: number;
    y: number;
    text: string;
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    fill: string;
    stroke?: string;
    /** Stroke width in render units (0 = no stroke). */
    sw: number;
    align: "left" | "center" | "right";
    vAlign: "top" | "middle" | "bottom";
    w: number;
    h: number;
    baselineRatio?: number;
    konvaCorrectionRatio?: number;
    transform?: [number, number, number, number, number, number];
}

export interface ImageCommand {
    type: "image";
    x: number;
    y: number;
    w: number;
    h: number;
    src: string;
    transform?: [number, number, number, number, number, number];
}

/** Push an affine transform [a, b, c, d, e, f] onto the renderer's stack. */
export interface PushTransformCommand {
    type: "pushTransform";
    matrix: [number, number, number, number, number, number];
}

/** Pop the most recent transform. */
export interface PopTransformCommand {
    type: "popTransform";
}

/** Push a clip rect; subsequent draws are clipped until matching pop. */
export interface PushClipCommand {
    type: "pushClip";
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface PopClipCommand {
    type: "popClip";
}

export type PrimitiveDrawCommand =
    | RectCommand
    | CircleCommand
    | LineCommand
    | PolygonCommand
    | TextCommand
    | ImageCommand;

export type StackDrawCommand =
    | PushTransformCommand
    | PopTransformCommand
    | PushClipCommand
    | PopClipCommand;

export type DrawCommand = PrimitiveDrawCommand | StackDrawCommand;

/**
 * A bundle of commands targeting one logical layer. Renderers iterate layers
 * in z-order and flush commands per layer.
 */
export interface DrawCommandBatch {
    layer: LayerId;
    commands: DrawCommand[];
}
