import {describe, expect, it} from "vitest";
import {buildDrawCommands} from "../src/draw/DrawCommandBuilder";
import type {
    GroupShape,
    LineShape,
    RectShape,
    TextShape,
    ImageShape,
} from "../src/scene/Shape";
import type {
    LineCommand,
    PolygonCommand,
    PushTransformCommand,
    RectCommand,
    TextCommand,
} from "../src/draw/DrawCommand";

const camera = {scale: 10, offsetX: 100, offsetY: 50};

function flatten(batches: ReturnType<typeof buildDrawCommands>) {
    return batches.flatMap(b => b.commands);
}

describe("DrawCommandBuilder — primitive transform math", () => {
    it("translates rect coordinates and scales width / height / strokeWidth / corner radius", () => {
        const rect: RectShape = {
            type: "rect",
            x: 2, y: 3, width: 4, height: 5,
            cornerRadius: 0.5,
            paint: {fill: "red", stroke: "blue", strokeWidth: 0.1},
        };
        const cmd = flatten(buildDrawCommands([rect], camera))[0] as RectCommand;
        expect(cmd.type).toBe("rect");
        // x = (worldX + shape.x) * scale + offsetX = (0 + 2) * 10 + 100 = 120
        expect(cmd.x).toBe(120);
        expect(cmd.y).toBe(80);
        expect(cmd.w).toBe(40);
        expect(cmd.h).toBe(50);
        expect(cmd.sw).toBeCloseTo(1);
        expect(cmd.cr).toBe(5);
        expect(cmd.fill).toBe("red");
        expect(cmd.stroke).toBe("blue");
    });

    it("scales line points and dash array", () => {
        const line: LineShape = {
            type: "line",
            points: [0, 0, 1, 2],
            paint: {stroke: "green", strokeWidth: 0.2, dash: [0.4, 0.2]},
        };
        const cmd = flatten(buildDrawCommands([line], camera))[0] as LineCommand;
        expect(cmd.type).toBe("line");
        expect(cmd.points).toEqual([100, 50, 110, 70]);
        expect(cmd.sw).toBeCloseTo(2);
        expect(cmd.dash).toEqual([4, 2]);
    });

    it("blanks dash when dashEnabled === false even if dash is set", () => {
        const line: LineShape = {
            type: "line",
            points: [0, 0, 1, 0],
            paint: {stroke: "x", dash: [1, 1], dashEnabled: false},
        };
        const cmd = flatten(buildDrawCommands([line], camera))[0] as LineCommand;
        expect(cmd.dash).toBeUndefined();
    });

    it("fills text command defaults for omitted fields", () => {
        const text: TextShape = {
            type: "text",
            x: 1, y: 2, text: "hi", fontSize: 0.5,
        };
        const cmd = flatten(buildDrawCommands([text], camera))[0] as TextCommand;
        expect(cmd.type).toBe("text");
        expect(cmd.x).toBe(110);
        expect(cmd.y).toBe(70);
        expect(cmd.fontSize).toBe(5);
        expect(cmd.fontFamily).toBe("sans-serif");
        expect(cmd.fontStyle).toBe("normal");
        expect(cmd.fill).toBe("black");
        expect(cmd.align).toBe("left");
        expect(cmd.vAlign).toBe("top");
    });
});

describe("DrawCommandBuilder — group accumulation", () => {
    it("accumulates group origin into child world coords (scale unchanged)", () => {
        const group: GroupShape = {
            type: "group",
            x: 1, y: 1,
            children: [{
                type: "rect",
                x: 2, y: 3, width: 1, height: 1,
                paint: {fill: "x"},
            }],
        };
        const cmd = flatten(buildDrawCommands([group], camera))[0] as RectCommand;
        // (1 + 2) * 10 + 100 = 130; (1 + 3) * 10 + 50 = 90
        expect(cmd.x).toBe(130);
        expect(cmd.y).toBe(90);
    });

    it("nests group offsets through multiple levels", () => {
        const group: GroupShape = {
            type: "group",
            x: 1, y: 1,
            children: [{
                type: "group",
                x: 2, y: 2,
                children: [{
                    type: "rect",
                    x: 0, y: 0, width: 1, height: 1,
                    paint: {fill: "x"},
                }],
            }],
        };
        const cmd = flatten(buildDrawCommands([group], camera))[0] as RectCommand;
        expect(cmd.x).toBe((1 + 2 + 0) * 10 + 100);
        expect(cmd.y).toBe((1 + 2 + 0) * 10 + 50);
    });
});

