import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import { CanvasExporter } from '../src/CanvasExporter';
import { createSettings } from '../src/Renderer';
import { createTestMapReader } from './helpers';

const WIDTH = 400;
const HEIGHT = 300;

function exportArea(settingsOverrides?: Partial<ReturnType<typeof createSettings>>) {
    const reader = createTestMapReader();
    const settings = { ...createSettings(), ...settingsOverrides };
    const exporter = new CanvasExporter(reader, settings);
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    exporter.render(ctx as unknown as CanvasRenderingContext2D, 1, 0, { width: WIDTH, height: HEIGHT });
    return canvas.toBuffer('image/png');
}

function renderWithOverlays(overlays: any) {
    const reader = createTestMapReader();
    const settings = createSettings();
    const exporter = new CanvasExporter(reader, settings);
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    exporter.render(ctx as unknown as CanvasRenderingContext2D, 1, 0, { width: WIDTH, height: HEIGHT, overlays });
    return canvas.toBuffer('image/png');
}

function renderArea(areaId: number, zIndex: number, opts?: any) {
    const reader = createTestMapReader();
    const settings = createSettings();
    const exporter = new CanvasExporter(reader, settings);
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    exporter.render(ctx as unknown as CanvasRenderingContext2D, areaId, zIndex, { width: WIDTH, height: HEIGHT, ...opts });
    return canvas.toBuffer('image/png');
}

describe('CanvasExporter', () => {
    describe('basic export', () => {
        it('produces a valid PNG buffer', () => {
            const buffer = exportArea();
            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.length).toBeGreaterThan(0);
            expect(buffer[0]).toBe(0x89);
            expect(buffer[1]).toBe(0x50);
            expect(buffer[2]).toBe(0x4e);
            expect(buffer[3]).toBe(0x47);
        });

        it('snapshot - default settings', () => {
            expect(exportArea()).toMatchSnapshot();
        });
    });

    describe('room shapes', () => {
        it('snapshot - circle rooms', () => {
            expect(exportArea({ roomShape: 'circle' })).toMatchSnapshot();
        });

        it('snapshot - rounded rectangle rooms', () => {
            expect(exportArea({ roomShape: 'roundedRectangle' })).toMatchSnapshot();
        });
    });

    describe('rendering modes', () => {
        it('snapshot - frame mode', () => {
            expect(exportArea({ frameMode: true })).toMatchSnapshot();
        });

        it('snapshot - colored mode', () => {
            expect(exportArea({ coloredMode: true })).toMatchSnapshot();
        });

        it('snapshot - emboss mode', () => {
            expect(exportArea({ emboss: true })).toMatchSnapshot();
        });

        it('snapshot - frame + circle', () => {
            expect(exportArea({ frameMode: true, roomShape: 'circle' })).toMatchSnapshot();
        });

        it('snapshot - colored + emboss', () => {
            expect(exportArea({ coloredMode: true, emboss: true })).toMatchSnapshot();
        });
    });

    describe('grid', () => {
        it('snapshot - grid enabled', () => {
            expect(exportArea({ gridEnabled: true })).toMatchSnapshot();
        });
    });

    describe('visual options', () => {
        it('snapshot - no borders', () => {
            expect(exportArea({ borders: false })).toMatchSnapshot();
        });

        it('snapshot - area name shown', () => {
            expect(exportArea({ areaName: true })).toMatchSnapshot();
        });
    });

    describe('overlays', () => {
        it('snapshot - position marker', () => {
            expect(renderWithOverlays({ position: { roomId: 1 } })).toMatchSnapshot();
        });

        it('snapshot - highlights', () => {
            expect(renderWithOverlays({
                highlights: [
                    { roomId: 1, color: '#ff0000' },
                    { roomId: 3, color: '#00ff00' },
                ],
            })).toMatchSnapshot();
        });

        it('snapshot - path overlay', () => {
            expect(renderWithOverlays({
                paths: [{ locations: [6, 2, 1, 3], color: '#66E64D' }],
            })).toMatchSnapshot();
        });
    });

    describe('different area', () => {
        it('snapshot - area 2 (Dark Forest)', () => {
            expect(renderArea(2, 0)).toMatchSnapshot();
        });
    });

    describe('z-level', () => {
        it('snapshot - area 1 z=-1 (underground)', () => {
            expect(renderArea(1, -1)).toMatchSnapshot();
        });
    });

    describe('export options', () => {
        it('snapshot - centered on room', () => {
            expect(renderArea(1, 0, { roomId: 1, padding: 2 })).toMatchSnapshot();
        });

        it('snapshot - custom padding', () => {
            expect(renderArea(1, 0, { padding: 10 })).toMatchSnapshot();
        });
    });

    describe('error handling', () => {
        it('throws for nonexistent area', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new CanvasExporter(reader, settings);
            const canvas = createCanvas(WIDTH, HEIGHT);
            const ctx = canvas.getContext('2d');
            expect(() => exporter.render(ctx as unknown as CanvasRenderingContext2D, 999, 0, { width: WIDTH, height: HEIGHT })).toThrow();
        });

        it('throws for nonexistent z-level', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const exporter = new CanvasExporter(reader, settings);
            const canvas = createCanvas(WIDTH, HEIGHT);
            const ctx = canvas.getContext('2d');
            expect(() => exporter.render(ctx as unknown as CanvasRenderingContext2D, 1, 99, { width: WIDTH, height: HEIGHT })).toThrow();
        });
    });
});
