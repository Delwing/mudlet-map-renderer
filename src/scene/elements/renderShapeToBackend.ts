import type {
    DrawingBackend,
    GroupNode,
    LineConfig,
} from "../../backend/DrawingBackend";
import type {GroupShape, Shape} from "../Shape";

export interface RenderShapeOptions {
    /**
     * Treat shapes flagged as `grid` as infrastructure, routing through
     * {@link DrawingBackend.addGridLine} so styles can decline to decorate
     * them. Defaults to false.
     */
    useGridLine?: boolean;
}

/**
 * Walk a {@link GroupShape} and emit it to a {@link DrawingBackend} as a
 * GroupNode plus primitive children. Returns the GroupNode without attaching
 * it to a layer — the caller decides which layer it belongs on after using
 * the returned reference for hit-testing / culling bookkeeping.
 *
 * Nested groups are flattened: a child GroupShape's offset is folded into
 * its descendants' coordinates. The current layout modules only emit a
 * single level of grouping; the flatten path is there for future use.
 */
export function renderShapeToBackend(
    backend: DrawingBackend,
    group: GroupShape,
    options: RenderShapeOptions = {},
): GroupNode {
    const node = backend.createGroup(group.x, group.y);
    if (group.noScale) node.noScaling = true;
    addChildren(backend, node, group.children, 0, 0, options);
    return node;
}

function addChildren(
    backend: DrawingBackend,
    parent: GroupNode,
    children: Shape[],
    ox: number,
    oy: number,
    options: RenderShapeOptions,
): void {
    for (const child of children) {
        addShape(backend, parent, child, ox, oy, options);
    }
}

function addShape(
    backend: DrawingBackend,
    parent: GroupNode,
    shape: Shape,
    ox: number,
    oy: number,
    options: RenderShapeOptions,
): void {
    switch (shape.type) {
        case "rect":
            backend.addRect(parent, {
                x: shape.x + ox,
                y: shape.y + oy,
                width: shape.width,
                height: shape.height,
                cornerRadius: shape.cornerRadius,
                fill: shape.paint.fill,
                stroke: shape.paint.stroke,
                strokeWidth: shape.paint.strokeWidth,
                dash: shape.paint.dash,
                dashEnabled: shape.paint.dashEnabled,
            });
            return;
        case "circle":
            backend.addCircle(parent, {
                cx: shape.cx + ox,
                cy: shape.cy + oy,
                radius: shape.radius,
                fill: shape.paint.fill,
                stroke: shape.paint.stroke,
                strokeWidth: shape.paint.strokeWidth,
                dash: shape.paint.dash,
                dashEnabled: shape.paint.dashEnabled,
            });
            return;
        case "line": {
            const points = (ox === 0 && oy === 0)
                ? shape.points
                : translatePoints(shape.points, ox, oy);
            const config: LineConfig = {
                points,
                stroke: shape.paint.stroke,
                strokeWidth: shape.paint.strokeWidth,
                dash: shape.paint.dash,
                lineCap: shape.lineCap,
                lineJoin: shape.lineJoin,
                alpha: shape.paint.alpha,
            };
            if (options.useGridLine && shape.grid) {
                backend.addGridLine(parent, config);
            } else {
                backend.addLine(parent, config);
            }
            return;
        }
        case "polygon":
            backend.addPolygon(parent, {
                vertices: (ox === 0 && oy === 0)
                    ? shape.vertices
                    : translatePoints(shape.vertices, ox, oy),
                fill: shape.paint.fill,
                stroke: shape.paint.stroke,
                strokeWidth: shape.paint.strokeWidth,
            });
            return;
        case "text":
            backend.addText(parent, {
                x: shape.x + ox,
                y: shape.y + oy,
                text: shape.text,
                fontSize: shape.fontSize,
                fontFamily: shape.fontFamily,
                fontStyle: shape.fontStyle,
                fill: shape.fill,
                align: shape.align,
                verticalAlign: shape.verticalAlign,
                width: shape.width,
                height: shape.height,
                baselineRatio: shape.baselineRatio,
                konvaCorrectionRatio: shape.konvaCorrectionRatio,
                transform: shape.transform,
            });
            return;
        case "image":
            backend.addImage(parent, {
                x: shape.x + ox,
                y: shape.y + oy,
                width: shape.width,
                height: shape.height,
                src: shape.src,
                transform: shape.transform,
            });
            return;
        case "group":
            addChildren(backend, parent, shape.children, ox + shape.x, oy + shape.y, options);
            return;
    }
}

function translatePoints(points: number[], ox: number, oy: number): number[] {
    const out = new Array<number>(points.length);
    for (let i = 0; i < points.length; i += 2) {
        out[i] = points[i] + ox;
        out[i + 1] = points[i + 1] + oy;
    }
    return out;
}
