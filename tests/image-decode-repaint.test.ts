import {describe, expect, it} from "vitest";
import {onImageLoad, shapeToRecording} from "../src/render/shapeToRecording";
import type {GroupShape} from "../src/scene/Shape";

// A 1x1 transparent PNG — small enough that node-canvas decodes it inline.
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function imageGroup(src: string): GroupShape {
    return {
        type: "group",
        x: 0,
        y: 0,
        children: [{type: "image", x: 0, y: 0, width: 1, height: 1, src}],
    };
}

function firstImage(src: string): any {
    const node = shapeToRecording(imageGroup(src));
    const cmd = node.commands[0] as {type: "image"; image: any};
    expect(cmd.type).toBe("image");
    return cmd.image;
}

describe("image shapes — decode handling", () => {
    it("reuses one element per src, so a rebuild does not restart the decode", () => {
        const src = `${PNG_1PX}#reuse`;
        expect(firstImage(src)).toBe(firstImage(src));
    });

    it("gives each distinct src its own element", () => {
        expect(firstImage(`${PNG_1PX}#a`)).not.toBe(firstImage(`${PNG_1PX}#b`));
    });

    it("notifies subscribers when a decode lands, until they unsubscribe", async () => {
        let loads = 0;
        const unsubscribe = onImageLoad(() => {
            loads++;
        });

        firstImage(`${PNG_1PX}#notify`);
        await vi.waitFor(() => expect(loads).toBe(1));

        unsubscribe();
        firstImage(`${PNG_1PX}#after-unsubscribe`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(loads).toBe(1);
    });
});
