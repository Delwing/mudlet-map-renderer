import type {
    DrawingBackend,
    GroupNode, LayerNode, CoordFn,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
} from "./DrawingBackend";
import {IDENTITY_TRANSFORM} from "./DrawingBackend";

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function attr(name: string, value: string | number | undefined): string {
    if (value === undefined) return '';
    return ` ${name}="${typeof value === 'string' ? escapeXml(value) : value}"`;
}

function dashAttr(dash?: number[], dashEnabled?: boolean): string {
    if (!dash || dashEnabled === false) return '';
    return ` stroke-dasharray="${dash.join(' ')}"`;
}

/**
 * SVG implementation of GroupNode.
 * Accumulates SVG element strings at a given (x, y) offset.
 */
export class SvgGroupNode implements GroupNode {
    readonly x: number;
    readonly y: number;
    readonly elements: string[] = [];
    private visible = true;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    setVisible(visible: boolean) { this.visible = visible; }
    isVisible(): boolean { return this.visible; }
    destroy() { this.elements.length = 0; }
    setPosition(x: number, y: number) { /* immutable for SVG */ }
    getPosition() { return {x: this.x, y: this.y}; }
    moveToTop() { /* no-op for SVG */ }

    toSvg(): string {
        if (!this.visible || this.elements.length === 0) return '';
        if (this.x === 0 && this.y === 0) {
            return this.elements.join('\n');
        }
        return `<g transform="translate(${this.x},${this.y})">\n${this.elements.join('\n')}\n</g>`;
    }
}

/**
 * SVG implementation of LayerNode.
 * Collects groups and serializes them to SVG.
 */
export class SvgLayerNode implements LayerNode {
    private groups: SvgGroupNode[] = [];

    addNode(node: GroupNode) {
        if (node instanceof SvgGroupNode) {
            this.groups.push(node);
        }
    }

    destroyChildren() {
        this.groups = [];
    }

    batchDraw() { /* no-op for SVG */ }

    toSvg(): string {
        return this.groups
            .filter(g => g.isVisible())
            .map(g => g.toSvg())
            .filter(s => s.length > 0)
            .join('\n');
    }
}

/**
 * SVG implementation of DrawingBackend.
 * Creates SVG elements as strings instead of Konva nodes.
 */
export class SvgBackend implements DrawingBackend {

    createGroup(x: number, y: number): SvgGroupNode {
        return new SvgGroupNode(x, y);
    }

    addRect(parent: GroupNode, config: RectConfig) {
        if (!(parent instanceof SvgGroupNode)) return;
        const fill = config.fill ?? 'none';
        const el = `<rect${attr('x', config.x)}${attr('y', config.y)}${attr('width', config.width)}${attr('height', config.height)}${attr('fill', fill)}${attr('stroke', config.stroke)}${attr('stroke-width', config.strokeWidth)}${config.cornerRadius ? `${attr('rx', config.cornerRadius)}${attr('ry', config.cornerRadius)}` : ''}${dashAttr(config.dash, config.dashEnabled)}/>`;
        parent.elements.push(el);
    }

    addCircle(parent: GroupNode, config: CircleConfig) {
        if (!(parent instanceof SvgGroupNode)) return;
        const fill = config.fill ?? 'none';
        const el = `<circle${attr('cx', config.cx)}${attr('cy', config.cy)}${attr('r', config.radius)}${attr('fill', fill)}${attr('stroke', config.stroke)}${attr('stroke-width', config.strokeWidth)}${dashAttr(config.dash, config.dashEnabled)}/>`;
        parent.elements.push(el);
    }

    addLine(parent: GroupNode, config: LineConfig) {
        if (!(parent instanceof SvgGroupNode)) return;
        const points = config.points;
        const svgPoints: string[] = [];
        for (let i = 0; i < points.length; i += 2) {
            svgPoints.push(`${points[i]},${points[i + 1]}`);
        }
        const el = `<polyline points="${svgPoints.join(' ')}"${attr('stroke', config.stroke)}${attr('stroke-width', config.strokeWidth)}${dashAttr(config.dash)}${attr('stroke-linecap', config.lineCap)}${attr('stroke-linejoin', config.lineJoin)}${attr('opacity', config.alpha)} fill="none"/>`;
        parent.elements.push(el);
    }

    addGridLine(parent: GroupNode, config: LineConfig) {
        this.addLine(parent, config);
    }

    addPolygon(parent: GroupNode, config: PolygonConfig) {
        if (!(parent instanceof SvgGroupNode)) return;
        const vertices = config.vertices;
        const svgPoints: string[] = [];
        for (let i = 0; i < vertices.length; i += 2) {
            svgPoints.push(`${vertices[i]},${vertices[i + 1]}`);
        }
        const el = `<polygon points="${svgPoints.join(' ')}"${attr('fill', config.fill)}${attr('stroke', config.stroke)}${attr('stroke-width', config.strokeWidth)}/>`;
        parent.elements.push(el);
    }

    addText(parent: GroupNode, config: TextConfig) {
        if (!(parent instanceof SvgGroupNode)) return;

        // Compute text position based on alignment
        let x = config.x;
        let y = config.y;
        let anchor = 'start';
        let baseline = 'auto';

        if (config.width !== undefined) {
            if (config.align === 'center') {
                x = config.x + config.width / 2;
                anchor = 'middle';
            } else if (config.align === 'right') {
                x = config.x + config.width;
                anchor = 'end';
            }
        }
        if (config.height !== undefined && config.verticalAlign === 'middle') {
            if (config.baselineRatio !== undefined) {
                // Explicit baseline positioning for accurate vertical centering.
                // baselineRatio is the fraction of fontSize from top to alphabetic baseline.
                // Position y so the glyph is visually centered in the box.
                y = config.y + config.height / 2 + config.baselineRatio * config.fontSize;
                // Keep default alphabetic baseline — the ratio already accounts for it.
            } else {
                y = config.y + config.height / 2;
                baseline = 'central';
            }
        } else if (config.offsetY) {
            y -= config.offsetY;
        }

        const transformAttr = config.transform
            ? ` transform="matrix(${config.transform.join(',')})"`
            : '';
        const el = `<text${attr('x', x)}${attr('y', y)}${attr('font-size', config.fontSize)}${config.fontFamily ? attr('font-family', config.fontFamily) : ''}${config.fontStyle === 'bold' ? ' font-weight="bold"' : ''}${attr('fill', config.fill)} text-anchor="${anchor}" dominant-baseline="${baseline}"${transformAttr}>${escapeXml(config.text)}</text>`;
        parent.elements.push(el);
    }

    addImage(parent: GroupNode, config: ImageConfig) {
        if (!(parent instanceof SvgGroupNode)) return;
        if (config.transform) {
            const [a, b, c, d, e, f] = config.transform;
            const el = `<image${attr('width', config.width)}${attr('height', config.height)} href="${escapeXml(config.src)}" transform="matrix(${a},${b},${c},${d},${e},${f})"/>`;
            parent.elements.push(el);
        } else {
            const el = `<image${attr('x', config.x)}${attr('y', config.y)}${attr('width', config.width)}${attr('height', config.height)} href="${escapeXml(config.src)}"/>`;
            parent.elements.push(el);
        }
    }

    requestRedraw(): void {}

    getExitDepthOffset(): { x: number; y: number } {
        return { x: 0, y: 0 };
    }

    getTransform(): CoordFn {
        return IDENTITY_TRANSFORM;
    }

    getInverseTransform(): CoordFn {
        return IDENTITY_TRANSFORM;
    }
}
