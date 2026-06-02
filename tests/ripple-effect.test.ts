import {describe, expect, it} from "vitest";
import Konva from "konva";
import {RippleEffect} from "../src/overlay/RippleEffect";

function makeLayer(): Konva.Layer {
    const stage = new Konva.Stage({width: 50, height: 50});
    const layer = new Konva.Layer();
    stage.add(layer);
    return layer;
}

describe("RippleEffect", () => {
    it("attaches a ring node to the layer", () => {
        const layer = makeLayer();
        const ripple = new RippleEffect(2, 3, {duration: 400});
        ripple.attach(layer);
        const circles = layer.find("Circle");
        expect(circles.length).toBe(1);
        ripple.destroy();
    });

    it("positions the ring via the coordinate transform", () => {
        const layer = makeLayer();
        const ripple = new RippleEffect(2, 3);
        ripple.attach(layer);
        // Double every coordinate.
        ripple.updateViewport({minX: 0, maxX: 1, minY: 0, maxY: 1}, 1, (x, y) => ({x: x * 2, y: y * 2}));
        const circle = layer.findOne("Circle") as Konva.Circle;
        expect(circle.x()).toBe(4);
        expect(circle.y()).toBe(6);
        ripple.destroy();
    });

    it("fires onComplete and self-resolves for a zero-length tween", () => {
        const layer = makeLayer();
        let done = false;
        const ripple = new RippleEffect(0, 0, {duration: 0, onComplete: () => { done = true; }});
        ripple.attach(layer);
        expect(done).toBe(true);
        ripple.destroy();
    });

    it("removes its node on destroy", () => {
        const layer = makeLayer();
        const ripple = new RippleEffect(0, 0);
        ripple.attach(layer);
        expect(layer.find("Circle").length).toBe(1);
        ripple.destroy();
        expect(layer.find("Circle").length).toBe(0);
    });
});
