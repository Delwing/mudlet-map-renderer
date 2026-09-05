/**
 * Konva-side replay infrastructure for {@link Shape}-derived draw commands.
 *
 * A {@link RecordingGroupNode} captures one positional group of low-level
 * draw commands (rect / circle / line / polygon / text / image, optionally
 * wrapped by an affine transform). It stays as plain data until either
 * - `materialize()` makes it into a single `Konva.Group` containing one
 *   `Konva.Shape` whose `sceneFunc` replays the captured commands, or
 * - it is added to a {@link RecordingLayerNode} / {@link DrawCommandLayerNode}
 *   that batches many groups into one shared `Konva.Shape` per layer.
 *
 * The single-`sceneFunc` per layer is the fast path used by the main scene
 * because it lets culling toggle individual entries (`DrawEntry.visible`)
 * without paying Konva's per-node overhead.
 */

import Konva from "konva";
import {BASE_SCALE} from "../camera/Camera";
import type {FillStyle, LayerId} from "../scene/Shape";
import {resolveFill} from "./canvasGradient";

// --- Internal draw command types ---
// These are the low-level Canvas2D-shaped commands captured per
// RecordingGroupNode. They differ from src/draw/DrawCommand.ts (which is
// camera-transformed render-space output for export pipelines): commands
// here stay in group-local coordinates and are replayed under whatever
// transform Konva has already applied to the layer.

type RectCommand = { type: 'rect'; x: number; y: number; w: number; h: number; fill?: FillStyle; stroke?: string; sw: number; cr: number; dash?: number[] };
type CircleCommand = { type: 'circle'; cx: number; cy: number; r: number; fill?: FillStyle; stroke?: string; sw: number; dash?: number[] };
type LineCommand = { type: 'line'; points: number[]; stroke?: string; sw: number; dash?: number[]; lineCap?: string; lineJoin?: string; alpha?: number };
type PolygonCommand = { type: 'polygon'; vertices: number[]; fill?: FillStyle; stroke?: string; sw: number };
type TextCommand = { type: 'text'; x: number; y: number; text: string; fontSize: number; fontFamily: string; fontStyle: string; fill: string; stroke?: string; sw: number; align: string; vAlign: string; w: number; h: number; baselineRatio?: number; transform?: [number, number, number, number, number, number] };
type ImageCommand = { type: 'image'; x: number; y: number; w: number; h: number; image: HTMLImageElement | any; transform?: [number, number, number, number, number, number] };

export type RecordingDrawCommand =
    | RectCommand
    | CircleCommand
    | LineCommand
    | PolygonCommand
    | TextCommand
    | ImageCommand;

// --- Canvas2D replay ---

