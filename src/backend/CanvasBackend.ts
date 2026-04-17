import Konva from "konva";
import type {
    DrawingBackend, InteractiveDrawingBackend,
    GroupNode, LayerNode, CoordFn,
    RectConfig, CircleConfig, LineConfig, PolygonConfig, TextConfig, ImageConfig,
} from "./DrawingBackend";
import {IDENTITY_TRANSFORM} from "./DrawingBackend";

// --- Draw command types ---

type RectCommand = { type: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw: number; cr: number; dash?: number[] };
type CircleCommand = { type: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw: number; dash?: number[] };
type LineCommand = { type: 'line'; points: number[]; stroke?: string; sw: number; dash?: number[]; lineCap?: string; lineJoin?: string; alpha?: number };
type PolygonCommand = { type: 'polygon'; vertices: number[]; fill?: string; stroke?: string; sw: number };
type TextCommand = { type: 'text'; x: number; y: number; text: string; fontSize: number; fontFamily: string; fontStyle: string; fill: string; align: string; vAlign: string; w: number; h: number; baselineRatio?: number; transform?: [number, number, number, number, number, number] };
type ImageCommand = { type: 'image'; x: number; y: number; w: number; h: number; image: HTMLImageElement | any; transform?: [number, number, number, number, number, number] };

type DrawCommand = RectCommand | CircleCommand | LineCommand | PolygonCommand | TextCommand | ImageCommand;

// --- Canvas2D replay ---

function replayCommand(ctx: CanvasRenderingContext2D, cmd: DrawCommand) {
    switch (cmd.type) {
        case 'rect': {
            ctx.beginPath();
            if (cmd.cr > 0 && typeof ctx.roundRect === 'function') {
                ctx.roundRect(cmd.x, cmd.y, cmd.w, cmd.h, cmd.cr);
            } else {
                ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
            }
            if (cmd.fill) {
                ctx.fillStyle = cmd.fill;
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                if (cmd.dash) ctx.setLineDash(cmd.dash); else ctx.setLineDash([]);
                ctx.stroke();
            }
            break;
        }
        case 'circle': {
            ctx.beginPath();
            ctx.arc(cmd.cx, cmd.cy, cmd.r, 0, Math.PI * 2);
            if (cmd.fill) {
                ctx.fillStyle = cmd.fill;
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                if (cmd.dash) ctx.setLineDash(cmd.dash); else ctx.setLineDash([]);
                ctx.stroke();
            }
            break;
        }
        case 'line': {
            if (cmd.points.length < 4) break;
            const savedAlpha = ctx.globalAlpha;
            if (cmd.alpha !== undefined) ctx.globalAlpha = cmd.alpha;
            ctx.beginPath();
            ctx.moveTo(cmd.points[0], cmd.points[1]);
            for (let i = 2; i < cmd.points.length; i += 2) {
                ctx.lineTo(cmd.points[i], cmd.points[i + 1]);
            }
            if (cmd.stroke) ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = cmd.sw;
            if (cmd.dash) ctx.setLineDash(cmd.dash); else ctx.setLineDash([]);
            if (cmd.lineCap) ctx.lineCap = cmd.lineCap as CanvasLineCap;
            if (cmd.lineJoin) ctx.lineJoin = cmd.lineJoin as CanvasLineJoin;
            ctx.stroke();
            if (cmd.alpha !== undefined) ctx.globalAlpha = savedAlpha;
            break;
        }
        case 'polygon': {
            if (cmd.vertices.length < 4) break;
            ctx.beginPath();
            ctx.moveTo(cmd.vertices[0], cmd.vertices[1]);
            for (let i = 2; i < cmd.vertices.length; i += 2) {
                ctx.lineTo(cmd.vertices[i], cmd.vertices[i + 1]);
            }
            ctx.closePath();
            if (cmd.fill) {
                ctx.fillStyle = cmd.fill;
                ctx.fill();
            }
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                ctx.setLineDash([]);
                ctx.stroke();
            }
            break;
        }
        case 'text': {
            // Scale up sub-pixel font sizes so Canvas2D text metrics and alignment
            // work correctly. node-canvas (and some browsers) produce broken
            // alignment for font sizes < 1px.
            const TEXT_SCALE = 100;
            const scaledSize = cmd.fontSize * TEXT_SCALE;
            const font = `${cmd.fontStyle} ${scaledSize}px ${cmd.fontFamily}`;
            ctx.save();
            ctx.font = font;
            ctx.fillStyle = cmd.fill;
            // Use pixel-measured baselineRatio when available: the browser's
            // textBaseline='middle' uses font-wide metrics, which mis-centers
            // glyphs whose visual bounds differ from the font em-box (e.g. "T").
            const hasBaselineRatio = cmd.baselineRatio !== undefined;
            if (cmd.transform) {
                ctx.transform(...cmd.transform);
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                ctx.textAlign = 'center';
                if (hasBaselineRatio) {
                    ctx.textBaseline = 'alphabetic';
                    const by = (cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize) * TEXT_SCALE;
                    ctx.fillText(cmd.text, cmd.w * TEXT_SCALE / 2, by);
                } else {
                    ctx.textBaseline = 'middle';
                    ctx.fillText(cmd.text, cmd.w * TEXT_SCALE / 2, cmd.h * TEXT_SCALE / 2);
                }
            } else if (cmd.w > 0 && cmd.h > 0) {
                ctx.textAlign = (cmd.align || 'left') as CanvasTextAlign;
                const tx = cmd.align === 'center' ? cmd.x + cmd.w / 2 : cmd.x;
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                if (cmd.vAlign === 'middle' && hasBaselineRatio) {
                    ctx.textBaseline = 'alphabetic';
                    const ty = cmd.y + cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize;
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                } else {
                    ctx.textBaseline = cmd.vAlign === 'middle' ? 'middle' : 'top';
                    const ty = cmd.vAlign === 'middle' ? cmd.y + cmd.h / 2 : cmd.y;
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                }
            } else {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                ctx.fillText(cmd.text, cmd.x * TEXT_SCALE, cmd.y * TEXT_SCALE);
            }
            ctx.restore();
            break;
        }
        case 'image': {
            if (!cmd.image) break;
            if (cmd.transform) {
                ctx.save();
                ctx.transform(...cmd.transform);
                ctx.drawImage(cmd.image, 0, 0, cmd.w, cmd.h);
                ctx.restore();
            } else {
                ctx.drawImage(cmd.image, cmd.x, cmd.y, cmd.w, cmd.h);
            }
            break;
        }
    }
}

