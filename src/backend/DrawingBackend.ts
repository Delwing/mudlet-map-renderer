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