function replayCommand(ctx: CanvasRenderingContext2D, cmd: RecordingDrawCommand) {
    switch (cmd.type) {
        case 'rect': {
            ctx.beginPath();
            if (cmd.cr > 0 && typeof ctx.roundRect === 'function') {
                ctx.roundRect(cmd.x, cmd.y, cmd.w, cmd.h, cmd.cr);
            } else {
                ctx.rect(cmd.x, cmd.y, cmd.w, cmd.h);
            }
            if (cmd.fill) {
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
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
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
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
                ctx.fillStyle = resolveFill(ctx, cmd.fill);
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
            // Sub-pixel font sizes break Canvas2D text metrics on some
            // engines (notably node-canvas). Render at TEXT_SCALE × the
            // requested size and counter-scale so output stays pixel-correct.
            const TEXT_SCALE = 100;
            const scaledSize = cmd.fontSize * TEXT_SCALE;
            const font = `${cmd.fontStyle} ${scaledSize}px ${cmd.fontFamily}`;
            ctx.save();
            ctx.font = font;
            ctx.fillStyle = cmd.fill;
            if (cmd.stroke && cmd.sw > 0) {
                ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw * TEXT_SCALE;
                ctx.lineJoin = 'round';
            }
            const hasBaselineRatio = cmd.baselineRatio !== undefined;
            if (cmd.transform) {
                ctx.transform(...cmd.transform);
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                ctx.textAlign = 'center';
                if (hasBaselineRatio) {
                    ctx.textBaseline = 'alphabetic';
                    const by = (cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize) * TEXT_SCALE;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, cmd.w * TEXT_SCALE / 2, by);
                    ctx.fillText(cmd.text, cmd.w * TEXT_SCALE / 2, by);
                } else {
                    ctx.textBaseline = 'middle';
                    const mx = cmd.w * TEXT_SCALE / 2;
                    const my = cmd.h * TEXT_SCALE / 2;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, mx, my);
                    ctx.fillText(cmd.text, mx, my);
                }
            } else if (cmd.w > 0 && cmd.h > 0) {
                ctx.textAlign = (cmd.align || 'left') as CanvasTextAlign;
                const tx = cmd.align === 'center' ? cmd.x + cmd.w / 2 : cmd.x;
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                if (cmd.vAlign === 'middle' && hasBaselineRatio) {
                    ctx.textBaseline = 'alphabetic';
                    const ty = cmd.y + cmd.h / 2 + cmd.baselineRatio! * cmd.fontSize;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                } else {
                    ctx.textBaseline = cmd.vAlign === 'middle' ? 'middle' : 'top';
                    const ty = cmd.vAlign === 'middle' ? cmd.y + cmd.h / 2 : cmd.y;
                    if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                    ctx.fillText(cmd.text, tx * TEXT_SCALE, ty * TEXT_SCALE);
                }
            } else {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
                if (cmd.stroke && cmd.sw > 0) ctx.strokeText(cmd.text, cmd.x * TEXT_SCALE, cmd.y * TEXT_SCALE);
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

/**
 * One positional group of recorded draw commands. Used as both the unit a
 * shape walker emits and the cull-tracking handle inside
 * {@link DrawCommandLayerNode}. Lazily materializes into a `Konva.Group` /
 * `Konva.Shape` pair when added directly to a Konva layer.
 */
export class RecordingGroupNode {
    x: number;
    y: number;
    _visible = true;
    noScaling = false;
    /** Scene layer this group belongs to; drives coalesced draw ordering. */
    layer?: LayerId;
    readonly commands: RecordingDrawCommand[] = [];
    /** Lazily created when this group is materialized for a Konva.Layer. */
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
     * Materialize this recording as a Konva.Group + Konva.Shape. Used by
     * {@link MaterializingLayerNode} for layers that want individual nodes
     * (overlay, position) rather than a single bulk replay.
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

// --- Pure-data draw entry ---

/**
 * Lightweight record extracted from a {@link RecordingGroupNode} when added
 * to a {@link DrawCommandLayerNode}. Contains only plain data so culling
 * callbacks can toggle visibility without a Konva node reference.
 */
export type DrawEntry = {
    x: number;
    y: number;
    noScaling: boolean;
    layer?: LayerId;
    readonly commands: RecordingDrawCommand[];
    visible: boolean;
};

// --- DrawCommandLayerNode ---

/**
 * LayerNode backed by a single Konva.Shape whose sceneFunc replays
 * {@link DrawEntry} objects. Used for the main scene layer where individual
 * shapes need cull toggling.
 */
/**
 * Style key for a coalescable entry, or `null` if it must be replayed
 * individually. Batchable iff the entry is a single primitive drawn under the
 * normal camera transform with solid (non-gradient) paint and no dash:
 *   - rect / circle  → the common room body
 *   - line           → the common two-way exit link
 * Multi-command entries (symbols, emboss/multi-ring rooms, one-way arrows with
 * heads, doors, inner-exit triangles), gradient fills, dashed/alpha strokes,
 * and no-scale entries all return `null` and keep the per-entry replay path.
 */
function batchKey(entry: DrawEntry): string | null {
    if (entry.noScaling || entry.commands.length !== 1) return null;
    const cmd = entry.commands[0];
    if (cmd.type === "rect") {
        if (typeof cmd.fill !== "string" && cmd.fill !== undefined) return null;
        if (cmd.dash) return null;
        return `r|${cmd.fill ?? ""}|${cmd.stroke ?? ""}|${cmd.sw}|${cmd.cr}`;
    }
    if (cmd.type === "circle") {
        if (typeof cmd.fill !== "string" && cmd.fill !== undefined) return null;
        if (cmd.dash) return null;
        return `c|${cmd.fill ?? ""}|${cmd.stroke ?? ""}|${cmd.sw}|${cmd.r}`;
    }
    if (cmd.type === "line") {
        if (cmd.dash || cmd.alpha !== undefined) return null;
        return `l|${cmd.stroke ?? ""}|${cmd.sw}|${cmd.lineCap ?? ""}|${cmd.lineJoin ?? ""}`;
    }
    return null;
}

export class DrawCommandLayerNode {
    private readonly entries: DrawEntry[] = [];
    private readonly nodeToEntry = new Map<RecordingGroupNode, DrawEntry>();
    private readonly konvaLayer: Konva.Layer;
    private konvaShape: Konva.Shape;
    /** Reusable bucket map for coalesced draws — cleared per frame, never reallocated. */
    private readonly buckets = new Map<string, DrawEntry[]>();

    constructor(konvaLayer: Konva.Layer, private readonly coalesce: () => boolean = () => false) {
        this.konvaLayer = konvaLayer;
        konvaLayer.destroyChildren();
        const self = this;
        this.konvaShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context as CanvasRenderingContext2D;
                if (self.coalesce()) {
                    self.drawCoalesced(ctx);
                } else {
                    self.drawPerEntry(ctx);
                }
            },
        });
        konvaLayer.add(this.konvaShape);
    }

    /** Original path: one setTransform + replay per visible entry, in order. */
    private drawPerEntry(ctx: CanvasRenderingContext2D): void {
        const base = ctx.getTransform();
        const a = base.a, b = base.b, c = base.c, d = base.d;
        for (const entry of this.entries) {
            if (!entry.visible) continue;
            const tx = a * entry.x + c * entry.y + base.e;
            const ty = b * entry.x + d * entry.y + base.f;
            if (entry.noScaling) {
                ctx.setTransform(BASE_SCALE, 0, 0, BASE_SCALE, tx, ty);
            } else {
                ctx.setTransform(a, b, c, d, tx, ty);
            }
            for (const cmd of entry.commands) {
                replayCommand(ctx, cmd);
            }
        }
        ctx.setTransform(base);
    }

    /**
     * Fast path: same-style primitives are accumulated into one path per style
     * and drawn with a single `fill()`/`stroke()`. Done in two sweeps — link
     * entries (exit lines) first, then room entries — so rooms stay painted on
     * top of exits, matching the per-entry insertion order. Within a sweep,
     * non-batchable entries (one-way arrows, doors, symbols, emboss, inner-exit
     * triangles…) replay per-entry; batched primitives flush afterwards. Exit
     * lines and room bodies don't meaningfully overlap same-layer siblings, so
     * reordering them within a sweep is visually immaterial.
     */
    private drawCoalesced(ctx: CanvasRenderingContext2D): void {
        const base = ctx.getTransform();
        // Sweep 1: everything that isn't a room (exit links) — drawn underneath.
        this.sweep(ctx, base, (entry) => entry.layer !== "room");
        // Sweep 2: rooms — drawn on top.
        this.sweep(ctx, base, (entry) => entry.layer === "room");
        ctx.setTransform(base);
    }

    private sweep(ctx: CanvasRenderingContext2D, base: DOMMatrix, accept: (e: DrawEntry) => boolean): void {
        const a = base.a, b = base.b, c = base.c, d = base.d, e = base.e, f = base.f;
        const buckets = this.buckets;
        buckets.clear();

        for (const entry of this.entries) {
            if (!entry.visible || !accept(entry)) continue;
            const key = batchKey(entry);
            if (key === null) {
                const tx = a * entry.x + c * entry.y + e;
                const ty = b * entry.x + d * entry.y + f;
                if (entry.noScaling) {
                    ctx.setTransform(BASE_SCALE, 0, 0, BASE_SCALE, tx, ty);
                } else {
                    ctx.setTransform(a, b, c, d, tx, ty);
                }
                for (const cmd of entry.commands) replayCommand(ctx, cmd);
            } else {
                let list = buckets.get(key);
                if (!list) buckets.set(key, (list = []));
                list.push(entry);
            }
        }
        if (buckets.size === 0) return;

        // Camera transform applied once; batched primitives are in world coords.
        ctx.setTransform(a, b, c, d, e, f);
        for (const list of buckets.values()) {
            const cmd = list[0].commands[0];
            ctx.beginPath();
            if (cmd.type === "rect") {
                const roundable = cmd.cr > 0 && typeof ctx.roundRect === "function";
                for (const entry of list) {
                    if (roundable) ctx.roundRect(entry.x + cmd.x, entry.y + cmd.y, cmd.w, cmd.h, cmd.cr);
                    else ctx.rect(entry.x + cmd.x, entry.y + cmd.y, cmd.w, cmd.h);
                }
                if (cmd.fill) { ctx.fillStyle = cmd.fill as string; ctx.fill(); }
                if (cmd.stroke && cmd.sw > 0) {
                    ctx.strokeStyle = cmd.stroke; ctx.lineWidth = cmd.sw;
                    ctx.setLineDash([]); ctx.stroke();
                }
            } else if (cmd.type === "circle") {
                for (const entry of list) {
                    const cx = entry.x + cmd.cx, cy = entry.y + cmd.cy;
                    ctx.moveTo(cx + cmd.r, cy);
                    ctx.arc(cx, cy, cmd.r, 0, Math.PI * 2);
                }
                if (cmd.fill) { ctx.fillStyle = cmd.fill as string; ctx.fill(); }
                if (cmd.stroke && cmd.sw > 0) {
                    ctx.strokeStyle = cmd.stroke; ctx.lineWidth = cmd.sw;
                    ctx.setLineDash([]); ctx.stroke();
                }
            } else if (cmd.type === "line") {
                for (const entry of list) {
                    const pts = entry.commands[0] as typeof cmd;
                    const p = pts.points;
                    if (p.length < 4) continue;
                    ctx.moveTo(p[0] + entry.x, p[1] + entry.y);
                    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] + entry.x, p[i + 1] + entry.y);
                }
                if (cmd.stroke) ctx.strokeStyle = cmd.stroke;
                ctx.lineWidth = cmd.sw;
                ctx.setLineDash([]);
                if (cmd.lineCap) ctx.lineCap = cmd.lineCap as CanvasLineCap;
                if (cmd.lineJoin) ctx.lineJoin = cmd.lineJoin as CanvasLineJoin;
                ctx.stroke();
            }
        }
    }

    addNode(node: RecordingGroupNode): void {
        const entry: DrawEntry = {
            x: node.x,
            y: node.y,
            noScaling: node.noScaling,
            layer: node.layer,
            commands: node.commands,
            visible: node._visible,
        };
        this.entries.push(entry);
        this.nodeToEntry.set(node, entry);
        this.ensureShape();
    }

    /** Return the DrawEntry created when `node` was added, or undefined if not found. */
    getEntry(node: RecordingGroupNode): DrawEntry | undefined {
        return this.nodeToEntry.get(node);
    }

    destroyChildren(): void {
        this.entries.length = 0;
        this.nodeToEntry.clear();
    }

    batchDraw(): void {
        this.konvaLayer.batchDraw();
    }

    private ensureShape(): void {
        if (!this.konvaShape.getParent()) {
            this.konvaLayer.add(this.konvaShape);
        }
    }
}

