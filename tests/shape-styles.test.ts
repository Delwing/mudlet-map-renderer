import {describe, expect, it} from "vitest";
import {compose} from "../src/style/Style";
import type {RectShape, CircleShape, LineShape, PolygonShape, GroupShape, TextShape} from "../src/scene/Shape";
import {parchmentShapeStyle} from "../src/style/shape/ParchmentStyle";
import {blueprintShapeStyle} from "../src/style/shape/BlueprintStyle";
import {neonShapeStyle} from "../src/style/shape/NeonStyle";
import {sketchyShapeStyle} from "../src/style/shape/SketchyStyle";
import {isometricShapeStyle} from "../src/style/shape/IsometricStyle";

const ctx = {scale: 1, roomSize: 1};

const sampleRect: RectShape = {
    type: "rect",
    x: 0, y: 0, width: 1, height: 1,
    paint: {fill: "rgb(100, 100, 100)", stroke: "rgb(50, 50, 50)", strokeWidth: 0.05},
};

const sampleCircle: CircleShape = {
    type: "circle",
    cx: 1, cy: 1, radius: 0.5,
    paint: {fill: "rgb(80, 80, 80)", stroke: "rgb(20, 20, 20)", strokeWidth: 0.05},
};

const sampleLine: LineShape = {
    type: "line",
    points: [0, 0, 1, 0, 2, 1],
    paint: {stroke: "rgb(200, 200, 200)", strokeWidth: 0.04},
};

const sampleText: TextShape = {
    type: "text",
    x: 0, y: 0, text: "X",
    fontSize: 1,
};

