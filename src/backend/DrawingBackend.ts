/**
 * Low-level drawing primitives. A {@link DrawingBackend} is a thin abstraction
 * over per-node draw calls. Leaf implementations target a specific rendering
 * engine (Konva, raw Canvas2D, SVG strings, …); decorator implementations
 * ({@link BaseStyle}) wrap another backend and transform the calls.
 *
 * End users should rarely touch this directly — prefer {@link Style} factories
 * (Parchment, Sketchy(…), …) with {@link MapRenderer.setStyle}, and
 * {@link Exporter} implementations with {@link MapRenderer.export}.
 */

export interface GroupNode {
    setVisible(visible: boolean): void;
    isVisible(): boolean;
    destroy(): void;
    setPosition(x: number, y: number): void;
    getPosition(): { x: number; y: number };
    moveToTop(): void;
    /** When true, this group renders at a fixed pixel size regardless of zoom level. */
    noScaling?: boolean;
}

export interface LayerNode {
    addNode(node: GroupNode): void;
    destroyChildren(): void;
    batchDraw(): void;
}

export interface RectConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    cornerRadius?: number;
    dash?: number[];
    dashEnabled?: boolean;
}

export interface CircleConfig {
    cx: number;
    cy: number;
    radius: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    dash?: number[];
    dashEnabled?: boolean;
}

export interface LineConfig {
    points: number[];
    stroke?: string;
    strokeWidth?: number;
    dash?: number[];
    lineCap?: string;
    lineJoin?: string;
    alpha?: number;
}

export interface PolygonConfig {
    vertices: number[];
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
}

export interface TextConfig {
    x: number;
    y: number;
    text: string;
    fontSize: number;
    fontFamily?: string;
    fontStyle?: string;
    fill?: string;
    align?: string;
    verticalAlign?: string;
    width?: number;
    height?: number;
    offsetY?: number;
    /** Baseline offset ratio (0-1) for SVG positioning. Fraction of fontSize from top to baseline. */
    baselineRatio?: number;
    /** Konva vertical correction: offsetY = ratio * fontSize shifts text up to true visual centre. */
    konvaCorrectionRatio?: number;
    /** Optional 2D affine transform [a, b, c, d, e, f] applied to the text.
     *  When set, the text is drawn at the origin and the matrix positions/skews it. */
    transform?: [number, number, number, number, number, number];
}

export interface ImageConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    src: string;
    /** Optional 2D affine transform [a, b, c, d, e, f] applied to the image.
     *  When set, x/y/width/height describe the source rect; the matrix positions the output. */
    transform?: [number, number, number, number, number, number];
}

/** Forward/inverse 2D coordinate transform, used by backends that warp map space (e.g. isometric). */
export type CoordFn = (x: number, y: number) => { x: number; y: number };

export const IDENTITY_TRANSFORM: CoordFn = (x, y) => ({x, y});

export interface DrawingBackend {
    createGroup(x: number, y: number): GroupNode;
    addRect(parent: GroupNode, config: RectConfig): void;
    addCircle(parent: GroupNode, config: CircleConfig): void;
    addLine(parent: GroupNode, config: LineConfig): void;
    /**
     * Draw an infrastructure line (grid). Base backends render this identically
     * to {@link addLine}. Style decorators only override it when their effect
     * is meaningful for grid (e.g. IsometricStyle projects coordinates). Purely
     * decorative decorators (SketchyStyle, ParchmentStyle) do not override and
     * fall through to {@link BaseStyle}'s passthrough default, keeping grid
     * rendering cheap.
     */
    addGridLine(parent: GroupNode, config: LineConfig): void;
    addPolygon(parent: GroupNode, config: PolygonConfig): void;
    addText(parent: GroupNode, config: TextConfig): void;
    addImage(parent: GroupNode, config: ImageConfig): void;
    /**
     * Signal the backend to flush pending draw commands to the screen.
     * Interactive (Konva) backends call `batchDraw()`; export backends (SVG, Canvas)
     * treat this as a no-op.
     */
    requestRedraw(): void;
    /**
     * Whether this backend supports batch exit rendering via a single Canvas2D shape.
     * When true, link exits are collected as ExitDrawData and drawn in one batched
     * Konva.Shape sceneFunc instead of creating individual nodes per exit.
     */
    supportsBatchExitRendering?(): boolean;
    /**
     * Cartesian offset for exit line groups so they connect at the cube base
     * instead of the top face. Returns {x:0, y:0} for flat backends.
     */
    getExitDepthOffset(): { x: number; y: number };
    /**
     * Map-space → render-space transform. Identity for flat backends; non-identity
     * for styles that warp coordinates (e.g. `IsometricStyle`).
     * Decorators delegate to their inner backend.
     */
    getTransform(): CoordFn;
    /** Inverse of {@link getTransform}. */
    getInverseTransform(): CoordFn;
}

/**
 * Abstract base for style (decorator) backends. Forwards every
 * {@link DrawingBackend} method to `this.inner` by default; subclasses override
 * only the methods they transform. Generic over the wrapped inner type so
 * tooling preserves specific types through chains where useful.
 */
export abstract class BaseStyle<Inner extends DrawingBackend = DrawingBackend>
    implements DrawingBackend {

    protected readonly inner: Inner;

    constructor(inner: Inner) {
        this.inner = inner;
    }

    createGroup(x: number, y: number): GroupNode {
        return this.inner.createGroup(x, y);
    }

    addRect(parent: GroupNode, config: RectConfig): void {
        this.inner.addRect(parent, config);
    }

    addCircle(parent: GroupNode, config: CircleConfig): void {
        this.inner.addCircle(parent, config);
    }

    addLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addLine(parent, config);
    }

    addGridLine(parent: GroupNode, config: LineConfig): void {
        this.inner.addGridLine(parent, config);
    }

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, config);
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, config);
    }

    addImage(parent: GroupNode, config: ImageConfig): void {
        this.inner.addImage(parent, config);
    }

    requestRedraw(): void {
        this.inner.requestRedraw();
    }

    supportsBatchExitRendering(): boolean {
        return this.inner.supportsBatchExitRendering?.() ?? false;
    }

    getExitDepthOffset(): { x: number; y: number } {
        return this.inner.getExitDepthOffset();
    }

    getTransform(): CoordFn {
        return this.inner.getTransform();
    }

    getInverseTransform(): CoordFn {
        return this.inner.getInverseTransform();
    }
}

/**
 * A {@link Style} is a target-agnostic transformer: given a {@link DrawingBackend}
 * it returns a decorated one. The same style drives interactive canvas, SVG
 * export, and any future target.
 *
 * Compose via {@link compose}; built-in styles live in `src/style`.
 */
export type Style = (target: DrawingBackend) => DrawingBackend;

/** Identity style — passes the target through unchanged. Useful as a default. */
export const identityStyle: Style = (t) => t;

/**
 * Compose a chain of {@link Style}s into a single Style.
 *
 * `compose(Parchment, Sketchy)` wraps with Parchment first, then Sketchy —
 * Sketchy is the outermost decorator, i.e. its methods run first during rendering.
 */
export function compose(...styles: Style[]): Style {
    if (styles.length === 0) return identityStyle;
    if (styles.length === 1) return styles[0];
    return (target) => {
        let acc: DrawingBackend = target;
        for (const style of styles) acc = style(acc);
        return acc;
    };
}