describe("DrawCommandBuilder — noScale group", () => {
    it("emits pushTransform / popTransform around children and renders them in pixel space", () => {
        const group: GroupShape = {
            type: "group",
            x: 5, y: 6,
            noScale: true,
            children: [{
                type: "rect",
                x: 1, y: 2, width: 3, height: 4,
                paint: {strokeWidth: 1},
            }],
        };
        const cmds = flatten(buildDrawCommands([group], camera));
        expect(cmds).toHaveLength(3);
        const [push, rect, pop] = cmds;

        expect(push.type).toBe("pushTransform");
        const pushCmd = push as PushTransformCommand;
        expect(pushCmd.matrix).toEqual([1, 0, 0, 1, 5 * 10 + 100, 6 * 10 + 50]);

        // Children render at pixel scale: x = 0 + 1 = 1, w = 3, sw = 1.
        const rectCmd = rect as RectCommand;
        expect(rectCmd.type).toBe("rect");
        expect(rectCmd.x).toBe(1);
        expect(rectCmd.y).toBe(2);
        expect(rectCmd.w).toBe(3);
        expect(rectCmd.sw).toBe(1);

        expect(pop.type).toBe("popTransform");
    });

    it("does not propagate noScale to nested groups (non-noScale child still scales)", () => {
        const group: GroupShape = {
            type: "group",
            x: 0, y: 0,
            noScale: true,
            children: [{
                type: "group",
                x: 0, y: 0,
                children: [{
                    type: "rect",
                    x: 1, y: 0, width: 1, height: 1,
                    paint: {strokeWidth: 1},
                }],
            }],
        };
        const cmds = flatten(buildDrawCommands([group], camera));
        // Inside push/pop, the inner group has scale 1, so the rect renders
        // at pixel coordinates without zoom multiplier.
        const rectCmd = cmds.find(c => c.type === "rect") as RectCommand;
        expect(rectCmd.x).toBe(1);
        expect(rectCmd.w).toBe(1);
    });
});

describe("DrawCommandBuilder — layer batching", () => {
    it("buckets commands by their layer (default 'room')", () => {
        const shapes = [
            {type: "rect", x: 0, y: 0, width: 1, height: 1, paint: {}, layer: "grid"} as RectShape,
            {type: "rect", x: 1, y: 1, width: 1, height: 1, paint: {}, layer: "room"} as RectShape,
            {type: "rect", x: 2, y: 2, width: 1, height: 1, paint: {}} as RectShape,
            {type: "rect", x: 3, y: 3, width: 1, height: 1, paint: {}, layer: "overlay"} as RectShape,
        ];
        const batches = buildDrawCommands(shapes, camera);
        const byLayer = new Map(batches.map(b => [b.layer, b.commands.length]));
        expect(byLayer.get("grid")).toBe(1);
        expect(byLayer.get("room")).toBe(2); // explicit + default
        expect(byLayer.get("overlay")).toBe(1);
    });

    it("a group's layer propagates to children that don't specify their own", () => {
        const group: GroupShape = {
            type: "group",
            x: 0, y: 0,
            layer: "link",
            children: [{
                type: "rect",
                x: 0, y: 0, width: 1, height: 1,
                paint: {},
            }],
        };
        const batches = buildDrawCommands([group], camera);
        expect(batches).toHaveLength(1);
        expect(batches[0].layer).toBe("link");
    });
});

describe("DrawCommandBuilder — affine transforms", () => {
    it("scales an existing shape transform and zeros x/y (matrix carries position)", () => {
        // Convention: shapes with a transform set x/y to 0 — the matrix is
        // the source of truth for placement (matches IsometricStyle's output).
        const image: ImageShape = {
            type: "image",
            x: 0, y: 0, width: 2, height: 2,
            src: "x.png",
            transform: [1, 0, 0, 1, 7, 9],
        };
        const cmd = flatten(buildDrawCommands([image], camera))[0] as {
            type: "image";
            x: number;
            y: number;
            transform: [number, number, number, number, number, number];
        };
        expect(cmd.type).toBe("image");
        expect(cmd.x).toBe(0);
        expect(cmd.y).toBe(0);
        // Linear part: a, b, c, d scaled by camera scale.
        expect(cmd.transform[0]).toBe(10);
        expect(cmd.transform[3]).toBe(10);
        // Translate: original tx/ty * scale + camera offset (worldX/Y are 0 here).
        expect(cmd.transform[4]).toBe(7 * 10 + 100);
        expect(cmd.transform[5]).toBe(9 * 10 + 50);
    });

    it("transform composes with cumulative group offset", () => {
        const image: ImageShape = {
            type: "image",
            x: 0, y: 0, width: 1, height: 1,
            src: "x.png",
            transform: [1, 0, 0, 1, 0, 0],
        };
        const group: GroupShape = {
            type: "group",
            x: 3, y: 4,
            children: [image],
        };
        const cmd = flatten(buildDrawCommands([group], camera))[0] as {
            type: "image";
            transform: [number, number, number, number, number, number];
        };
        // Group offset (3, 4) folded into the transform translate.
        expect(cmd.transform[4]).toBe(3 * 10 + 100);
        expect(cmd.transform[5]).toBe(4 * 10 + 50);
    });
});

describe("DrawCommandBuilder — polygon", () => {
    it("scales polygon vertices and stroke", () => {
        const shapes = [{
            type: "polygon",
            vertices: [0, 0, 1, 0, 1, 1],
            paint: {fill: "f", stroke: "s", strokeWidth: 0.05},
        } as const];
        const cmd = flatten(buildDrawCommands(shapes, camera))[0] as PolygonCommand;
        expect(cmd.vertices).toEqual([100, 50, 110, 50, 110, 60]);
        expect(cmd.sw).toBeCloseTo(0.5);
    });
});
