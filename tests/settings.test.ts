import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { SvgExporter } from '../src/export/SvgExporter';
import {
    createSettings, diffSettings, invalidationTargetsFor, SETTINGS_INVALIDATION,
} from '../src/types/Settings';
import type { Settings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

function makeRenderer(settingsOverrides?: Partial<Settings>) {
    const reader = createTestMapReader();
    const settings = { ...createSettings(), ...settingsOverrides };
    const renderer = new MapRenderer(reader, settings);
    renderer.drawArea(1, 0);
    return renderer;
}

describe('diffSettings', () => {
    it('returns empty set when partial matches current values', () => {
        const s = createSettings();
        const changed = diffSettings(s, { roomSize: s.roomSize, lineColor: s.lineColor });
        expect(changed.size).toBe(0);
    });

    it('returns set of keys whose values differ', () => {
        const s = createSettings();
        const changed = diffSettings(s, { roomSize: 0.9, gridEnabled: true, lineColor: s.lineColor });
        expect([...changed].sort()).toEqual(['gridEnabled', 'roomSize']);
    });

    it('skips keys explicitly set to undefined', () => {
        const s = createSettings();
        const changed = diffSettings(s, { roomSize: undefined });
        expect(changed.size).toBe(0);
    });

    it('uses reference equality for nested objects', () => {
        const s = createSettings();
        const sameRef = diffSettings(s, { playerMarker: s.playerMarker });
        expect(sameRef.size).toBe(0);

        const newMarker = { ...s.playerMarker };
        const newRef = diffSettings(s, { playerMarker: newMarker });
        expect(newRef.has('playerMarker')).toBe(true);
    });
});

describe('invalidationTargetsFor', () => {
    it('maps backgroundColor to background only', () => {
        const targets = invalidationTargetsFor(['backgroundColor']);
        expect([...targets]).toEqual(['background']);
    });

    it('maps cullingMode to culling only', () => {
        const targets = invalidationTargetsFor(['cullingMode']);
        expect([...targets]).toEqual(['culling']);
    });

    it('maps roomShape to scene + position', () => {
        const targets = invalidationTargetsFor(['roomShape']);
        expect(targets.has('scene')).toBe(true);
        expect(targets.has('position')).toBe(true);
    });

    it('unions targets across multiple keys', () => {
        const targets = invalidationTargetsFor(['backgroundColor', 'cullingMode', 'roomSize']);
        expect(targets.has('background')).toBe(true);
        expect(targets.has('culling')).toBe(true);
        expect(targets.has('scene')).toBe(true);
    });

    it('returns empty for keys with no invalidation (e.g. instantMapMove)', () => {
        const targets = invalidationTargetsFor(['instantMapMove']);
        expect(targets.size).toBe(0);
    });

    it('every Settings key appears in SETTINGS_INVALIDATION', () => {
        // Guards against forgetting to map a new setting.
        const sample = createSettings();
        for (const key of Object.keys(sample)) {
            expect(
                SETTINGS_INVALIDATION,
                `Missing invalidation entry for "${key}"`,
            ).toHaveProperty(key);
        }
    });
});

describe('MapRenderer.updateSettings', () => {
    it('returns the set of keys that actually changed', () => {
        const renderer = makeRenderer();
        const current = renderer.state.settings;
        const changed = renderer.updateSettings({
            roomSize: 0.85,
            lineColor: current.lineColor, // unchanged
        });
        expect([...changed]).toEqual(['roomSize']);
    });

    it('returns empty set and no-ops when nothing changed', () => {
        const renderer = makeRenderer();
        const before = renderer.export(new SvgExporter());
        const changed = renderer.updateSettings({
            roomSize: renderer.state.settings.roomSize,
            backgroundColor: renderer.state.settings.backgroundColor,
        });
        expect(changed.size).toBe(0);
        expect(renderer.export(new SvgExporter())).toBe(before);
    });

    it('mutates the underlying settings object in place', () => {
        const renderer = makeRenderer();
        const settingsRef = renderer.state.settings;
        renderer.updateSettings({ roomSize: 0.9 });
        expect(settingsRef.roomSize).toBe(0.9);
        // Same reference — sub-renderers retain validity.
        expect(renderer.state.settings).toBe(settingsRef);
    });

    it('background-only change does not rebuild rooms (rect data identical)', () => {
        // SVG output differs only in the bg fill string when only background changes.
        const r1 = makeRenderer();
        const before = r1.export(new SvgExporter())!;
        r1.updateSettings({ backgroundColor: '#123456' });
        const after = r1.export(new SvgExporter())!;

        expect(before).not.toBe(after);
        // Background change reflected in the SVG fill rect.
        expect(after).toContain('#123456');

        // Stripping the background fill values makes the two SVGs identical.
        const stripBg = (s: string) => s.replace(/fill="(#000000|#123456)"/g, 'fill="BG"');
        expect(stripBg(before)).toBe(stripBg(after));
    });

    it('roomSize change rebuilds the scene (SVG materially differs)', () => {
        const r = makeRenderer();
        const before = r.export(new SvgExporter())!;
        r.updateSettings({ roomSize: 1.2 });
        const after = r.export(new SvgExporter())!;
        expect(after).not.toBe(before);
        // Rebuilt scene → same scene structure, but with different room geometry.
        // Crude sanity check: width/height attrs reference roomSize, so length differs.
        expect(after.length).not.toBe(before.length);
    });

    it('cullingMode change updates settings without rebuilding scene', () => {
        const r = makeRenderer();
        const before = r.export(new SvgExporter())!;
        const changed = r.updateSettings({ cullingMode: 'none' });
        expect(changed.has('cullingMode')).toBe(true);
        expect(r.state.settings.cullingMode).toBe('none');
        // SVG export is independent of culling mode (no viewport bounds).
        expect(r.export(new SvgExporter())).toBe(before);
    });
});

describe('MapRenderer.getSettings', () => {
    it('returns a frozen shallow copy', () => {
        const r = makeRenderer();
        const snap = r.getSettings();
        expect(Object.isFrozen(snap)).toBe(true);
        expect(Object.isFrozen(snap.playerMarker)).toBe(true);
    });

    it('reflects current values', () => {
        const r = makeRenderer();
        r.updateSettings({ roomSize: 0.7, gridEnabled: true });
        const snap = r.getSettings();
        expect(snap.roomSize).toBe(0.7);
        expect(snap.gridEnabled).toBe(true);
    });

    it('mutating the snapshot does not affect state', () => {
        const r = makeRenderer();
        const snap = r.getSettings();
        // Mutation is silently ignored in non-strict mode and throws in strict.
        // Either way, the underlying state must not change.
        try { (snap as unknown as Settings).roomSize = 99; } catch { /* expected */ }
        expect(r.state.settings.roomSize).not.toBe(99);
    });
});
