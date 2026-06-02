/**
 * Flatten a {@link Style}'s coordinate warp into a {@link SerializableTransform}
 * the worker can use without the (non-serialisable) style closures.
 *
 * All current built-in styles are either flat (`worldToScene` absent → identity)
 * or affine (Isometric). We reconstruct the affine matrix by sampling the
 * closure at three basis points — exact for affine maps. A future non-affine
 * style would be mis-sampled here; callers should fall back to main-thread
 * culling for such styles (see OffscreenCanvasBackend).
 */

import type {Style} from "../../style/Style";
import type {AffineMatrix, SerializableTransform} from "./protocol";

type TransformFn = (x: number, y: number) => {x: number; y: number};

/** Recover the affine matrix `[a,b,c,d,e,f]` of a (presumed affine) map. */
function sampleAffine(fn: TransformFn): AffineMatrix {
    const o = fn(0, 0);
    const x = fn(1, 0);
    const y = fn(0, 1);
    return [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y];
}

/** Build the flattened transform for a style. Identity styles short-circuit. */
export function serializeTransform(style: Style): SerializableTransform {
    if (!style.worldToScene || !style.sceneToWorld) {
        return {kind: "identity"};
    }
    return {
        kind: "affine",
        forward: sampleAffine((x, y) => style.worldToScene!(x, y)),
        inverse: sampleAffine((x, y) => style.sceneToWorld!(x, y)),
    };
}

function applyMatrix(m: AffineMatrix, x: number, y: number): {x: number; y: number} {
    return {x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5]};
}

/**
 * World → scene projector for the worker's cull-bounds test. Returns
 * `undefined` for the identity transform so callers can skip projection.
 */
export function forwardFn(transform: SerializableTransform): TransformFn | undefined {
    if (transform.kind === "identity") return undefined;
    const m = transform.forward;
    return (x, y) => applyMatrix(m, x, y);
}

/**
 * Scene → world projector for the worker's grid Cartesian-bounds computation.
 * Returns `undefined` for the identity transform (grid layout treats absent
 * inverse as identity).
 */
export function inverseFn(transform: SerializableTransform): TransformFn | undefined {
    if (transform.kind === "identity") return undefined;
    const m = transform.inverse;
    return (x, y) => applyMatrix(m, x, y);
}
