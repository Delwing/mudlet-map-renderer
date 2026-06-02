import type {Shape, Paint, RectShape, CircleShape} from "../../scene/Shape";
import type {Style} from "../Style";
import {hslToRgbString, mapFill, parseRgb, rgbToHsl} from "./paintMap";

/** Light, slightly translucent border for room outlines. */
const BORDER = "rgba(255, 255, 255, 0.14)";
/** Muted grey-blue for exit connectors. */
const LINE_INK = "#5b6573";
/** Off-white used for text / room characters. */
const TEXT_COLOR = "#e6e8ec";
/** Drop-shadow colour. */
const SHADOW_FILL = "rgba(0, 0, 0, 0.38)";

/** Shadow offset as a fraction of the active room size. */
const SHADOW_OFFSET = 0.08;
/** Saturation ceiling — keeps the palette muted / flat. */
const MAX_SATURATION = 0.34;

/**
 * Recolour a fill into the flat dark palette: hue preserved, saturation
 * capped, lightness pulled into a narrow mid-low band so rooms stay legible
 * on a dark canvas while looking uniform and modern.
 */
function toDarkFill(color: string): string {
    const c = parseRgb(color);
    if (!c) return "rgb(38, 42, 48)";
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    const sat = Math.min(s, MAX_SATURATION);
    // Map source lightness into a flat 0.22..0.40 band.
    const light = 0.22 + l * 0.18;
    return hslToRgbString(h, sat, light, c.a);
}

/** Apply the dark-palette rewrites to a Paint record. */
function darkPaint(paint: Paint): Paint {
    return {
        ...paint,
        fill: mapFill(paint.fill, toDarkFill),
        stroke: paint.stroke ? BORDER : paint.stroke,
    };
}

/** True for the primary room body shapes that should cast an elevation shadow. */
function isRoomBody(shape: RectShape | CircleShape): boolean {
    return shape.hit?.kind === "room" && shape.paint.fill !== undefined;
}

/**
 * Flat dark "modern UI" aesthetic as a {@link Style}.
 *
 * - Room fills are flattened into a muted dark palette (hue kept, saturation
 *   capped, lightness compressed) so the map reads as a calm dark dashboard.
 * - Room outlines become a subtle translucent light border.
 * - Each room body casts a soft offset drop-shadow (emitted **before** the
 *   body, like Neon's glow, so it renders underneath) for a sense of
 *   elevation.
 * - Exit lines become a muted grey-blue; text is off-white.
 * - Images and groups pass through unchanged (the caller walks group
 *   children separately).
 */
export const darkModernShapeStyle: Style = {
    transform(shape: Shape, ctx): Shape | Shape[] {
        switch (shape.type) {
            case "rect": {
                const main: RectShape = {...shape, paint: darkPaint(shape.paint)};
                if (!isRoomBody(shape)) return main;
                const off = ctx.roomSize * SHADOW_OFFSET;
                const shadow: RectShape = {
                    type: "rect",
                    x: shape.x + off,
                    y: shape.y + off,
                    width: shape.width,
                    height: shape.height,
                    cornerRadius: shape.cornerRadius,
                    paint: {fill: SHADOW_FILL},
                    layer: shape.layer,
                    noScale: shape.noScale,
                };
                return [shadow, main];
            }
            case "circle": {
                const main: CircleShape = {...shape, paint: darkPaint(shape.paint)};
                if (!isRoomBody(shape)) return main;
                const off = ctx.roomSize * SHADOW_OFFSET;
                const shadow: CircleShape = {
                    type: "circle",
                    cx: shape.cx + off,
                    cy: shape.cy + off,
                    radius: shape.radius,
                    paint: {fill: SHADOW_FILL},
                    layer: shape.layer,
                    noScale: shape.noScale,
                };
                return [shadow, main];
            }
            case "polygon":
                return {...shape, paint: darkPaint(shape.paint)};
            case "line":
                return {
                    ...shape,
                    paint: shape.paint.stroke
                        ? {...shape.paint, stroke: LINE_INK}
                        : shape.paint,
                };
            case "text":
                return {...shape, fill: TEXT_COLOR};
            case "image":
            case "group":
                return shape;
        }
    },
};
