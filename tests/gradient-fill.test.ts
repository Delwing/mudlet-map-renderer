import {describe, expect, it} from "vitest";
import {buildDrawCommands} from "../src/draw/DrawCommandBuilder";
import {svgFromBatches} from "../src/render/SvgRenderer";
import {
    transformFill,
    isGradientFill,
    type CircleShape,
    type LinearGradient,
    type PolygonShape,
    type RadialGradient,
    type RectShape,
} from "../src/scene/Shape";
import type {CircleCommand, PolygonCommand, RectCommand} from "../src/draw/DrawCommand";
import {mapFill} from "../src/style/shape/paintMap";
import {parchmentShapeStyle} from "../src/style/shape/ParchmentStyle";
import {blueprintShapeStyle} from "../src/style/shape/BlueprintStyle";

const linear: LinearGradient = {
    type: "linear",
    x0: 0, y0: 0, x1: 1, y1: 0,
    stops: [
        {offset: 0, color: "rgb(255, 0, 0)"},
        {offset: 1, color: "rgb(0, 0, 255)"},
    ],
};

const radial: RadialGradient = {
    type: "radial",
    cx: 0.5, cy: 0.5, r: 0.5,
    stops: [
        {offset: 0, color: "#ffffff"},
        {offset: 1, color: "#000000"},
    ],
};

describe("isGradientFill", () => {
    it("returns false for strings and undefined", () => {
        expect(isGradientFill("red")).toBe(false);
        expect(isGradientFill(undefined)).toBe(false);
    });
    it("returns true for gradient objects", () => {
        expect(isGradientFill(linear)).toBe(true);
        expect(isGradientFill(radial)).toBe(true);
    });
});

describe("transformFill", () => {
    it("passes strings and undefined through unchanged", () => {
        expect(transformFill("red", 5, 5, 10, 2, 3)).toBe("red");
        expect(transformFill(undefined, 5, 5, 10, 2, 3)).toBe(undefined);
    });

    it("scales linear gradient endpoints with camera transform", () => {
        const out = transformFill(linear, 2, 3, 10, 100, 50) as LinearGradient;
        // x0=0 + worldX=2 → 2 * 10 + 100 = 120
        expect(out.x0).toBe(120);
        expect(out.y0).toBe(80);
        // x1=1 + worldX=2 → 3 * 10 + 100 = 130
        expect(out.x1).toBe(130);
        expect(out.y1).toBe(80);
        expect(out.stops).toEqual(linear.stops);
    });

    it("scales radial gradient center and radius", () => {
        const out = transformFill(radial, 1, 1, 10, 0, 0) as RadialGradient;
        // cx=0.5 + 1 → 1.5 * 10 = 15
        expect(out.cx).toBe(15);
        expect(out.cy).toBe(15);
        expect(out.r).toBe(5);
    });

    it("scales optional focal point", () => {
        const focal: RadialGradient = {...radial, fx: 0.2, fy: 0.3, fr: 0.1};
        const out = transformFill(focal, 0, 0, 10, 0, 0) as RadialGradient;
        expect(out.fx).toBe(2);
        expect(out.fy).toBe(3);
        expect(out.fr).toBe(1);
    });

    it("leaves focal point undefined when source omits it", () => {
        const out = transformFill(radial, 0, 0, 10, 0, 0) as RadialGradient;
        expect(out.fx).toBeUndefined();
        expect(out.fy).toBeUndefined();
        expect(out.fr).toBeUndefined();
    });
});

describe("DrawCommandBuilder gradient flow", () => {
    const camera = {scale: 10, offsetX: 100, offsetY: 50};

    it("flows a linear gradient through rect commands, transformed by camera", () => {
        // Gradient coords are in the same world frame as shape.x/y. The
        // gradient here is at world (0,0)→(1,0); shape.x=2 only shifts the
        // rect geometry, not the gradient definition. Camera (scale=10,
        // offset=100,50) maps (0,0)→(100,50) and (1,0)→(110,50).
        const shape: RectShape = {
            type: "rect",
            x: 2, y: 3, width: 4, height: 5,
            paint: {fill: linear, strokeWidth: 0},
        };
        const cmd = buildDrawCommands([shape], camera)[0].commands[0] as RectCommand;
        const fill = cmd.fill as LinearGradient;
        expect(fill.type).toBe("linear");
        expect(fill.x0).toBe(100);
        expect(fill.y0).toBe(50);
        expect(fill.x1).toBe(110);
        expect(fill.y1).toBe(50);
    });

    it("flows a radial gradient through circle commands", () => {
        const shape: CircleShape = {
            type: "circle",
            cx: 0, cy: 0, radius: 1,
            paint: {fill: radial, strokeWidth: 0},
        };
        const cmd = buildDrawCommands([shape], camera)[0].commands[0] as CircleCommand;
        const fill = cmd.fill as RadialGradient;
        expect(fill.type).toBe("radial");
        expect(fill.r).toBe(5);
    });

    it("flows a gradient through polygon commands", () => {
        const shape: PolygonShape = {
            type: "polygon",
            vertices: [0, 0, 1, 0, 0, 1],
            paint: {fill: linear, strokeWidth: 0},
        };
        const cmd = buildDrawCommands([shape], camera)[0].commands[0] as PolygonCommand;
        expect((cmd.fill as LinearGradient).type).toBe("linear");
    });
});