// --- RecordingLayerNode ---

/**
 * Layer backed by a single Konva.Shape whose sceneFunc replays every added
 * {@link RecordingGroupNode} in order. Used for layers that don't need
 * per-shape cull toggling (grid, top-label).
 *
 * Accepts any `Konva.Container`, not just a `Konva.Layer`, so several of these
 * can share one physical layer as sibling `Konva.Group`s — the constructor's
 * `destroyChildren()` then scopes to the group instead of wiping the layer.
 */
export class RecordingLayerNode {
    private groups: RecordingGroupNode[] = [];
    private readonly container: Konva.Container;
    private konvaShape: Konva.Shape;

    constructor(container: Konva.Container) {
        this.container = container;
        container.destroyChildren();
        const self = this;
        this.konvaShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context as CanvasRenderingContext2D;
                const base = ctx.getTransform();
                const a = base.a, b = base.b, c = base.c, d = base.d;
                for (const group of self.groups) {
                    if (!group._visible) continue;
                    const tx = a * group.x + c * group.y + base.e;
                    const ty = b * group.x + d * group.y + base.f;
                    if (group.noScaling) {
                        ctx.setTransform(BASE_SCALE, 0, 0, BASE_SCALE, tx, ty);
                    } else {
                        ctx.setTransform(a, b, c, d, tx, ty);
                    }
                    for (const cmd of group.commands) {
                        replayCommand(ctx, cmd);
                    }
                }
                ctx.setTransform(base);
            },
        });
        container.add(this.konvaShape);
    }

    addNode(node: RecordingGroupNode) {
        this.groups.push(node);
        this.ensureShape();
    }

    destroyChildren() {
        this.groups.length = 0;
    }

    batchDraw() {
        // getLayer() returns the layer itself when the container IS a layer,
        // and walks up to the owning layer when it is a group.
        this.container.getLayer()?.batchDraw();
    }

    private ensureShape() {
        if (!this.konvaShape.getParent()) {
            this.container.add(this.konvaShape);
        }
    }
}

// --- MaterializingLayerNode ---

/**
 * Layer that materializes each added {@link RecordingGroupNode} as its own
 * `Konva.Group`. Used for layers where the renderer keeps a reference to
 * each node (overlay highlights, position marker) so it can destroy them
 * individually.
 */
export class MaterializingLayerNode {
    constructor(private readonly konvaLayer: Konva.Layer) {}

    addNode(node: RecordingGroupNode) {
        this.konvaLayer.add(node.materialize());
    }

    destroyChildren() {
        this.konvaLayer.destroyChildren();
    }

    batchDraw() {
        this.konvaLayer.batchDraw();
    }
}