// --- Recording group node ---

export class RecordingGroupNode implements GroupNode {
    x: number;
    y: number;
    _visible = true;
    readonly commands: DrawCommand[] = [];
    /** Lazily created when this group is materialized for a KonvaLayerNode. */
    _konvaGroup?: Konva.Group;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    setVisible(visible: boolean) {
        this._visible = visible;
        this._konvaGroup?.visible(visible);
    }

    isVisible(): boolean {
        return this._visible;
    }

    destroy() {
        this._konvaGroup?.destroy();
        this._konvaGroup = undefined;
        this.commands.length = 0;
    }

    setPosition(x: number, y: number) {
        this.x = x;
        this.y = y;
        this._konvaGroup?.position({x, y});
    }

    getPosition() {
        return {x: this.x, y: this.y};
    }

    moveToTop() {
        this._konvaGroup?.moveToTop();
    }

    /**
     * Materialize this recording as a Konva.Group + Konva.Shape.
     * Used when the group is added to a KonvaLayerNode (overlay/position layers).
     */
    materialize(): Konva.Group {
        if (this._konvaGroup) return this._konvaGroup;
        const group = new Konva.Group({
            x: this.x, y: this.y,
            listening: false,
            visible: this._visible,
        });
        const cmds = this.commands;
        group.add(new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context as CanvasRenderingContext2D;
                for (const cmd of cmds) {
                    replayCommand(ctx, cmd);
                }
            },
        }));
        this._konvaGroup = group;
        return group;
    }
}

// --- Recording layer node ---

/**
 * A LayerNode backed by a single Konva.Shape whose sceneFunc replays
 * all recorded groups. Much faster than individual Konva nodes.
 */
export class RecordingLayerNode implements LayerNode {
    private groups: RecordingGroupNode[] = [];
    private readonly konvaLayer: Konva.Layer;
    private konvaShape: Konva.Shape;

