import type {GroupNode, LayerNode} from "./DrawingBackend";
import type {DrawCommand} from "./CanvasBackend";
import {SceneGroupNode} from "./CanvasBackend";

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
 * Convert a single recorded DrawCommand to an SVG element string.
 * Returns an empty string for commands that produce no output.
 */
export function drawCommandToSvg(cmd: DrawCommand): string {
    switch (cmd.type) {
        case 'rect': {
            const fill = cmd.fill ?? 'none';
            return `<rect${attr('x', cmd.x)}${attr('y', cmd.y)}${attr('width', cmd.w)}${attr('height', cmd.h)}${attr('fill', fill)}${attr('stroke', cmd.stroke)}${attr('stroke-width', cmd.sw || undefined)}${cmd.cr ? `${attr('rx', cmd.cr)}${attr('ry', cmd.cr)}` : ''}${cmd.dash ? ` stroke-dasharray="${cmd.dash.join(' ')}"` : ''}/>`;
        }
        case 'circle': {
            const fill = cmd.fill ?? 'none';
            return `<circle${attr('cx', cmd.cx)}${attr('cy', cmd.cy)}${attr('r', cmd.r)}${attr('fill', fill)}${attr('stroke', cmd.stroke)}${attr('stroke-width', cmd.sw || undefined)}${cmd.dash ? ` stroke-dasharray="${cmd.dash.join(' ')}"` : ''}/>`;
        }
        case 'line': {
            if (cmd.points.length < 4) return '';
            const pts: string[] = [];
            for (let i = 0; i < cmd.points.length; i += 2) pts.push(`${cmd.points[i]},${cmd.points[i + 1]}`);
            return `<polyline points="${pts.join(' ')}"${attr('stroke', cmd.stroke)}${attr('stroke-width', cmd.sw || undefined)}${cmd.dash ? ` stroke-dasharray="${cmd.dash.join(' ')}"` : ''}${attr('stroke-linecap', cmd.lineCap)}${attr('stroke-linejoin', cmd.lineJoin)}${cmd.alpha !== undefined ? attr('opacity', cmd.alpha) : ''} fill="none"/>`;
        }
        case 'polygon': {
            if (cmd.vertices.length < 4) return '';
            const pts: string[] = [];
            for (let i = 0; i < cmd.vertices.length; i += 2) pts.push(`${cmd.vertices[i]},${cmd.vertices[i + 1]}`);
            return `<polygon points="${pts.join(' ')}"${attr('fill', cmd.fill)}${attr('stroke', cmd.stroke)}${attr('stroke-width', cmd.sw || undefined)}/>`;
        }
        case 'text': {
            let x = cmd.x;
            let y = cmd.y;
            let anchor = 'start';
            let baseline = 'auto';
            if (cmd.w > 0) {
                if (cmd.align === 'center') { x = cmd.x + cmd.w / 2; anchor = 'middle'; }
                else if (cmd.align === 'right') { x = cmd.x + cmd.w; anchor = 'end'; }
            }
            if (cmd.h > 0 && cmd.vAlign === 'middle') {
                if (cmd.baselineRatio !== undefined) {
                    y = cmd.y + cmd.h / 2 + cmd.baselineRatio * cmd.fontSize;
                } else {
                    y = cmd.y + cmd.h / 2;
                    baseline = 'central';
                }
            }
            const transformAttr = cmd.transform ? ` transform="matrix(${cmd.transform.join(',')})"` : '';
            return `<text${attr('x', x)}${attr('y', y)}${attr('font-size', cmd.fontSize)}${cmd.fontFamily ? attr('font-family', cmd.fontFamily) : ''}${cmd.fontStyle === 'bold' ? ' font-weight="bold"' : ''}${attr('fill', cmd.fill)} text-anchor="${anchor}" dominant-baseline="${baseline}"${transformAttr}>${escapeXml(cmd.text)}</text>`;
        }
        case 'image': {
            const href = cmd.src ?? '';
            if (!href) return '';
            if (cmd.transform) {
                const [a, b, c, d, e, f] = cmd.transform;
                return `<image${attr('width', cmd.w)}${attr('height', cmd.h)} href="${escapeXml(href)}" transform="matrix(${a},${b},${c},${d},${e},${f})"/>`;
            }
            return `<image${attr('x', cmd.x)}${attr('y', cmd.y)}${attr('width', cmd.w)}${attr('height', cmd.h)} href="${escapeXml(href)}"/>`;
        }
    }
}

function sceneGroupToSvg(group: SceneGroupNode): string {
    const parts = group.commands.map(drawCommandToSvg).filter(s => s.length > 0);
    if (parts.length === 0) return '';
    const inner = parts.join('\n');
    if (group.x === 0 && group.y === 0) return inner;
    return `<g transform="translate(${group.x},${group.y})">\n${inner}\n</g>`;
}

/**
 * LayerNode backed by SceneGroupNode instances (DrawCommand[]).
 * toSvg() replays the recorded commands as SVG elements — the same
 * DrawCommand[] that drives the canvas is read here.
 */
export class SvgLayerNode implements LayerNode {
    private groups: SceneGroupNode[] = [];

    addNode(node: GroupNode) {
        if (node instanceof SceneGroupNode) {
            this.groups.push(node);
        }
    }

    destroyChildren() {
        this.groups = [];
    }

    batchDraw() { /* no-op */ }

    toSvg(): string {
        return this.groups
            .filter(g => g.isVisible())
            .map(g => sceneGroupToSvg(g))
            .filter(s => s.length > 0)
            .join('\n');
    }
}
