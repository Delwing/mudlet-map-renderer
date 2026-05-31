import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { SvgExporter } from '../src/export/SvgExporter';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

function createRenderer() {
    const reader = createTestMapReader();
    const settings = createSettings();
    return new MapRenderer(reader, settings);
}

function exportSvg(renderer: MapRenderer, options?: Parameters<typeof SvgExporter.prototype.render>[0] | any) {
    return renderer.export(new SvgExporter(options));
}

// Snapshot label kept as 'HeadlessRenderer' to match existing snapshot file;
// the behaviour under test is `MapRenderer` + `SvgExporter` in headless mode
// (constructor without a DOM container).
describe('HeadlessRenderer', () => {
    describe('drawArea + exportSvg', () => {
        it('exports SVG after drawArea', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svg = renderer.export(new SvgExporter());
            expect(svg).toBeDefined();
            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
        });

        it('returns undefined before drawArea', () => {
            const renderer = createRenderer();
            expect(renderer.export(new SvgExporter())).toBeUndefined();
        });

        it('can switch areas', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svg1 = renderer.export(new SvgExporter());

            renderer.drawArea(2, 0);
            const svg2 = renderer.export(new SvgExporter());

            expect(svg1).not.toBe(svg2);
        });

        it('snapshot - basic area export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });
    });

    describe('getCurrentArea', () => {
        it('returns undefined before drawArea', () => {
            const renderer = createRenderer();
            expect(renderer.getCurrentArea()).toBeUndefined();
        });

        it('returns area after drawArea', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const area = renderer.getCurrentArea();
            expect(area).toBeDefined();
            expect(area!.getAreaName()).toBe('Test Village');
        });
    });

    describe('position', () => {
        it('snapshot - with position marker', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.state.positionRoomId = 1;
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('clearPosition removes marker', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.state.positionRoomId = 1;
            const withPos = renderer.export(new SvgExporter());

            renderer.state.positionRoomId = undefined;
            const withoutPos = renderer.export(new SvgExporter());

            expect(withPos).not.toBe(withoutPos);
        });

        it('position on different area/z is not included', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.state.positionRoomId = 9;
            const svg = renderer.export(new SvgExporter());
            const renderer2 = createRenderer();
            renderer2.drawArea(1, 0);
            expect(svg).toBe(renderer2.export(new SvgExporter()));
        });
    });

    describe('highlights', () => {
        it('snapshot - single highlight', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('snapshot - multiple highlights', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            renderer.renderHighlight(3, '#00ff00');
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('snapshot - multi-color highlight (pie wedges)', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, ['#ff0000', '#00ff00', '#0000ff']);
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('multi-color highlight renders one stroke per colour', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, ['#ff0000', '#00ff00', '#0000ff']);
            const svg = renderer.export(new SvgExporter());
            expect(svg).toContain('rgba(255, 0, 0, 1)');
            expect(svg).toContain('rgba(0, 255, 0, 1)');
            expect(svg).toContain('rgba(0, 0, 255, 1)');
        });

        it('single-element color array behaves like a single colour', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, ['#ff0000']);

            const single = createRenderer();
            single.drawArea(1, 0);
            single.renderHighlight(1, '#ff0000');

            expect(renderer.export(new SvgExporter())).toBe(single.export(new SvgExporter()));
        });

        it('removeHighlight works', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            expect(renderer.hasHighlight(1)).toBe(true);

            renderer.removeHighlight(1);
            expect(renderer.hasHighlight(1)).toBe(false);
        });

        it('clearHighlights removes all', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            renderer.renderHighlight(3, '#00ff00');
            renderer.clearHighlights();
            expect(renderer.hasHighlight(1)).toBe(false);
            expect(renderer.hasHighlight(3)).toBe(false);
        });

        it('highlight on different area/z is not included', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(9, '#ff0000');

            const renderer2 = createRenderer();
            renderer2.drawArea(1, 0);

            expect(renderer.export(new SvgExporter())).toBe(renderer2.export(new SvgExporter()));
        });
    });

    describe('paths', () => {
        it('snapshot - path overlay', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([6, 2, 1, 3]);
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('snapshot - path with custom color', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([1, 2, 6], '#ff0000');
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });

        it('clearPaths removes path overlays', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([1, 2, 6]);
            const withPath = renderer.export(new SvgExporter());

            renderer.clearPaths();
            const withoutPath = renderer.export(new SvgExporter());

            expect(withPath).not.toBe(withoutPath);
        });
    });

    describe('combined overlays', () => {
        it('snapshot - position + highlights + path', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.state.positionRoomId = 1;
            renderer.renderHighlight(3, '#ff0000');
            renderer.renderHighlight(6, '#0000ff');
            renderer.renderPath([6, 2, 1, 3], '#66E64D');
            expect(renderer.export(new SvgExporter())).toMatchSnapshot();
        });
    });

    describe('export options', () => {
        it('passes padding to SVG export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svgSmall = renderer.export(new SvgExporter({ padding: 1 }));
            const svgLarge = renderer.export(new SvgExporter({ padding: 10 }));
            expect(svgSmall).not.toBe(svgLarge);
        });

        it('passes roomId focus to SVG export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svgFull = renderer.export(new SvgExporter());
            const svgFocused = renderer.export(new SvgExporter({ roomId: 1, padding: 2 }));
            expect(svgFocused).not.toBe(svgFull);
        });
    });
});
void exportSvg;
