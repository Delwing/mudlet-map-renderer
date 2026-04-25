/**
 * SceneIR — pure data shapes that {@link ScenePipeline} produces.
 *
 * Shapes carry world-space coordinates and engine-agnostic paint information.
 * They are consumed by:
 *   - {@link CullingManager} (visibility queries against a camera viewport)
 *   - {@link HitTester} (point→shape lookup)
 *   - {@link DrawCommandBuilder} (translation to engine {@link DrawCommand}s)
 *
 * Shapes know nothing about Konva, SVG, or Canvas2D.
 */

/** Logical layer for stacking. Mapped to engine-specific layers by renderers. */
export type LayerId =
    | "grid"
    | "link"
    | "room"
    | "position"
    | "overlay"
    | "top";

/** Engine-agnostic paint description. */
export interface Paint {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    dash?: number[];
    dashEnabled?: boolean;
    /** 0..1 multiplier on fill+stroke. */
    alpha?: number;
}

/** Hit-test annotation. Set on shapes that should be pickable. */
export interface HitInfo {
    /** What the shape represents at the model layer. */
    kind: "room" | "exit" | "specialExit" | "stub" | "label" | "areaExit" | string;
    /** Identifier of the owning model entity (room id, exit id, …). */
    id?: number | string;
    /** Free-form payload returned to callers from {@link HitTester}. */
    payload?: unknown;
}

/** Common fields on every shape. */
export interface ShapeBase {
    /** Logical layer; defaults to "room" when omitted. */
    layer?: LayerId;
    /** Set on shapes that participate in hit testing. */
    hit?: HitInfo;
    /**
     * If true, the shape renders at a fixed pixel size regardless of camera
     * zoom. Mirrors the legacy `GroupNode.noScaling` flag.
     */
    noScale?: boolean;
}

export interface RectShape extends ShapeBase {
    type: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    cornerRadius?: number;
    paint: Paint;
}

export interface CircleShape extends ShapeBase {
    type: "circle";
    cx: number;
    cy: number;
    radius: number;
    paint: Paint;
}

export interface LineShape extends ShapeBase {
    type: "line";
    /** Flat list of [x0, y0, x1, y1, …]. */
    points: number[];
    paint: Paint;
    lineCap?: "butt" | "round" | "square";
    lineJoin?: "miter" | "round" | "bevel";
    /**
     * Marks lines that are infrastructure (grid). Styles use this to skip
     * decoration on grid (cheaper rendering) while still recolouring it.
     */
    grid?: boolean;
}

export interface PolygonShape extends ShapeBase {
    type: "polygon";
    /** Flat list of [x0, y0, x1, y1, …]. Closed implicitly. */
    vertices: number[];
    paint: Paint;
}

export interface TextShape extends ShapeBase {
    type: "text";
    x: number;
    y: number;
    text: string;
    fontSize: number;
    fontFamily?: string;
    fontStyle?: string;
    fill?: string;
    align?: "left" | "center" | "right";
    verticalAlign?: "top" | "middle" | "bottom";
    width?: number;
    height?: number;
    /** Fraction of fontSize from top to baseline (SVG positioning). */
    baselineRatio?: number;
    /** Konva offsetY ratio applied to centre text vertically. */
    konvaCorrectionRatio?: number;
    /** Optional 2D affine transform [a, b, c, d, e, f]. */
    transform?: [number, number, number, number, number, number];
}

export interface ImageShape extends ShapeBase {
    type: "image";
    x: number;
    y: number;
    width: number;
    height: number;
    src: string;
    /** Optional 2D affine transform [a, b, c, d, e, f]. */
    transform?: [number, number, number, number, number, number];
}

/**
 * Positional container. Children render relative to {@link x}, {@link y}.
 * Groups can nest; the final world position of a child is the cumulative
 * sum of group origins plus the child's own offset.
 */
export interface GroupShape extends ShapeBase {
    type: "group";
    x: number;
    y: number;
    children: Shape[];
}

export type Shape =
    | RectShape
    | CircleShape
    | LineShape
    | PolygonShape
    | TextShape
    | ImageShape
    | GroupShape;

/** Axis-aligned bounding box in world space. */
export interface Bbox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Full output of one {@link ScenePipeline} build pass. Consumers slice this by
 * layer and feed the relevant subset into culling, hit-testing, and rendering.
 */
export interface SceneIR {
    /** All shapes for the current scene, world-space. */
    shapes: Shape[];
    /** Optional pre-computed bbox for whole-scene framing. */
    bounds?: Bbox;
}
