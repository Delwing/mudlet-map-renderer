import type {Shape, Paint, PolygonShape, FillStyle} from "../../scene/Shape";
import type {Style} from "../Style";
import {mapFill, parseRgb} from "./paintMap";
import {
    createRng,
    hashCoords,
    wobbleCircle,
    wobblePolygonEdges,
    wobbleRect,
} from "./wobble";

export interface WatercolorOptions {
    /**
     * Edge-bleed amount in map units (perpendicular wobble of pane edges).
     * Default 0.05.
     */
    bleed?: number;
    /**
     * Translucent washes stacked per filled shape. More layers = deeper, more
     * uneven colour where they overlap. Default 2 (clamped to 1..4).
     */
    layers?: number;
    /** Per-wash alpha multiplier so stacked washes build up colour. Default 0.4. */
    alpha?: number;
}

/** Muted ink used for text — like a fine brush over a dried wash. */
const TEXT_COLOR = "#3a3a44";

/** Lower a fill's effective alpha by folding it into an rgba string. */
function washFill(fill: FillStyle | undefined, alpha: number): FillStyle | undefined {
    return mapFill(fill, (color) => {
        const c = parseRgb(color);
        if (!c) return color;
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a * alpha).toFixed(3)})`;
    });
}

/**
 * Hand-painted watercolour as a {@link Style}. Each filled shape becomes a
 * stack of translucent, edge-wobbled washes that bleed and deepen where they
 * overlap — soft and organic, with no crisp ink outline.
 *
 * - Rect / circle / polygon fills → N wobbly low-alpha polygon washes (seeded,
 *   so re-renders are identical). Hard strokes are dropped; the soft edges come
 *   from the overlapping washes.
 * - Lines (exits) keep their colour but lose alpha so they read as a thin wet
 *   brushstroke under the rooms.
 * - Text is repainted in muted ink.
 * - Images and groups pass through unchanged.
 *
 * Unfilled stroked shapes (e.g. exit arrowheads) fall back to a single faint
 * wobbled outline rather than vanishing.
 */
export function watercolorShapeStyle(options: WatercolorOptions = {}): Style {
    const bleed = options.bleed ?? 0.05;
    const layers = Math.max(1, Math.min(4, options.layers ?? 2));
    const alpha = options.alpha ?? 0.4;

    /** Build `layers` wobbly washes from a base polygon + paint. */
    function washes(
        baseVerts: (rng: () => number) => number[],
        paint: Paint,
        seed: number,
        layer: Shape["layer"],
        hit: Shape["hit"],
        noScale: boolean | undefined,
    ): PolygonShape[] {
        const fill = washFill(paint.fill, alpha);
        const out: PolygonShape[] = [];
        for (let i = 0; i < layers; i++) {
            // Distinct seed per wash so each layer wobbles differently and the
            // overlaps stay uneven (the watercolour "pooling" look).
            const rng = createRng(seed + i * 0x9e3779b9);
            out.push({
                type: "polygon",
                vertices: baseVerts(rng),
                paint: {fill, strokeWidth: 0},
                layer,
                // Only the first wash carries hit info — avoids duplicate pick zones.
                hit: i === 0 ? hit : undefined,
                noScale,
            });
        }
        return out;
    }

    return {
        transform(shape: Shape): Shape | Shape[] {
            switch (shape.type) {
                case "rect": {
                    if (!shape.paint.fill) {
                        // Stroke-only rect → single faint wobbled outline.
                        const rng = createRng(hashCoords(shape.x, shape.y, shape.width, shape.height));
                        return {
                            type: "polygon",
                            vertices: wobbleRect(shape.x, shape.y, shape.width, shape.height, bleed, rng),
                            paint: {stroke: shape.paint.stroke, strokeWidth: shape.paint.strokeWidth ?? 0, alpha: 0.5},
                            layer: shape.layer,
                            hit: shape.hit,
                            noScale: shape.noScale,
                        };
                    }
                    return washes(
                        (rng) => wobbleRect(shape.x, shape.y, shape.width, shape.height, bleed, rng),
                        shape.paint,
                        hashCoords(shape.x, shape.y, shape.width, shape.height),
                        shape.layer, shape.hit, shape.noScale,
                    );
                }
                case "circle": {
                    if (!shape.paint.fill) {
                        const rng = createRng(hashCoords(shape.cx, shape.cy, shape.radius));
                        return {
                            type: "polygon",
                            vertices: wobbleCircle(shape.cx, shape.cy, shape.radius, bleed, rng),
                            paint: {stroke: shape.paint.stroke, strokeWidth: shape.paint.strokeWidth ?? 0, alpha: 0.5},
                            layer: shape.layer,
                            hit: shape.hit,
                            noScale: shape.noScale,
                        };
                    }
                    return washes(
                        (rng) => wobbleCircle(shape.cx, shape.cy, shape.radius, bleed, rng),
                        shape.paint,
                        hashCoords(shape.cx, shape.cy, shape.radius),
                        shape.layer, shape.hit, shape.noScale,
                    );
                }
                case "polygon": {
                    if (!shape.paint.fill) {
                        const rng = createRng(hashCoords(...shape.vertices.slice(0, 4)));
                        return {
                            ...shape,
                            vertices: wobblePolygonEdges(shape.vertices, bleed, rng),
                            paint: {...shape.paint, alpha: 0.5},
                        };
                    }
                    return washes(
                        (rng) => wobblePolygonEdges(shape.vertices, bleed, rng),
                        shape.paint,
                        hashCoords(...shape.vertices.slice(0, 4)),
                        shape.layer, shape.hit, shape.noScale,
                    );
                }
                case "line":
                    return {...shape, paint: {...shape.paint, alpha: (shape.paint.alpha ?? 1) * 0.6}};
                case "text":
                    return {...shape, fill: TEXT_COLOR};
                case "image":
                case "group":
                    return shape;
            }
        },
    };
}