    constructor(konvaLayer: Konva.Layer) {
        this.konvaLayer = konvaLayer;
        // Remove any previous children (e.g. from a prior RecordingLayerNode or KonvaLayerNode)
        konvaLayer.destroyChildren();
        const self = this;
        this.konvaShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context as CanvasRenderingContext2D;
                // Capture the base transform that Konva applied (stage scale + position).
                // We'll use setTransform per group to match Konva's per-node precision.
                const base = ctx.getTransform();
                const a = base.a, b = base.b, c = base.c, d = base.d;
                for (const group of self.groups) {
                    if (!group._visible) continue;
                    // Compute absolute translation like Konva: tx = a*gx + c*gy + e
                    const tx = a * group.x + c * group.y + base.e;
                    const ty = b * group.x + d * group.y + base.f;
                    ctx.setTransform(a, b, c, d, tx, ty);
                    for (const cmd of group.commands) {
                        replayCommand(ctx, cmd);
                    }
                }
                // Restore the original transform
                ctx.setTransform(base);
            },
        });
        konvaLayer.add(this.konvaShape);
    }

    private ensureShape() {
        // Re-add the shape if it was destroyed externally (e.g. by ScenePipeline calling destroyChildren)
        if (!this.konvaShape.getParent()) {
            this.konvaLayer.add(this.konvaShape);
        }
    }

    addNode(node: GroupNode) {
        if (node instanceof RecordingGroupNode) {
            this.groups.push(node);
            this.ensureShape();
        }
    }

    destroyChildren() {
        this.groups.length = 0;
    }

    batchDraw() {
        this.konvaLayer.batchDraw();
    }
}

// --- Canvas drawing backend ---

function createImageElement(src: string): HTMLImageElement | any {
    const image = typeof Konva !== 'undefined'
        ? Konva.Util.createImageElement()
        : (typeof Image !== 'undefined' ? new Image() : null);
    if (image) image.src = src;
    return image;
}

/**
 * DrawingBackend that records draw commands into RecordingGroupNodes.
 * Commands are replayed via Canvas2D in a single Konva.Shape sceneFunc
 * per layer, eliminating per-node Konva overhead.
 *
 * Drop-in replacement for KonvaBackend. Decorator backends wrap this
 * the same way they wrap KonvaBackend.
 */
export class CanvasBackend implements InteractiveDrawingBackend {
    readonly __backendKind = 'interactive' as const;

    createGroup(x: number, y: number): RecordingGroupNode {
        return new RecordingGroupNode(x, y);
    }

    addRect(parent: GroupNode, config: RectConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'rect',
            x: config.x, y: config.y,
            w: config.width, h: config.height,
            fill: config.fill,
            stroke: config.stroke,
            sw: config.strokeWidth ?? 0,
            cr: config.cornerRadius ?? 0,
            dash: (config.dashEnabled !== false && config.dash) ? config.dash : undefined,
        });
    }

    addCircle(parent: GroupNode, config: CircleConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'circle',
            cx: config.cx, cy: config.cy, r: config.radius,
            fill: config.fill,
            stroke: config.stroke,
            sw: config.strokeWidth ?? 0,
            dash: (config.dashEnabled !== false && config.dash) ? config.dash : undefined,
        });
    }

    addLine(parent: GroupNode, config: LineConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'line',
            points: config.points,
            stroke: config.stroke,
            sw: config.strokeWidth ?? 0,
            dash: config.dash,
            lineCap: config.lineCap,
            lineJoin: config.lineJoin,
            alpha: config.alpha,
        });
    }

    addPolygon(parent: GroupNode, config: PolygonConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'polygon',
            vertices: config.vertices,
            fill: config.fill,
            stroke: config.stroke,
            sw: config.strokeWidth ?? 0,
        });
    }

    addText(parent: GroupNode, config: TextConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'text',
            x: config.x, y: config.y,
            text: config.text,
            fontSize: config.fontSize,
            fontFamily: config.fontFamily ?? 'sans-serif',
            fontStyle: config.fontStyle ?? 'normal',
            fill: config.fill ?? 'black',
            align: config.align ?? 'left',
            vAlign: config.verticalAlign ?? 'top',
            w: config.width ?? 0,
            h: config.height ?? 0,
            baselineRatio: config.baselineRatio,
            transform: config.transform,
        });
    }

    addImage(parent: GroupNode, config: ImageConfig) {
        if (!(parent instanceof RecordingGroupNode)) return;
        parent.commands.push({
            type: 'image',
            x: config.x, y: config.y,
            w: config.width, h: config.height,
            image: createImageElement(config.src),
            transform: config.transform,
        });
    }

    supportsBatchExitRendering(): boolean {
        return true;
    }

    getExitDepthOffset(): { x: number; y: number } {
        return {x: 0, y: 0};
    }

    getTransform(): CoordFn {
        return IDENTITY_TRANSFORM;
    }

    getInverseTransform(): CoordFn {
        return IDENTITY_TRANSFORM;
    }
}
