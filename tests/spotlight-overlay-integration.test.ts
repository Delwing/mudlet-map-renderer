import {describe, expect, it} from "vitest";
import {MapRenderer, SvgExporter, GradientRooms, createSettings} from "../src";
import {SpotlightOverlay} from "../demo/SpotlightOverlay";
import {createTestMapReader} from "./helpers";

describe("Demo gradient wiring (SpotlightOverlay + GradientRooms)", () => {
    it("SpotlightOverlay produces a radial gradient in the SVG export", () => {
        const reader = createTestMapReader();
        const renderer = new MapRenderer(reader, createSettings());
        renderer.drawArea(1, 0);
        renderer.setPosition(1);
        renderer.addSceneOverlay("spotlight", new SpotlightOverlay({
            color: "#ffd166", radius: 8, intensity: 0.55,
        }));
        const svg = renderer.export(new SvgExporter())!;
        expect(svg).toMatch(/<radialGradient id="mmr-grad-\d+"/);
        // Three stops from the spotlight (transparent → peak → transparent).
        const radialBlock = svg.match(/<radialGradient[^>]*>(.*?)<\/radialGradient>/s);
        expect(radialBlock).not.toBeNull();
        const stops = [...radialBlock![1].matchAll(/<stop /g)];
        expect(stops.length).toBe(3);
    });

    it("GradientRooms produces linearGradient defs for room fills in SVG export", () => {
        const reader = createTestMapReader();
        const renderer = new MapRenderer(reader, createSettings());
        renderer.drawArea(1, 0);
        renderer.setStyle(GradientRooms());
        const svg = renderer.export(new SvgExporter())!;
        expect(svg).toMatch(/<linearGradient id="mmr-grad-\d+"/);
    });
});
