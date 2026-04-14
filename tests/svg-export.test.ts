import { describe, it, expect } from 'vitest';
import { SvgExporter } from '../src/SvgExporter';
import { createSettings } from '../src/Renderer';
import { createTestMapReader } from './helpers';

function exportArea(settingsOverrides?: Partial<ReturnType<typeof createSettings>>) {
    const reader = createTestMapReader();
    const settings = { ...createSettings(), ...settingsOverrides };
    const exporter = new SvgExporter(reader, settings);
    return exporter.export(1, 0);
}

describe('SvgExporter', () => {
    describe('basic export', () => {
        it('produces valid SVG string', () => {
            const svg = exportArea();
            expect(svg).toContain('<svg');
            expect(svg).toContain('</svg>');
            expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        });

        it('contains background rect', () => {
            const svg = exportArea();
            expect(svg).toContain('fill="#000000"');
        });

        it('renders rooms as rects by default', () => {
            const svg = exportArea();
            // Default roomShape is "rectangle", rooms are rendered as <rect>
            expect(svg).toContain('<rect');
        });

        it('snapshot - default settings', () => {
            const svg = exportArea();
            expect(svg).toMatchSnapshot();
        });
    });

    describe('room shapes', () => {
        it('snapshot - circle rooms', () => {
            const svg = exportArea({ roomShape: 'circle' });
            expect(svg).toContain('<circle');
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - rounded rectangle rooms', () => {
            const svg = exportArea({ roomShape: 'roundedRectangle' });
            expect(svg).toContain('rx=');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('rendering modes', () => {
        it('snapshot - frame mode', () => {
            const svg = exportArea({ frameMode: true });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - colored mode', () => {
            const svg = exportArea({ coloredMode: true });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - emboss mode', () => {
            const svg = exportArea({ emboss: true });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - frame + circle', () => {
            const svg = exportArea({ frameMode: true, roomShape: 'circle' });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - colored + emboss', () => {
            const svg = exportArea({ coloredMode: true, emboss: true });
            expect(svg).toMatchSnapshot();
        });
    });

    describe('grid', () => {
        it('snapshot - grid enabled', () => {
            const svg = exportArea({ gridEnabled: true });
            expect(svg).toMatchSnapshot();
        });
    });

    describe('visual options', () => {
        it('snapshot - no borders', () => {
            const svg = exportArea({ borders: false });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - area name shown', () => {
            const svg = exportArea({ areaName: true });
            expect(svg).toContain('Test Village');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('overlays', () => {
        it('snapshot - position marker', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            const svg = exporter.export(1, 0, {
                overlays: { position: { roomId: 1 } },
            });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - highlights', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            const svg = exporter.export(1, 0, {
                overlays: {
                    highlights: [
                        { roomId: 1, color: '#ff0000' },
                        { roomId: 3, color: '#00ff00' },
                    ],
                },
            });
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - path overlay', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            const svg = exporter.export(1, 0, {
                overlays: {
                    paths: [{ locations: [6, 2, 1, 3], color: '#66E64D' }],
                },
            });
            expect(svg).toMatchSnapshot();
        });
    });

    describe('different area', () => {
        it('snapshot - area 2 (Dark Forest)', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            const svg = exporter.export(2, 0);
            expect(svg).toContain('<svg');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('z-level', () => {
        it('snapshot - area 1 z=-1 (underground)', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            const svg = exporter.export(1, -1);
            expect(svg).toContain('<svg');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('error handling', () => {
        it('throws for nonexistent area', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            expect(() => exporter.export(999, 0)).toThrow();
        });

        it('throws for nonexistent z-level', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new SvgExporter(reader, settings);
            expect(() => exporter.export(1, 99)).toThrow();
        });
    });
});
