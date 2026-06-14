import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Konva from 'konva';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';
import MapReader from '../src/reader/MapReader';
import type { IMapReader } from '../src/reader/MapReader';

/**
 * `coalesceRooms` batches same-style primitives and so reorders them. It is NOT
 * pixel-identical to per-entry drawing by design: anti-aliasing at line
 * junctions shifts slightly, and at the rare spots where shapes overlap the
 * draw order can flip. These tests assert the output stays *visually
 * equivalent* — the vast majority of pixels match exactly, and "hard"
 * differences (a whole shape mis-coloured) stay a tiny fraction. A gross
 * regression (a missing/duplicated layer) would blow past these bounds.
 */
function diffStats(off: Uint8ClampedArray, on: Uint8ClampedArray) {
    let diffPixels = 0;
    let hardPixels = 0; // delta > 128 — a real colour swap, not AA
    let maxDelta = 0;
    for (let i = 0; i < off.length; i += 4) {
        const d = Math.max(
            Math.abs(off[i] - on[i]), Math.abs(off[i + 1] - on[i + 1]),
            Math.abs(off[i + 2] - on[i + 2]), Math.abs(off[i + 3] - on[i + 3]),
        );
        if (d > 0) diffPixels++;
        if (d > 128) hardPixels++;
        if (d > maxDelta) maxDelta = d;
    }
    const totalPixels = off.length / 4;
    return { diffFrac: diffPixels / totalPixels, hardFrac: hardPixels / totalPixels, maxDelta };
}

function renderTwice(reader: IMapReader, areaId: number, z: number, W: number, H: number) {
    const settings = createSettings();
    const renderer = new MapRenderer(reader, settings);
    renderer.drawArea(areaId, z);
    renderer.camera.setSize(W, H);
    const backend: any = renderer.backend;
    const stage: Konva.Stage = backend.stage;
    stage.size({ width: W, height: H });
    for (const layer of stage.getLayers()) layer.getCanvas().setSize(W, H);
    renderer.fitArea();
    renderer.refresh();

    const layer: Konva.Layer = backend.roomLayer;
    const ctx = (layer.getCanvas() as any).getContext()._context as CanvasRenderingContext2D;

    settings.coalesceRooms = false;
    layer.draw();
    const off = ctx.getImageData(0, 0, W, H).data.slice();

    settings.coalesceRooms = true;
    layer.draw();
    const on = ctx.getImageData(0, 0, W, H).data.slice();

    return diffStats(off, on);
}

describe('coalesceRooms parity', () => {
    it('is visually equivalent on the test fixture', () => {
        const { diffFrac, hardFrac } = renderTwice(createTestMapReader(), 1, 0, 800, 600);
        expect(diffFrac).toBeLessThan(0.02);
        expect(hardFrac).toBeLessThan(0.002);
    });

    it('is visually equivalent on a large, dense real area', () => {
        const mapPath = path.join(__dirname, '..', 'demo', 'mapExport.json');
        if (!fs.existsSync(mapPath)) return; // demo map not present — skip
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as MapData.Map;
        const envs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'colors.json'), 'utf8')) as MapData.Env[];
        const reader = new MapReader(map, envs);

        const { diffFrac, hardFrac } = renderTwice(reader, 52, 0, 1400, 1000);
        // Mostly AA at line junctions; hard swaps confined to rare overlaps.
        expect(diffFrac).toBeLessThan(0.04);
        expect(hardFrac).toBeLessThan(0.005);
    }, 20000);
});