describe("SvgRenderer gradient output", () => {
    it("emits <linearGradient> with stops and references it via url(#id)", () => {
        const shape: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 10, height: 10,
            paint: {fill: linear, strokeWidth: 0},
        };
        const out = svgFromBatches(buildDrawCommands([shape], {scale: 1, offsetX: 0, offsetY: 0})).join("\n");
        expect(out).toMatch(/<linearGradient id="mmr-grad-\d+" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">/);
        expect(out).toContain('<stop offset="0" stop-color="rgb(255, 0, 0)"/>');
        expect(out).toContain('<stop offset="1" stop-color="rgb(0, 0, 255)"/>');
        expect(out).toMatch(/fill="url\(#mmr-grad-\d+\)"/);
    });

    it("emits <radialGradient> with gradient attributes", () => {
        const shape: CircleShape = {
            type: "circle",
            cx: 5, cy: 5, radius: 5,
            paint: {fill: radial, strokeWidth: 0},
        };
        const out = svgFromBatches(buildDrawCommands([shape], {scale: 1, offsetX: 0, offsetY: 0})).join("\n");
        expect(out).toMatch(/<radialGradient id="mmr-grad-\d+" gradientUnits="userSpaceOnUse" cx="0\.5" cy="0\.5" r="0\.5">/);
        expect(out).toMatch(/fill="url\(#mmr-grad-\d+\)"/);
    });

    it("emits unique gradient ids for repeated shapes", () => {
        const shape: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 10, height: 10,
            paint: {fill: linear, strokeWidth: 0},
        };
        const out = svgFromBatches(buildDrawCommands([shape, shape], {scale: 1, offsetX: 0, offsetY: 0})).join("\n");
        const ids = [...out.matchAll(/id="(mmr-grad-\d+)"/g)].map(m => m[1]);
        expect(ids.length).toBe(2);
        expect(new Set(ids).size).toBe(2);
    });

    it("escapes XML in stop colors", () => {
        const evil: LinearGradient = {
            type: "linear",
            x0: 0, y0: 0, x1: 1, y1: 0,
            stops: [{offset: 0, color: 'red"&<>'}, {offset: 1, color: "blue"}],
        };
        const shape: RectShape = {
            type: "rect",
            x: 0, y: 0, width: 1, height: 1,
            paint: {fill: evil, strokeWidth: 0},
        };
        const out = svgFromBatches(buildDrawCommands([shape], {scale: 1, offsetX: 0, offsetY: 0})).join("\n");
        expect(out).toContain('stop-color="red&quot;&amp;&lt;&gt;"');
    });
});

describe("mapFill", () => {
    const upper = (c: string) => c.toUpperCase();

    it("passes strings through the mapper", () => {
        expect(mapFill("red", upper)).toBe("RED");
    });

    it("returns undefined unchanged", () => {
        expect(mapFill(undefined, upper)).toBeUndefined();
    });

    it("recolours every gradient stop, preserving geometry", () => {
        const out = mapFill(linear, upper) as LinearGradient;
        expect(out.type).toBe("linear");
        expect(out.x0).toBe(linear.x0);
        expect(out.x1).toBe(linear.x1);
        expect(out.stops.map(s => s.color)).toEqual([
            "RGB(255, 0, 0)",
            "RGB(0, 0, 255)",
        ]);
    });

    it("recolours radial gradient stops", () => {
        const out = mapFill(radial, upper) as RadialGradient;
        expect(out.type).toBe("radial");
        expect(out.cx).toBe(radial.cx);
        expect(out.stops.map(s => s.color)).toEqual(["#FFFFFF", "#000000"]);
    });
});

describe("style transforms recolour gradient stops", () => {
    const ctx = {scale: 1, roomSize: 1};
    const gradientRect: RectShape = {
        type: "rect",
        x: 0, y: 0, width: 1, height: 1,
        paint: {
            fill: {
                type: "linear",
                x0: 0, y0: 0, x1: 1, y1: 1,
                stops: [
                    {offset: 0, color: "rgb(20, 20, 20)"},
                    {offset: 1, color: "rgb(220, 220, 220)"},
                ],
            },
            strokeWidth: 0,
        },
    };

    it("parchment recolours each stop through the parchment palette", () => {
        const out = parchmentShapeStyle.transform(gradientRect, ctx) as RectShape;
        const fill = out.paint.fill as LinearGradient;
        expect(fill.type).toBe("linear");
        expect(fill.stops).toHaveLength(2);
        // Both stops should land in the parchment brown range, not the input greys.
        for (const s of fill.stops) {
            expect(s.color).toMatch(/^rgb\(/);
            expect(s.color).not.toBe("rgb(20, 20, 20)");
            expect(s.color).not.toBe("rgb(220, 220, 220)");
        }
        // Geometry survives.
        expect(fill.x0).toBe(0);
        expect(fill.x1).toBe(1);
    });

    it("blueprint recolours each stop through the blueprint palette", () => {
        const out = blueprintShapeStyle.transform(gradientRect, ctx) as RectShape;
        const fill = out.paint.fill as LinearGradient;
        expect(fill.stops).toHaveLength(2);
        // Each stop independently mapped — dark stop should be darker than light stop.
        const dark = fill.stops[0].color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)!;
        const light = fill.stops[1].color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)!;
        expect(parseInt(light[3])).toBeGreaterThan(parseInt(dark[3]));
    });
});
