import Konva from "konva";
import type {GroupNode, LayerNode} from "./DrawingBackend";
import {SceneGroupNode} from "./CanvasBackend";

/**
 * Wraps a Konva.Layer as a LayerNode.
 */
export class KonvaLayerNode implements LayerNode {
    readonly konvaLayer: Konva.Layer;

    constructor(layer: Konva.Layer) {
        this.konvaLayer = layer;
    }

    addNode(node: GroupNode) {
        if (node instanceof SceneGroupNode) {
            this.konvaLayer.add(node.materialize());
        }
    }

    destroyChildren() {
        this.konvaLayer.destroyChildren();
    }

    batchDraw() {
        this.konvaLayer.batchDraw();
    }
}
