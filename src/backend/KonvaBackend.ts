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
            lineCap: config.lineCap as CanvasLineCap | undefined,
            lineJoin: config.lineJoin as CanvasLineJoin | undefined,
            opacity: config.alpha,
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
        // Konva centres text using font-wide bounding-box metrics (from 'M').
        // konvaCorrectionRatio compensates for glyphs whose visual bounds differ.
        const offsetY = (config.offsetY ?? 0)
            + (config.konvaCorrectionRatio ?? 0) * config.fontSize;

        if (config.transform) {
            const [a, b, c, d, e, f] = config.transform;
            const w = config.width;
            const h = config.height;
            const text = config.text;
            const fontSize = config.fontSize;
            const fontFamily = config.fontFamily ?? 'sans-serif';
            const fontStyle = config.fontStyle ?? 'normal';
            const fill = config.fill ?? 'black';
            parent.konvaGroup.add(new Konva.Shape({
                listening: false,
                perfectDrawEnabled: false,
                sceneFunc: (ctx) => {
                    ctx.save();
                    // @ts-ignore — access native canvas context
                    const c2d: CanvasRenderingContext2D = ctx._context;
                    c2d.transform(a, b, c, d, e, f);
                    c2d.font = `${fontStyle} ${fontSize}px ${fontFamily}`;
                    c2d.fillStyle = fill;
                    c2d.textAlign = 'center';
                    c2d.textBaseline = 'middle';
                    c2d.fillText(text, (w ?? 0) / 2, (h ?? 0) / 2);
                    ctx.restore();
                },
            }));
        } else {
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
                offsetY: offsetY || undefined,
                perfectDrawEnabled: false,
                listening: false,
            }));
        }
    }

    addImage(parent: GroupNode, config: ImageConfig) {
        if (!(parent instanceof KonvaGroupNode)) return;
        const image = Konva.Util.createImageElement();
        image.src = config.src;

        if (config.transform) {
            const [a, b, c, d, e, f] = config.transform;
            const w = config.width;
            const h = config.height;
            // Use a custom shape to draw the image with an affine transform
            parent.konvaGroup.add(new Konva.Shape({
                listening: false,
                perfectDrawEnabled: false,
                sceneFunc: (ctx, shape) => {
                    ctx.save();
                    // @ts-ignore — Konva context wraps a native canvas 2d context
                    const c2d: CanvasRenderingContext2D = ctx._context;
                    c2d.transform(a, b, c, d, e, f);
                    c2d.drawImage(image, 0, 0, w, h);
                    ctx.restore();
                },
            }));
        } else {
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
}
