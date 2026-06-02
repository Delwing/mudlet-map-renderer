import {describe, expect, it} from "vitest";
import {compose} from "../src/style/Style";
import type {RectShape, CircleShape, LineShape, PolygonShape, GroupShape, TextShape} from "../src/scene/Shape";
import {parchmentShapeStyle} from "../src/style/shape/ParchmentStyle";
import {blueprintShapeStyle} from "../src/style/shape/BlueprintStyle";
import {neonShapeStyle} from "../src/style/shape/NeonStyle";
import {sketchyShapeStyle} from "../src/style/shape/SketchyStyle";
import {isometricShapeStyle} from "../src/style/shape/IsometricStyle";
import {stainedGlassShapeStyle} from "../src/style/shape/StainedGlassStyle";
import {graphPaperShapeStyle} from "../src/style/shape/GraphPaperStyle";
import {topographicShapeStyle} from "../src/style/shape/TopographicStyle";
import {watercolorShapeStyle} from "../src/style/shape/WatercolorStyle";
import {parseRgb, rgbToHsl} from "../src/style/shape/paintMap";

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

    it("shifts layer:link groups down by depth so connectors meet the cube base", () => {
        const depth = 0.18;
        const iso = isometricShapeStyle({rotation: 0, depth});
        const linkGroup: GroupShape = {type: "group", x: 0, y: 0, layer: "link", children: []};
        const out = iso.transform(linkGroup, ctx) as GroupShape;
        expect(out.x).toBe(0);
        expect(out.y).toBeCloseTo(depth);
    });

    it("does not shift link groups when depth is zero", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0});
        const linkGroup: GroupShape = {type: "group", x: 0, y: 0, layer: "link", children: []};
        const out = iso.transform(linkGroup, ctx) as GroupShape;
        expect(out.y).toBe(0);
    });

    it("does not shift non-link groups", () => {
        const iso = isometricShapeStyle({rotation: 0, depth: 0.18});
        const roomGroup: GroupShape = {type: "group", x: 0, y: 0, layer: "room", children: []};
        const out = iso.transform(roomGroup, ctx) as GroupShape;
        expect(out.y).toBe(0);
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

});

it("circle.transform emits non-zero shape output", () => {
    const out = isometricShapeStyle({rotation: 0, depth: 0}).transform(sampleCircle, ctx);
    const shape = Array.isArray(out) ? out[0] : out;
    expect(shape.type).toBe("polygon");
});

describe("stainedGlassShapeStyle", () => {
    const colouredRect: RectShape = {
        type: "rect", x: 0, y: 0, width: 1, height: 1,
        paint: {fill: "rgb(120, 60, 40)", stroke: "rgb(50, 50, 50)", strokeWidth: 0.05},
    };

    it("saturates a dull fill into a jewel-toned pane", () => {
        const out = stainedGlassShapeStyle.transform(colouredRect, ctx) as RectShape;
        const before = rgbToHsl(120, 60, 40)[1];
        const c = parseRgb(out.paint.fill as string)!;
        const after = rgbToHsl(c.r, c.g, c.b)[1];
        expect(after).toBeGreaterThan(before);
        // Pushed toward the MIN_SATURATION floor (small slack for rgb rounding).
        expect(after).toBeGreaterThan(0.55);
    });

    it("replaces the stroke with fat near-black leading", () => {
        const out = stainedGlassShapeStyle.transform(colouredRect, ctx) as RectShape;
        expect(out.paint.stroke).toBe("#0a0a0a");
        expect(out.paint.strokeWidth ?? 0).toBeGreaterThan(colouredRect.paint.strokeWidth ?? 0);
    });

    it("leads filled panes even when the source had no stroke", () => {
        const noStroke: RectShape = {...colouredRect, paint: {fill: "rgb(120, 60, 40)"}};
        const out = stainedGlassShapeStyle.transform(noStroke, ctx) as RectShape;
        expect(out.paint.stroke).toBe("#0a0a0a");
    });

    it("keeps achromatic rooms neutral (frosted, not forced-colour)", () => {
        const out = stainedGlassShapeStyle.transform(sampleRect, ctx) as RectShape;
        const c = parseRgb(out.paint.fill as string)!;
        expect(rgbToHsl(c.r, c.g, c.b)[1]).toBeLessThan(0.1);
    });
});

