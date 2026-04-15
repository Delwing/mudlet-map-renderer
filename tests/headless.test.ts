import { describe, it, expect } from 'vitest';
import { HeadlessRenderer } from '../src/HeadlessRenderer';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

function createRenderer() {
    const reader = createTestMapReader();
    const settings = createSettings();
    return new HeadlessRenderer(reader, settings);
}

describe('HeadlessRenderer', () => {
    describe('drawArea + exportSvg', () => {
        it('exports SVG after drawArea', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svg = renderer.exportSvg();
            expect(svg).toBeDefined();
            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
        });

        it('returns undefined before drawArea', () => {
            const renderer = createRenderer();
            expect(renderer.exportSvg()).toBeUndefined();
        });

        it('can switch areas', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svg1 = renderer.exportSvg();

            renderer.drawArea(2, 0);
            const svg2 = renderer.exportSvg();

            expect(svg1).not.toBe(svg2);
        });

        it('snapshot - basic area export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            expect(renderer.exportSvg()).toMatchSnapshot();
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
            renderer.setPosition(1);
            expect(renderer.exportSvg()).toMatchSnapshot();
        });

        it('clearPosition removes marker', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.setPosition(1);
            const withPos = renderer.exportSvg();

            renderer.clearPosition();
            const withoutPos = renderer.exportSvg();

            expect(withPos).not.toBe(withoutPos);
        });

        it('position on different area/z is not included', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            // Room 9 is on z=-1, so it shouldn't show on z=0
            renderer.setPosition(9);
            const svg = renderer.exportSvg();
            // The SVG should be the same as without position
            const renderer2 = createRenderer();
            renderer2.drawArea(1, 0);
            expect(svg).toBe(renderer2.exportSvg());
        });
    });

    describe('highlights', () => {
        it('snapshot - single highlight', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            expect(renderer.exportSvg()).toMatchSnapshot();
        });

        it('snapshot - multiple highlights', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderHighlight(1, '#ff0000');
            renderer.renderHighlight(3, '#00ff00');
            expect(renderer.exportSvg()).toMatchSnapshot();
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
            renderer.renderHighlight(9, '#ff0000'); // z=-1 room

            const renderer2 = createRenderer();
            renderer2.drawArea(1, 0);

            expect(renderer.exportSvg()).toBe(renderer2.exportSvg());
        });
    });

    describe('paths', () => {
        it('snapshot - path overlay', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([6, 2, 1, 3]);
            expect(renderer.exportSvg()).toMatchSnapshot();
        });

        it('snapshot - path with custom color', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([1, 2, 6], '#ff0000');
            expect(renderer.exportSvg()).toMatchSnapshot();
        });

        it('clearPaths removes path overlays', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.renderPath([1, 2, 6]);
            const withPath = renderer.exportSvg();

            renderer.clearPaths();
            const withoutPath = renderer.exportSvg();

            expect(withPath).not.toBe(withoutPath);
        });
    });

    describe('combined overlays', () => {
        it('snapshot - position + highlights + path', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            renderer.setPosition(1);
            renderer.renderHighlight(3, '#ff0000');
            renderer.renderHighlight(6, '#0000ff');
            renderer.renderPath([6, 2, 1, 3], '#66E64D');
            expect(renderer.exportSvg()).toMatchSnapshot();
        });
    });

    describe('export options', () => {
        it('passes padding to SVG export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svgSmall = renderer.exportSvg({ padding: 1 });
            const svgLarge = renderer.exportSvg({ padding: 10 });
            // Larger padding = larger viewBox
            expect(svgSmall).not.toBe(svgLarge);
        });

        it('passes roomId focus to SVG export', () => {
            const renderer = createRenderer();
            renderer.drawArea(1, 0);
            const svgFull = renderer.exportSvg();
            const svgFocused = renderer.exportSvg({ roomId: 1, padding: 2 });
            // Focused export has smaller viewBox
            expect(svgFocused).not.toBe(svgFull);
        });
    });
});
