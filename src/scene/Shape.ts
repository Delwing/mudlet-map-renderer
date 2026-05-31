/**
 * SceneIR — pure data shapes that {@link ScenePipeline} produces.
 *
 * Shapes carry world-space coordinates and engine-agnostic paint information.
 * They are consumed by:
 *   - {@link CullingManager} (visibility queries against a camera viewport)
 *   - {@link HitTester} (point→shape lookup)
 *   - {@link buildDrawCommands} (translation to engine {@link DrawCommand}s)
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

/** One gradient stop. `offset` is in 0..1; `color` is any CSS colour string. */
export interface GradientStop {
    offset: number;
    color: string;
}

/**
 * Linear gradient between two points in the shape's LOCAL coordinate space
 * (same frame as shape.x/y). Stop colours are sampled along the line
 * (x0,y0) → (x1,y1).
 */
export interface LinearGradient {
    type: "linear";
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    stops: GradientStop[];
}

/**
 * Radial gradient in the shape's LOCAL coordinate space. The end circle is
 * (cx, cy, r); the optional start circle is (fx, fy, fr) — defaults to a
 * zero-radius circle at (cx, cy) when omitted.
 */
export interface RadialGradient {
    type: "radial";
    cx: number;
    cy: number;
    r: number;
    fx?: number;
    fy?: number;
    fr?: number;
    stops: GradientStop[];
}

/** A fill is either a flat colour string or a gradient. */
export type FillStyle = string | LinearGradient | RadialGradient;

/** Engine-agnostic paint description. */
export interface Paint {
    /**
     * Colour string (`#rrggbb`, `rgb(...)`, named colour) or a gradient.
     * Gradient coords are in the same local frame as the shape's geometry.
     */
    fill?: FillStyle;
    stroke?: string;
    strokeWidth?: number;
    dash?: number[];
    dashEnabled?: boolean;
    /** 0..1 multiplier on fill+stroke. */
    alpha?: number;
}

/** True when `fill` is a gradient object rather than a colour string. */
export function isGradientFill(fill: FillStyle | undefined): fill is LinearGradient | RadialGradient {
    return typeof fill === "object" && fill !== null;
}

/**
 * Resolve a paint's effective dash pattern. Returns the dash only when it is
 * present AND not explicitly disabled (`dashEnabled === false` blanks it).
 * Renderers call this so every shape kind — rect, circle, line — honours
 * `dashEnabled` identically.
 */
export function resolveDash(
    dash: number[] | undefined,
    dashEnabled: boolean | undefined,
): number[] | undefined {
    return (dashEnabled !== false && dash) ? dash : undefined;
}

/**
 * Apply a camera-style affine (translate by world origin, scale uniformly,
 * translate by render offset) to a fill. Strings pass through unchanged.
 * Gradient stops are colour-only and never transformed.
 */
export function transformFill(
    fill: FillStyle | undefined,
    worldX: number,
    worldY: number,
    scale: number,
    offsetX: number,
    offsetY: number,
): FillStyle | undefined {
    if (!isGradientFill(fill)) return fill;
    if (fill.type === "linear") {
        return {
            type: "linear",
            x0: (worldX + fill.x0) * scale + offsetX,
            y0: (worldY + fill.y0) * scale + offsetY,
            x1: (worldX + fill.x1) * scale + offsetX,
            y1: (worldY + fill.y1) * scale + offsetY,
            stops: fill.stops,
        };
    }
    return {
        type: "radial",
        cx: (worldX + fill.cx) * scale + offsetX,
        cy: (worldY + fill.cy) * scale + offsetY,
        r: fill.r * scale,
        fx: fill.fx !== undefined ? (worldX + fill.fx) * scale + offsetX : undefined,
        fy: fill.fy !== undefined ? (worldY + fill.fy) * scale + offsetY : undefined,
        fr: fill.fr !== undefined ? fill.fr * scale : undefined,
        stops: fill.stops,
    };
}

/** Hit-test annotation. Set on shapes that should be pickable. */
export interface HitInfo {
    /** What the shape represents at the model layer. */
    kind: "room" | "exit" | "specialExit" | "stub" | "label" | "areaExit" | string;
    /** Identifier of the owning model entity (room id, exit id, …). */
    id?: number | string;
    /** Free-form payload returned to callers from {@link HitTester}. */
    payload?: unknown;
    /**
     * Multiplier on the current `roomSize` for the maximum pick distance.
     * Smaller = stricter (used for thin geometry like exits and stubs).
     * Defaults to a per-kind value when omitted (rooms 1.0, exits 0.35, stubs 0.3, …).
     */
    margin?: number;
    /**
     * Tiebreaker when multiple hits are within range. Higher = on top.
     * Defaults to a per-kind value when omitted (rooms over exits over stubs, …).
     */
    priority?: number;
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
    stroke?: string;
    strokeWidth?: number;
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
