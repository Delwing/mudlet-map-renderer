/**
 * Style — engine-agnostic geometry transformer.
 *
 * A {@link Style} takes a {@link Shape} from the scene pipeline and returns
 * zero or more transformed Shapes. Transforms run **before** the shapes hit
 * culling, hit-testing, and the {@link DrawCommandBuilder}, so styles never
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
     * Cartesian offset for exit-line groups so they connect at the cube base
     * (Isometric) instead of the top face. Returns {x:0, y:0} for flat styles.
     */
    getExitDepthOffset?(): {x: number; y: number};
}

/** Identity style — passes shapes through unchanged. */
export const identityStyle: Style = {
    transform: (shape) => shape,
};

/**
 * Compose a chain of styles into a single style. Shapes flow left → right:
 * `compose(Parchment, Sketchy)` first re-paints with Parchment, then wobbles
 * with Sketchy.
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

        getExitDepthOffset() {
            // Take the last non-zero offset in the chain. Today only Isometric
            // sets this; chained styles that include Iso should preserve its
            // offset regardless of where Iso sits in the chain.
            for (let i = styles.length - 1; i >= 0; i--) {
                const off = styles[i].getExitDepthOffset?.();
                if (off && (off.x !== 0 || off.y !== 0)) return off;
            }
            return {x: 0, y: 0};
        },
    };
}
