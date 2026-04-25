import { describe, it, expect, vi } from 'vitest';
import { RenderScheduler, DirtyFlag } from '../src/RenderScheduler';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { SvgExporter } from '../src/export/SvgExporter';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

describe('RenderScheduler', () => {
    it('coalesces markDirty calls before a flush into one flushFn invocation', async () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);

        scheduler.markDirty(DirtyFlag.Highlights);
        scheduler.markDirty(DirtyFlag.Paths);
        scheduler.markDirty(DirtyFlag.Position);

        expect(flushFn).not.toHaveBeenCalled();
        expect(scheduler.pending()).toBe(
            DirtyFlag.Highlights | DirtyFlag.Paths | DirtyFlag.Position,
        );
        expect(scheduler.isScheduled()).toBe(true);

        await new Promise((r) => setTimeout(r, 32));

        expect(flushFn).toHaveBeenCalledTimes(1);
        expect(flushFn).toHaveBeenCalledWith(
            DirtyFlag.Highlights | DirtyFlag.Paths | DirtyFlag.Position,
        );
        expect(scheduler.pending()).toBe(DirtyFlag.None);
        expect(scheduler.isScheduled()).toBe(false);
    });

    it('flush() runs pending work synchronously and clears state', () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);
        scheduler.markDirty(DirtyFlag.Scene);
        scheduler.flush();
        expect(flushFn).toHaveBeenCalledTimes(1);
        expect(flushFn).toHaveBeenCalledWith(DirtyFlag.Scene);
        expect(scheduler.pending()).toBe(DirtyFlag.None);
        expect(scheduler.isScheduled()).toBe(false);
    });

    it('flush() with nothing pending is a no-op', () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);
        scheduler.flush();
        expect(flushFn).not.toHaveBeenCalled();
    });

    it('flush() cancels the scheduled rAF callback (no double dispatch)', async () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);
        scheduler.markDirty(DirtyFlag.Highlights);
        scheduler.flush();
        expect(flushFn).toHaveBeenCalledTimes(1);

        await new Promise((r) => setTimeout(r, 32));
        expect(flushFn).toHaveBeenCalledTimes(1);
    });

    it('markDirty(None) is a no-op', () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);
        scheduler.markDirty(DirtyFlag.None);
        expect(scheduler.isScheduled()).toBe(false);
        scheduler.flush();
        expect(flushFn).not.toHaveBeenCalled();
    });

    it('destroy() cancels pending work and silences future markDirty', async () => {
        const flushFn = vi.fn();
        const scheduler = new RenderScheduler(flushFn);
        scheduler.markDirty(DirtyFlag.Scene);
        scheduler.destroy();
        scheduler.markDirty(DirtyFlag.Scene);
        await new Promise((r) => setTimeout(r, 32));
        expect(flushFn).not.toHaveBeenCalled();
    });
});

describe('MapRenderer batching (Phase 5)', () => {
    function makeRenderer() {
        const reader = createTestMapReader();
        const settings = createSettings();
        return new MapRenderer(reader, settings);
    }

    it('drawArea defers backend.refresh until flush()', () => {
        const r = makeRenderer();
        const refreshSpy = vi.spyOn(r.backend, 'refresh');
        r.drawArea(1, 0);
        expect(refreshSpy).not.toHaveBeenCalled();

        r.flush();
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('multiple state mutations in the same tick flush as one Scene refresh', () => {
        const r = makeRenderer();
        // Bootstrap so that subsequent mutations are not the first area set.
        r.drawArea(1, 0);
        r.flush();

        const refreshSpy = vi.spyOn(r.backend, 'refresh');

        r.drawArea(1, 0);            // Scene
        r.renderHighlight(1, '#f00'); // Highlights
        r.renderPath([1, 2, 3]);      // Paths
        r.setPosition(1, true);       // Position

        expect(refreshSpy).not.toHaveBeenCalled();

        r.flush();
        // Scene flag short-circuits the others — exactly one refresh.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('export() auto-flushes pending work', () => {
        const r = makeRenderer();
        const refreshSpy = vi.spyOn(r.backend, 'refresh');
        r.drawArea(1, 0);
        const svg = r.export(new SvgExporter());
        // SvgExporter is independent of backend.refresh (builds its own pipeline),
        // but export() still calls backend.flush() to keep canvas/PNG exports
        // consistent — so the area Scene flush should have run.
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(svg).toBeDefined();
        expect(svg).toContain('<svg');
    });

    it('updateSettings background-only does not refresh the scene', () => {
        const r = makeRenderer();
        r.drawArea(1, 0);
        r.flush();

        const refreshSpy = vi.spyOn(r.backend, 'refresh');
        const updateBgSpy = vi.spyOn(r.backend, 'updateBackground');

        r.updateSettings({ backgroundColor: '#abcdef' });
        r.flush();

        expect(refreshSpy).not.toHaveBeenCalled();
        expect(updateBgSpy).toHaveBeenCalled();
    });

    it('updateSettings roomSize triggers a single Scene refresh', () => {
        const r = makeRenderer();
        r.drawArea(1, 0);
        r.flush();

        const refreshSpy = vi.spyOn(r.backend, 'refresh');
        r.updateSettings({ roomSize: 0.9 });
        r.flush();
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('mixing updateSettings(scene) with state mutations stays at one refresh', () => {
        const r = makeRenderer();
        r.drawArea(1, 0);
        r.flush();

        const refreshSpy = vi.spyOn(r.backend, 'refresh');
        r.updateSettings({ roomSize: 0.9 });
        r.renderHighlight(1, '#f00');
        r.setPosition(2, false);
        r.flush();
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
});
