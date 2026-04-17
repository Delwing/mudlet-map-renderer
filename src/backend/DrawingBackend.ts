/**
 * Abstract interface for creating visual nodes.
 * Implement this to swap the rendering engine (Konva, PixiJS, raw Canvas2D, etc.).
 *
 * GroupNode is the opaque handle returned by createGroup(). The culling system
 * and renderer use it for visibility toggling, positioning, and cleanup.
 */

export interface GroupNode {
    setVisible(visible: boolean): void;
    isVisible(): boolean;
    destroy(): void;
    setPosition(x: number, y: number): void;
    getPosition(): { x: number; y: number };
    moveToTop(): void;
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
    addPolygon(parent: GroupNode, config: PolygonConfig): void;
    addText(parent: GroupNode, config: TextConfig): void;
    addImage(parent: GroupNode, config: ImageConfig): void;
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
     * for backends that warp coordinates (e.g. {@link IsometricBackend}).
     * Decorators delegate to their inner backend.
     * MapRenderer auto-applies this to culling and grid rendering when the backend is set.
     */
    getTransform(): CoordFn;
    /** Inverse of {@link getTransform}. */
    getInverseTransform(): CoordFn;
}

/**
 * Phantom brand marking a backend as valid for interactive (on-screen) scene rendering.
 * Produced by {@link CanvasBackend} and by decorators that wrap an interactive backend.
 *
 * {@link MapRenderer.setDrawingBackend} and {@link KonvaRenderBackend} require this brand,
 * so mismatched stacks (e.g. a decorator over {@link KonvaBackend}) fail at compile time
 * instead of silently no-oping at runtime.
 */
export interface InteractiveDrawingBackend extends DrawingBackend {
    readonly __backendKind: 'interactive';
}

/**
 * Phantom brand marking a backend as valid for SVG export.
 * Produced by {@link SvgBackend} and by decorators that wrap an export backend.
 */
export interface ExportDrawingBackend extends DrawingBackend {
    readonly __backendKind: 'export';
}

/**
 * Carries a backend's brand ('interactive' | 'export') through a decorator.
 * When `Inner` is unbranded (raw {@link DrawingBackend}), the decorator is also unbranded
 * — which by design prevents passing such a stack to interactive or export APIs.
 */
export type PreserveBrand<Inner extends DrawingBackend> =
    Inner extends InteractiveDrawingBackend ? 'interactive'
    : Inner extends ExportDrawingBackend ? 'export'
    : undefined;

/**
 * Abstract base for decorator backends. Forwards every DrawingBackend method to
 * `this.inner` by default; subclasses override only the methods they transform.
 *
 * Propagates the wrapped backend's brand via `PreserveBrand<Inner>`, so
 * `new ParchmentBackend(new CanvasBackend())` is typed as `InteractiveDrawingBackend`
 * and `new ParchmentBackend(new SvgBackend())` as `ExportDrawingBackend`.
 * A decorator over an unbranded leaf (e.g. legacy KonvaBackend) stays unbranded,
 * so it cannot be passed to APIs requiring a specific brand.
 */
export abstract class BaseDecoratorBackend<Inner extends DrawingBackend = DrawingBackend>
    implements DrawingBackend {

    protected readonly inner: Inner;
    readonly __backendKind!: PreserveBrand<Inner>;

    constructor(inner: Inner) {
        this.inner = inner;
        // Runtime copy of the brand so consumers can discriminate if needed.
        const kind = (inner as unknown as { __backendKind?: 'interactive' | 'export' }).__backendKind;
        if (kind !== undefined) {
            (this as unknown as { __backendKind: typeof kind }).__backendKind = kind;
        }
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

    addPolygon(parent: GroupNode, config: PolygonConfig): void {
        this.inner.addPolygon(parent, config);
    }

    addText(parent: GroupNode, config: TextConfig): void {
        this.inner.addText(parent, config);
    }

    addImage(parent: GroupNode, config: ImageConfig): void {
        this.inner.addImage(parent, config);
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
