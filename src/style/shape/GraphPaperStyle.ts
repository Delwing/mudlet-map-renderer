import type {Shape, Paint} from "../../scene/Shape";
import type {Style} from "../Style";
import {formatRgb, luminance, mapFill, parseRgb} from "./paintMap";

/** Dark navy ink for room outlines, exits, and text. */
const INK = "#1c3f6e";
/** Slightly fattened ink so outlines read like a felt-tip on graph paper. */
const INK_MULT = 1.4;
const INK_MIN = 0.05;

// Room fill range: dark rooms become pale slate-blue, light rooms near-white.
// The whole range stays light so navy ink and the blue grid stay legible.
const DARK_R = 198, DARK_G = 212, DARK_B = 230;
const LIGHT_R = 248, LIGHT_G = 250, LIGHT_B = 255;

/** Map a colour to the pale graph-paper fill range by luminance. */
function toPaper(color: string): string {
    const c = parseRgb(color);
    if (!c) return formatRgb(LIGHT_R, LIGHT_G, LIGHT_B);
    const lum = luminance(c);
    return formatRgb(
        Math.round(DARK_R + (LIGHT_R - DARK_R) * lum),
        Math.round(DARK_G + (LIGHT_G - DARK_G) * lum),
        Math.round(DARK_B + (LIGHT_B - DARK_B) * lum),
        c.a,
    );
}

/** Convert a stroke to navy ink, preserving any alpha channel. */
function toInk(color: string): string {
    const c = parseRgb(color);
    if (!c || c.a >= 1) return INK;
    const ink = parseRgb(INK)!;
    return formatRgb(ink.r, ink.g, ink.b, c.a);
}

function inkWidth(strokeWidth: number | undefined): number {
    return Math.max((strokeWidth ?? 0.04) * INK_MULT, INK_MIN);
}

function rewriteFillStroke(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toPaper),
        stroke: paint.stroke ? toInk(paint.stroke) : paint.stroke,
        strokeWidth: paint.stroke ? inkWidth(paint.strokeWidth) : paint.strokeWidth,
    };
}

/**
 * Old-school graph-paper dungeon aesthetic as a {@link Style} — the classic
 * hand-drawn D&D look: pale rooms inked in navy over blue grid paper.
 *
 * - Fills map to a pale slate-blue → near-white range by luminance, so rooms
 *   stay light and the blue grid reads through. Gradient stops recolour per stop.
 * - Strokes become fattened navy ink.
 * - Exit lines become navy ink (kept thin where the source was thin).
 * - Text uses navy ink.
 * - Images and groups pass through unchanged.
 *
 * Pair with a cream/white background and a light-blue grid in settings for the
 * full graph-paper effect.
 */
export const graphPaperShapeStyle: Style = {
    transform(shape: Shape): Shape {
        switch (shape.type) {
            case "rect":
            case "circle":
            case "polygon":
                return {...shape, paint: rewriteFillStroke(shape.paint)};
            case "line": {
                if (!shape.paint.stroke) return shape;
                // Grid lines stay thin; room/exit connectors get the inked width.
                return {
                    ...shape,
                    paint: {
                        ...shape.paint,
                        stroke: toInk(shape.paint.stroke),
                        strokeWidth: shape.grid ? shape.paint.strokeWidth : inkWidth(shape.paint.strokeWidth),
                    },
                };
            }
            case "text":
                return {...shape, fill: INK};
            case "image":
            case "group":
                return shape;
        }
    },
};
