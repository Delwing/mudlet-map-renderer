/**
 * Recursively apply a {@link Style} to a list of {@link Shape}s, walking into
 * group children so paint / coordinate rewrites reach every leaf.
 *
 * Each leaf is passed through `style.transform`; groups are transformed too
 * (after their children have been mapped) so styles like Isometric can rewrite
 * the group itself when needed. Result is flattened into a new shape list.
 */

import type {Shape} from "../scene/Shape";
import type {Style, StyleContext} from "./Style";

export function applyStyleToShapes(
    shapes: Shape[],
    style: Style,
    ctx: StyleContext,
): Shape[] {
    const out: Shape[] = [];
    for (const shape of shapes) {
        const transformed = applyStyle(shape, style, ctx);
        if (Array.isArray(transformed)) out.push(...transformed);
        else out.push(transformed);
    }
    return out;
}

function applyStyle(shape: Shape, style: Style, ctx: StyleContext): Shape | Shape[] {
    if (shape.type === "group") {
        const children: Shape[] = [];
        for (const child of shape.children) {
            const out = applyStyle(child, style, ctx);
            if (Array.isArray(out)) children.push(...out);
            else children.push(out);
        }
        // Transform the (recursively styled) group so styles that need to
        // rewrite the container itself (e.g. Isometric coordinate warping)
        // see the post-children form.
        return style.transform({...shape, children}, ctx);
    }
    return style.transform(shape, ctx);
}
