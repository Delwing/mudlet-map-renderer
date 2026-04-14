import Konva from "konva";
import type {
    DrawingBackend, GroupNode, LayerNode,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
} from "./DrawingBackend";

/**
 * Wraps a Konva.Group as a GroupNode.
 */
export class KonvaGroupNode implements GroupNode {
    readonly konvaGroup: Konva.Group;

    constructor(group: Konva.Group) {
        this.konvaGroup = group;
    }

    setVisible(visible: boolean) {
        this.konvaGroup.visible(visible);
    }

    isVisible(): boolean {
        return this.konvaGroup.visible();
    }

    destroy() {
        this.konvaGroup.destroy();
    }

    setPosition(x: number, y: number) {
        this.konvaGroup.position({x, y});
    }

    getPosition() {
        return this.konvaGroup.position();
    }

    moveToTop() {
        this.konvaGroup.moveToTop();
    }
}

/**
 * Wraps a Konva.Layer as a LayerNode.
 */
export class KonvaLayerNode implements LayerNode {
    readonly konvaLayer: Konva.Layer;

    constructor(layer: Konva.Layer) {
        this.konvaLayer = layer;
    }

    addNode(node: GroupNode) {
        if (node instanceof KonvaGroupNode) {
            this.konvaLayer.add(node.konvaGroup);
        }
    }

    destroyChildren() {
        this.konvaLayer.destroyChildren();
    }

    batchDraw() {
        this.konvaLayer.batchDraw();
    }
}

/**
 * Konva implementation of DrawingBackend.
 */
export class KonvaBackend implements DrawingBackend {

    createGroup(x: number, y: number): KonvaGroupNode {
        return new KonvaGroupNode(new Konva.Group({
            x, y,
            listening: false,
        }));
    }

    addRect(parent: GroupNode, config: RectConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        parent.konvaGroup.add(new Konva.Rect({
            x: config.x,
            y: config.y,
            width: config.width,
            height: config.height,
            fill: config.fill,
            stroke: config.stroke,
            strokeWidth: config.strokeWidth ?? 0,
            cornerRadius: config.cornerRadius ?? 0,
            dash: config.dash,
            dashEnabled: config.dashEnabled ?? false,
            perfectDrawEnabled: false,
            listening: false,
        }));
    }

    addCircle(parent: GroupNode, config: CircleConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        parent.konvaGroup.add(new Konva.Circle({
            x: config.cx,
            y: config.cy,
            radius: config.radius,
            fill: config.fill,
            stroke: config.stroke,
            strokeWidth: config.strokeWidth ?? 0,
            dash: config.dash,
            dashEnabled: config.dashEnabled ?? false,
            perfectDrawEnabled: false,
            listening: false,
        }));
    }

    addLine(parent: GroupNode, config: LineConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        parent.konvaGroup.add(new Konva.Line({
            points: config.points,
            stroke: config.stroke,
            strokeWidth: config.strokeWidth ?? 0,
            dash: config.dash,
            perfectDrawEnabled: false,
            listening: false,
        }));
    }

    addPolygon(parent: GroupNode, config: PolygonConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        parent.konvaGroup.add(new Konva.Line({
            points: config.vertices,
            closed: true,
            fill: config.fill,
            stroke: config.stroke,
            strokeWidth: config.strokeWidth ?? 0,
            perfectDrawEnabled: false,
            listening: false,
        }));
    }

    addText(parent: GroupNode, config: TextConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        parent.konvaGroup.add(new Konva.Text({
            x: config.x,
            y: config.y,
            text: config.text,
            fontSize: config.fontSize,
            fontFamily: config.fontFamily,
            fontStyle: config.fontStyle,
            fill: config.fill,
            align: config.align,
            verticalAlign: config.verticalAlign,
            width: config.width,
            height: config.height,
            offsetY: config.offsetY,
            perfectDrawEnabled: false,
            listening: false,
        }));
    }

    addImage(parent: GroupNode, config: ImageConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        const image = Konva.Util.createImageElement();
        image.src = config.src;
        parent.konvaGroup.add(new Konva.Image({
            x: config.x,
            y: config.y,
            width: config.width,
            height: config.height,
            image: image,
            listening: false,
        }));
    }
}