describe("graphPaperShapeStyle", () => {
    it("maps fills into a pale light range", () => {
        const out = graphPaperShapeStyle.transform(sampleRect, ctx) as RectShape;
        const c = parseRgb(out.paint.fill as string)!;
        // All channels stay light so navy ink + grid read through.
        expect(Math.min(c.r, c.g, c.b)).toBeGreaterThan(180);
    });

    it("inks strokes navy and fattens them", () => {
        const out = graphPaperShapeStyle.transform(sampleRect, ctx) as RectShape;
        expect(out.paint.stroke).toBe("#1c3f6e");
        expect(out.paint.strokeWidth ?? 0).toBeGreaterThan(sampleRect.paint.strokeWidth ?? 0);
    });

    it("leaves grid lines thin", () => {
        const grid: LineShape = {type: "line", points: [0, 0, 1, 0], grid: true, paint: {stroke: "rgb(200,200,200)", strokeWidth: 0.01}};
        const out = graphPaperShapeStyle.transform(grid, ctx) as LineShape;
        expect(out.paint.strokeWidth).toBe(0.01);
        expect(out.paint.stroke).toBe("#1c3f6e");
    });
});

describe("topographicShapeStyle", () => {
    it("emits a base fill plus inset contour rings for a filled rect", () => {
        const out = topographicShapeStyle.transform(sampleRect, ctx);
        expect(Array.isArray(out)).toBe(true);
        const arr = out as RectShape[];
        expect(arr.length).toBeGreaterThan(1);
        const [base, ...rings] = arr;
        expect(base.paint.fill).toBeDefined();
        // Rings are stroke-only and strictly inside the base.
        for (const r of rings) {
            expect(r.paint.fill).toBeUndefined();
            expect(r.width).toBeLessThan(base.width);
        }
    });

    it("emits just the base shape (no rings) for an unfilled rect", () => {
        const stroked: RectShape = {...sampleRect, paint: {stroke: "rgb(50,50,50)", strokeWidth: 0.04}};
        const out = topographicShapeStyle.transform(stroked, ctx);
        expect(Array.isArray(out)).toBe(false);
    });

    it("emits concentric circles for a filled circle", () => {
        const out = topographicShapeStyle.transform(sampleCircle, ctx) as CircleShape[];
        expect(out.length).toBeGreaterThan(1);
        expect(out[1].radius).toBeLessThan(out[0].radius);
    });
});

describe("watercolorShapeStyle", () => {
    const wc = watercolorShapeStyle({bleed: 0.05, layers: 3, alpha: 0.4});

    it("emits one translucent wobbly wash per layer for a filled rect", () => {
        const out = wc.transform(sampleRect, ctx);
        expect(Array.isArray(out)).toBe(true);
        const arr = out as PolygonShape[];
        expect(arr).toHaveLength(3);
        expect(arr.every(s => s.type === "polygon")).toBe(true);
        // Fill alpha is reduced into an rgba string.
        expect(arr[0].paint.fill).toMatch(/^rgba\(/);
    });

    it("carries hit info on only the first wash", () => {
        const hitRect: RectShape = {...sampleRect, hit: {kind: "room", id: 7}};
        const arr = wc.transform(hitRect, ctx) as PolygonShape[];
        expect(arr[0].hit).toBeDefined();
        expect(arr.slice(1).every(s => s.hit === undefined)).toBe(true);
    });

    it("is deterministic across runs", () => {
        const a = wc.transform(sampleRect, ctx) as PolygonShape[];
        const b = wc.transform(sampleRect, ctx) as PolygonShape[];
        expect(b.map(s => s.vertices)).toEqual(a.map(s => s.vertices));
    });

    it("falls back to a single faint outline for an unfilled stroked rect", () => {
        const stroked: RectShape = {...sampleRect, paint: {stroke: "rgb(50,50,50)", strokeWidth: 0.04}};
        const out = wc.transform(stroked, ctx);
        expect(Array.isArray(out)).toBe(false);
        expect((out as PolygonShape).paint.alpha).toBe(0.5);
    });
});
