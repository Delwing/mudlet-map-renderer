/**
 * Style — engine-agnostic geometry transformer.
 *
 * A {@link Style} takes a {@link Shape} from the scene pipeline and returns
 * zero or more transformed Shapes. Transforms run **before** the shapes hit
 * culling, hit-testing, and the {@link buildDrawCommands}, so styles never
 * need a backend handle and never know about Konva or SVG.
 *
 * Most styles return one shape (recoloured / re-projected). Some split:
 *   - Sketchy may emit multiple wobbled segments for a long line.
 *   - Neon emits a wide-translucent glow shape plus the main shape.
 *   - Isometric projects coordinates and may emit cube side-face shapes.
 *
 * Compose styles with {@link compose}; the leftmost style runs first.
 */

import type {Shape} from "../scene/Shape";

/** Per-frame context passed to style transforms. */
export interface StyleContext {
    /** Camera scale (BASE_SCALE * zoom). */
    scale: number;
    /** Active room size in world units (for jitter / depth tuning). */
    roomSize: number;
}

export interface Style {
    /**
     * Transform one shape into one or more shapes. Implementations should be
     * pure: same input + context → same output. Group children are walked by
     * the caller (the pipeline / a wrapper); transforms see leaf shapes and
     * group shapes as-is.
     */
    transform(shape: Shape, ctx: StyleContext): Shape | Shape[];

    /**
     * Optional world-space → scene-space coordinate map for styles that warp
     * coordinates (e.g. Isometric). When set, {@link HitTester} and
     * {@link Camera} use the inverse to translate clicks back to map space.
     */
    worldToScene?(x: number, y: number): {x: number; y: number};

    /** Inverse of {@link worldToScene}. */
    sceneToWorld?(x: number, y: number): {x: number; y: number};

    /**
     * Optional extra scene-space offset that {@link transform} applies to a
     * given layer's groups but {@link worldToScene} does not capture. Isometric
     * lowers the `link` layer by the cube depth so connectors meet the cube
     * base; without mirroring that here, {@link HitTester} would place exit hit
     * zones a cube-height above the drawn connectors. Returns `{x:0, y:0}` for
     * layers it does not shift.
     */
    sceneLayerOffset?(layer: Shape["layer"]): {x: number; y: number};
}

/** Identity style — passes shapes through unchanged. */
export const identityStyle: Style = {
    transform: (shape) => shape,
};

/**
 * Compose a chain of styles into a single style. Shapes flow **left → right**:
 * the leftmost style transforms first, the rightmost transforms last and gets
 * the final say on the emitted shapes.
 *
 * Order matters in two ways:
 *
 * 1. **Shape-changing styles must come before styles that depend on the new
 *    geometry.** {@link sketchyShapeStyle} converts rect/circle into polygon,
 *    and {@link isometricShapeStyle} only extrudes rect/circle into cubes — so
 *    Iso must run before Sketchy or the cubes never form.
 * 2. **Paint-rewriting styles overwrite earlier paint choices.** Put the style
 *    whose colour palette you want on screen *last*: in
 *    `compose(Sketchy(...), Parchment)` Parchment recolours Sketchy's pencil
 *    fills/strokes into the parchment palette; reverse the order and Sketchy
 *    repaints over Parchment's choices.
 *
 * Example — isometric parchment cubes with hand-drawn wobble:
 * ```ts
 * compose(
 *     Isometric({depth, rotation}),         // rects → cube-face polygons
 *     Sketchy({jitter, color: '#4a3728'}),  // wobble each polygon
 *     Parchment,                            // recolour to parchment palette
 * );
 * ```
 */
export function compose(...styles: Style[]): Style {
    if (styles.length === 0) return identityStyle;
    if (styles.length === 1) return styles[0];

    return {
        transform(shape, ctx) {
            let acc: Shape[] = [shape];
            for (const style of styles) {
                const next: Shape[] = [];
                for (const s of acc) {
                    const out = style.transform(s, ctx);
                    if (Array.isArray(out)) next.push(...out);
                    else next.push(out);
                }
                acc = next;
            }
            return acc;
        },

        worldToScene(x, y) {
            let p = {x, y};
            for (const style of styles) {
                if (style.worldToScene) p = style.worldToScene(p.x, p.y);
            }
            return p;
        },

        sceneToWorld(x, y) {
            let p = {x, y};
            for (let i = styles.length - 1; i >= 0; i--) {
                const style = styles[i];
                if (style.sceneToWorld) p = style.sceneToWorld(p.x, p.y);
            }
            return p;
        },

        sceneLayerOffset(layer) {
            let x = 0, y = 0;
            for (const style of styles) {
                if (!style.sceneLayerOffset) continue;
                const o = style.sceneLayerOffset(layer);
                x += o.x;
                y += o.y;
            }
            return {x, y};
        },
    };
}
