/**
 * Walk a {@link GroupShape} into a {@link RecordingGroupNode} — the unit the
 * Konva layer infrastructure consumes for replay. Same shape → command map
 * the legacy DrawingBackend → CanvasBackend pair did, but in one step with
 * no backend interface.
 *
 * Returns the node without attaching it to a layer; the caller decides which
 * layer to push it into (overlay layer materializes one Konva.Group per
 * recording, scene/grid/topLabel batch many recordings into one shared
 * sceneFunc).
 */

import Konva from "konva";
import {RecordingGroupNode} from "./RecordingLayer";
import {transformFill, type GroupShape, type Shape} from "../scene/Shape";

export function shapeToRecording(group: GroupShape): RecordingGroupNode {
    const node = new RecordingGroupNode(group.x, group.y);
    if (group.noScale) node.noScaling = true;
    addChildren(node, group.children, 0, 0);
    return node;
}

function addChildren(
    node: RecordingGroupNode,
    children: Shape[],
    ox: number,
    oy: number,
): void {
    for (const child of children) {
        addShape(node, child, ox, oy);
    }
}

function addShape(
    node: RecordingGroupNode,
    shape: Shape,
    ox: number,
    oy: number,
): void {
    switch (shape.type) {
        case "rect":
            node.commands.push({
                type: "rect",
                x: shape.x + ox,
                y: shape.y + oy,
                w: shape.width,
                h: shape.height,
                fill: transformFill(shape.paint.fill, ox, oy, 1, 0, 0),
                stroke: shape.paint.stroke,
                sw: shape.paint.strokeWidth ?? 0,
                cr: shape.cornerRadius ?? 0,
                dash: (shape.paint.dashEnabled !== false && shape.paint.dash) ? shape.paint.dash : undefined,
            });
            return;
        case "circle":
            node.commands.push({
                type: "circle",
                cx: shape.cx + ox,
                cy: shape.cy + oy,
                r: shape.radius,
                fill: transformFill(shape.paint.fill, ox, oy, 1, 0, 0),
                stroke: shape.paint.stroke,
                sw: shape.paint.strokeWidth ?? 0,
                dash: (shape.paint.dashEnabled !== false && shape.paint.dash) ? shape.paint.dash : undefined,
            });
            return;
        case "line": {
            const points = (ox === 0 && oy === 0)
                ? shape.points
                : translatePoints(shape.points, ox, oy);
            node.commands.push({
                type: "line",
                points,
                stroke: shape.paint.stroke,
                sw: shape.paint.strokeWidth ?? 0,
                dash: shape.paint.dash,
                lineCap: shape.lineCap,
                lineJoin: shape.lineJoin,
                alpha: shape.paint.alpha,
            });
            return;
        }
        case "polygon":
            node.commands.push({
                type: "polygon",
                vertices: (ox === 0 && oy === 0)
                    ? shape.vertices
                    : translatePoints(shape.vertices, ox, oy),
                fill: transformFill(shape.paint.fill, ox, oy, 1, 0, 0),
                stroke: shape.paint.stroke,
                sw: shape.paint.strokeWidth ?? 0,
            });
            return;
        case "text":
            node.commands.push({
                type: "text",
                x: shape.x + ox,
                y: shape.y + oy,
                text: shape.text,
                fontSize: shape.fontSize,
                fontFamily: shape.fontFamily ?? "sans-serif",
                fontStyle: shape.fontStyle ?? "normal",
                fill: shape.fill ?? "black",
                stroke: shape.stroke,
                sw: shape.strokeWidth ?? 0,
                align: shape.align ?? "left",
                vAlign: shape.verticalAlign ?? "top",
                w: shape.width ?? 0,
                h: shape.height ?? 0,
                baselineRatio: shape.baselineRatio,
                transform: shape.transform,
            });
            return;
        case "image": {
            const image = createImageElement(shape.src);
            node.commands.push({
                type: "image",
                x: shape.x + ox,
                y: shape.y + oy,
                w: shape.width,
                h: shape.height,
                image,
                transform: shape.transform,
            });
            return;
        }
        case "group":
            addChildren(node, shape.children, ox + shape.x, oy + shape.y);
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

function createImageElement(src: string): HTMLImageElement | any {
    const image = typeof Konva !== "undefined"
        ? Konva.Util.createImageElement()
        : (typeof Image !== "undefined" ? new Image() : null);
    if (image) image.src = src;
    return image;
}
