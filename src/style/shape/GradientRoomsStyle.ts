import type {LinearGradient, Paint, Shape} from "../../scene/Shape";
import type {Style} from "../Style";
import {darkenColor, lightenColor} from "../../utils/color";

export interface GradientRoomsOptions {
    /**
     * How much to lighten the top stop relative to the room's solid fill.
     * Default 0.35. Set to 0 to keep the top edge unchanged.
     */
    lighten?: number;
    /**
     * How much to darken the bottom stop. Default 0.25.
     */
    darken?: number;
}

const DEFAULTS = {lighten: 0.35, darken: 0.25};

/**
 * Replace each rect/circle/polygon's flat fill with a vertical linear
 * gradient: lightened version of the fill at the top, darkened version at
 * the bottom. Gives rooms a faux-3D shaded look. Strokes and other paint
 * fields pass through.
 *
 * When composed with palette styles (Parchment, Blueprint, …) the gradient
 * stops are recoloured by the downstream style — so `compose(Parchment,
 * GradientRooms)` produces parchment-toned gradients, not flat parchment.
 */
export function gradientRoomsStyle(options: GradientRoomsOptions = {}): Style {
    const lighten = options.lighten ?? DEFAULTS.lighten;
    const darken = options.darken ?? DEFAULTS.darken;

    function withGradient(
        paint: Paint,
        x: number, y: number, w: number, h: number,
    ): Paint {
        const fill = paint.fill;
        if (typeof fill !== "string") return paint; // already gradient or undefined — leave alone
        const grad: LinearGradient = {
            type: "linear",
            x0: x, y0: y,
            x1: x, y1: y + h,
            stops: [
                {offset: 0, color: lightenColor(fill, lighten)},
                {offset: 1, color: darkenColor(fill, darken)},
            ],
        };
        // Strip alpha here only when it was carried by the paint — leave it as a
        // future enhancement; lightenColor/darkenColor today emit `rgb(...)` not
        // `rgba(...)`, so callers that rely on translucency would see a change.
        // Document the limitation in case a user files a bug.
        void w;
        return {...paint, fill: grad};
    }

    return {
        transform(shape: Shape): Shape {
            switch (shape.type) {
                case "rect":
                    return {
                        ...shape,
                        paint: withGradient(shape.paint, shape.x, shape.y, shape.width, shape.height),
                    };
                case "circle":
                    return {
                        ...shape,
                        paint: withGradient(
                            shape.paint,
                            shape.cx - shape.radius,
                            shape.cy - shape.radius,
                            shape.radius * 2,
                            shape.radius * 2,
                        ),
                    };
                case "polygon": {
                    if (typeof shape.paint.fill !== "string") return shape;
                    // Use the polygon's bounding box for gradient endpoints.
                    let minY = Infinity, maxY = -Infinity, minX = Infinity;
                    for (let i = 0; i < shape.vertices.length; i += 2) {
                        const vx = shape.vertices[i];
                        const vy = shape.vertices[i + 1];
                        if (vy < minY) minY = vy;
                        if (vy > maxY) maxY = vy;
                        if (vx < minX) minX = vx;
                    }
                    return {
                        ...shape,
                        paint: withGradient(shape.paint, minX, minY, 1, maxY - minY),
                    };
                }
                default:
                    return shape;
            }
        },
    };
}