describe("parchmentShapeStyle", () => {
    it("rewrites rect fill via the parchment luminance gradient", () => {
        const out = parchmentShapeStyle.transform(sampleRect, ctx);
        expect(Array.isArray(out)).toBe(false);
        const r = out as RectShape;
        // Mid-grey input → mid-luminance parchment, not the original.
        expect(r.paint.fill).not.toBe(sampleRect.paint.fill);
        expect(r.paint.fill).toMatch(/^rgb\(/);
    });

    it("rewrites stroke to dark ink", () => {
        const out = parchmentShapeStyle.transform(sampleRect, ctx) as RectShape;
        expect(out.paint.stroke).toBe("#4a3728");
    });

    it("preserves shape positional data", () => {
        const out = parchmentShapeStyle.transform(sampleRect, ctx) as RectShape;
        expect(out.x).toBe(sampleRect.x);
        expect(out.width).toBe(sampleRect.width);
    });

    it("rewrites text fill to ink_text", () => {
        const out = parchmentShapeStyle.transform(sampleText, ctx) as TextShape;
        expect(out.fill).toBe("#3b2a1a");
    });

    it("passes images and groups through", () => {
        const grp: GroupShape = {type: "group", x: 0, y: 0, children: []};
        expect(parchmentShapeStyle.transform(grp, ctx)).toBe(grp);
    });
});

describe("blueprintShapeStyle", () => {
    it("rewrites rect fill via the blueprint blue gradient", () => {
        const out = blueprintShapeStyle.transform(sampleRect, ctx) as RectShape;
        expect(out.paint.fill).toMatch(/^rgb\(/);
        expect(out.paint.stroke).toBe("#c0deff");
    });

    it("rewrites text fill to TEXT_COLOR", () => {
        const out = blueprintShapeStyle.transform(sampleText, ctx) as TextShape;
        expect(out.fill).toBe("#e0f0ff");
    });
});

describe("neonShapeStyle", () => {
    it("emits glow + main pass for a stroked rect", () => {
        const out = neonShapeStyle.transform(sampleRect, ctx);
        expect(Array.isArray(out)).toBe(true);
        const arr = out as RectShape[];
        expect(arr).toHaveLength(2);
        const [glow, main] = arr;
        expect(glow.paint.fill).toBeUndefined();
        // Glow stroke is wider than main.
        expect((glow.paint.strokeWidth ?? 0)).toBeGreaterThan(main.paint.strokeWidth ?? 0);
    });

    it("emits a single shape when a rect has no stroke", () => {
        const noStroke: RectShape = {...sampleRect, paint: {fill: sampleRect.paint.fill}};
        const out = neonShapeStyle.transform(noStroke, ctx);
        expect(Array.isArray(out)).toBe(false);
    });

    it("repaints polygons without a glow pass", () => {
        const poly: PolygonShape = {type: "polygon", vertices: [0, 0, 1, 0, 0, 1], paint: {fill: "rgb(120, 120, 120)", stroke: "rgb(50, 50, 50)"}};
        const out = neonShapeStyle.transform(poly, ctx);
        expect(Array.isArray(out)).toBe(false);
    });
});

describe("sketchyShapeStyle", () => {
    const sketchy = sketchyShapeStyle({jitter: 0.05, color: "#444444"});

    it("converts rectangles to wobbly polygons", () => {
        const out = sketchy.transform(sampleRect, ctx);
        const shape = (Array.isArray(out) ? out[0] : out) as PolygonShape;
        expect(shape.type).toBe("polygon");
        // Wobble subdivides each of 4 edges into >= 2 segments → at least 8 vertices.
        expect(shape.vertices.length / 2).toBeGreaterThan(8);
    });

    it("wobble is deterministic across runs (same seed for same inputs)", () => {
        const a = sketchy.transform(sampleRect, ctx) as PolygonShape;
        const b = sketchy.transform(sampleRect, ctx) as PolygonShape;
        expect(b.vertices).toEqual(a.vertices);
    });

    it("wobble differs for different inputs", () => {
        const a = sketchy.transform(sampleRect, ctx) as PolygonShape;
        const other: RectShape = {...sampleRect, x: 5, y: 5};
        const b = sketchy.transform(other, ctx) as PolygonShape;
        expect(b.vertices).not.toEqual(a.vertices);
    });

    it("wobbles polylines", () => {
        const out = sketchy.transform(sampleLine, ctx) as LineShape;
        expect(out.type).toBe("line");
        // Original 3 points → wobble subdivides each segment.
        expect(out.points.length).toBeGreaterThan(sampleLine.points.length);
    });
});

describe("isometricShapeStyle", () => {
    it("converts rect to diamond polygon", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0});
        const out = iso.transform(sampleRect, ctx) as PolygonShape;
        expect(out.type).toBe("polygon");
        expect(out.vertices).toHaveLength(8); // 4 corners
    });

    it("emits cube faces + outline lines when depth > 0", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0.18});
        const out = iso.transform(sampleRect, ctx);
        expect(Array.isArray(out)).toBe(true);
        const arr = out as ReturnType<typeof iso.transform> & unknown[];
        // Right face polygon, left face polygon, top diamond polygon, plus 6 outline lines.
        const polys = (arr as Array<{type: string}>).filter(s => s.type === "polygon");
        const lines = (arr as Array<{type: string}>).filter(s => s.type === "line");
        expect(polys).toHaveLength(3);
        expect(lines).toHaveLength(6);
    });

    it("decomposes dashed rects into 4 line shapes", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0});
        const dashed: RectShape = {...sampleRect, paint: {...sampleRect.paint, dash: [0.1, 0.1]}};
        const out = iso.transform(dashed, ctx) as LineShape[];
        expect(out).toHaveLength(4);
        expect(out.every(s => s.type === "line")).toBe(true);
        expect(out.every(s => s.paint.dash !== undefined)).toBe(true);
    });

    it("provides round-tripping worldToScene / sceneToWorld", () => {
        const iso = isometricShapeStyle({rotation: 30, depth: 0.18});
        const projected = iso.worldToScene!(2, 3);
        const back = iso.sceneToWorld!(projected.x, projected.y);
        expect(back.x).toBeCloseTo(2, 6);
        expect(back.y).toBeCloseTo(3, 6);
    });

    it("returns non-zero exit depth offset when depth > 0", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0.18});
        const off = iso.getExitDepthOffset!();
        expect(off.x === 0 && off.y === 0).toBe(false);
    });

    it("returns zero exit depth offset at depth 0", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0});
        const off = iso.getExitDepthOffset!();
        expect(off).toEqual({x: 0, y: 0});
    });

    it("projects line points via the iso transform", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0});
        const out = iso.transform(sampleLine, ctx) as LineShape;
        // 2:1 squash halves Y at rotation 0; X stays the same.
        expect(out.points[0]).toBeCloseTo(0);
        expect(out.points[1]).toBeCloseTo(0);
        expect(out.points[2]).toBeCloseTo(1);
        expect(out.points[3]).toBeCloseTo(0);
        expect(out.points[4]).toBeCloseTo(2);
        expect(out.points[5]).toBeCloseTo(0.5);
    });

    it("rotation-90 sends north straight up", () => {
        const iso = isometricShapeStyle({rotation: 90, depth: 0});
        const projected = iso.worldToScene!(0, 1);
        // After 90 rotation: x' = -1, y' = 0
        expect(projected.x).toBeCloseTo(-1, 6);
        expect(projected.y).toBeCloseTo(0, 6);
    });
});

describe("compose", () => {
    it("flows shapes left → right", () => {
        const both = compose(parchmentShapeStyle, neonShapeStyle);
        const out = both.transform(sampleRect, ctx);
        // Parchment paints first, then Neon wraps in glow + main → array.
        expect(Array.isArray(out)).toBe(true);
    });

    it("composes worldToScene through the full chain", () => {
        const iso = isometricShapeStyle({rotation: 30, depth: 0});
        const chain = compose(parchmentShapeStyle, iso);
        const projected = chain.worldToScene!(1, 1);
        const direct = iso.worldToScene!(1, 1);
        expect(projected.x).toBeCloseTo(direct.x);
        expect(projected.y).toBeCloseTo(direct.y);
    });

    it("composes getExitDepthOffset", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0.18});
        const chain = compose(parchmentShapeStyle, iso);
        const off = chain.getExitDepthOffset!();
        const direct = iso.getExitDepthOffset!();
        expect(off).toEqual(direct);
    });
});

it("circle.transform emits non-zero shape output", () => {
    const out = isometricShapeStyle({rotation: 0, depth: 0}).transform(sampleCircle, ctx);
    const shape = Array.isArray(out) ? out[0] : out;
    expect(shape.type).toBe("polygon");
});
