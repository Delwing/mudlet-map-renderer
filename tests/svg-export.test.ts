import { describe, it, expect } from 'vitest';
import { SvgExporter } from '../src/export/SvgExporter';
import { MapRenderer } from '../src/rendering/MapRenderer';
import type { MapState } from '../src/MapState';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';
import type { Settings } from '../src/types/Settings';
import type { SvgExportOptions } from '../src/SvgTypes';
import { isometricShapeStyle } from '../src/style/shape';

function exportArea(settingsOverrides?: Partial<Settings>) {
    const reader = createTestMapReader();
    const settings = { ...createSettings(), ...settingsOverrides };
    const renderer = new MapRenderer(reader, settings);
    renderer.drawArea(1, 0);
    return renderer.export(new SvgExporter());
}

function exportWithState(setup: (state: MapState) => void, options?: SvgExportOptions) {
    const reader = createTestMapReader();
    const settings = createSettings();
    const renderer = new MapRenderer(reader, settings);
    setup(renderer.state);
    return renderer.export(new SvgExporter(options));
}

describe('SvgRenderBackend', () => {
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
            const svg = exportWithState(
                (state) => state.setArea(1, 0),
                { overlays: { position: { roomId: 1 } } },
            );
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - highlights', () => {
            const svg = exportWithState(
                (state) => state.setArea(1, 0),
                {
                    overlays: {
                        highlights: [
                            { roomId: 1, color: '#ff0000' },
                            { roomId: 3, color: '#00ff00' },
                        ],
                    },
                },
            );
            expect(svg).toMatchSnapshot();
        });

        it('snapshot - path overlay', () => {
            const svg = exportWithState(
                (state) => state.setArea(1, 0),
                {
                    overlays: {
                        paths: [{ locations: [6, 2, 1, 3], color: '#66E64D' }],
                    },
                },
            );
            expect(svg).toMatchSnapshot();
        });
    });

    describe('coordinate-warping styles', () => {
        // Regression: iso SVG export used to write the SVG viewBox in
        // world space while shapes were drawn in (projected) scene space —
        // for non-zero rotations the rooms drifted off the background and
        // landed on transparent SVG with one side of the rect empty.
        // viewBox + background must follow the projection.
        it('isometric viewBox follows the scene-space projection, not world bounds', () => {
            const reader = createTestMapReader();
            const settings = createSettings();
            const renderer = new MapRenderer(reader, settings);
            renderer.drawArea(1, 0);
            renderer.setStyle(isometricShapeStyle({ rotation: 30, depth: settings.roomSize * 0.3 }));

            const svg = renderer.export(new SvgExporter());
            expect(svg).toBeDefined();

            const viewBox = svg!.match(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/);
            expect(viewBox).not.toBeNull();
            const [, vx, vy, vw, vh] = viewBox!.map(Number);

            // Collect the AABB of every polygon vertex the SVG actually emitted.
            const eps = 0.001;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            let polyCount = 0;
            for (const m of svg!.matchAll(/points="([^"]+)"/g)) {
                polyCount++;
                const coords = m[1].trim().split(/[\s,]+/).map(Number);
                for (let i = 0; i < coords.length; i += 2) {
                    if (coords[i] < minX) minX = coords[i];
                    if (coords[i] > maxX) maxX = coords[i];
                    if (coords[i + 1] < minY) minY = coords[i + 1];
                    if (coords[i + 1] > maxY) maxY = coords[i + 1];
                }
            }
            expect(polyCount).toBeGreaterThan(0);

            // 1) Every projected polygon vertex must lie inside the viewBox —
            //    this is the user-visible bug ("rooms on transparent background").
            expect(minX).toBeGreaterThanOrEqual(vx - eps);
            expect(maxX).toBeLessThanOrEqual(vx + vw + eps);
            expect(minY).toBeGreaterThanOrEqual(vy - eps);
            expect(maxY).toBeLessThanOrEqual(vy + vh + eps);

            // 2) The viewBox must follow the iso projection — re-project the
            //    world export bounds via the same Style and check the viewBox
            //    is the projected AABB (plus the scenePad). Catches a regression
            //    that uses world bounds for the viewBox.
            const style = isometricShapeStyle({ rotation: 30, depth: settings.roomSize * 0.3 });
            const w = renderer.state.computeExportBounds(
                renderer.state.currentAreaInstance!,
                renderer.state.currentAreaInstance!.getPlane(0)!,
                undefined,
                3,
            );
            const corners = [
                style.worldToScene!(w.x, w.y),
                style.worldToScene!(w.x + w.w, w.y),
                style.worldToScene!(w.x, w.y + w.h),
                style.worldToScene!(w.x + w.w, w.y + w.h),
            ];
            const projMinX = Math.min(...corners.map(c => c.x));
            const projMaxX = Math.max(...corners.map(c => c.x));
            const projMinY = Math.min(...corners.map(c => c.y));
            const projMaxY = Math.max(...corners.map(c => c.y));
            const projW = projMaxX - projMinX;
            const projH = projMaxY - projMinY;

            // viewBox must encompass the projected world AABB. World bounds
            // would (for rotation=30°) be narrower than projected bounds —
            // |projMaxX - projMinX| > |w.w|, since rotation skews the
            // bounding box. Assert vw ≥ projW so the regression path
            // (using world width = w.w) fails.
            expect(vw).toBeGreaterThanOrEqual(projW - eps);
            expect(vh).toBeGreaterThanOrEqual(projH - eps);
            expect(vx).toBeLessThanOrEqual(projMinX + eps);
            expect(vy).toBeLessThanOrEqual(projMinY + eps);
        });
    });

    describe('different area', () => {
        it('snapshot - area 2 (Dark Forest)', () => {
            const svg = exportWithState((state) => state.setArea(2, 0));
            expect(svg).toContain('<svg');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('z-level', () => {
        it('snapshot - area 1 z=-1 (underground)', () => {
            const svg = exportWithState((state) => state.setArea(1, -1));
            expect(svg).toContain('<svg');
            expect(svg).toMatchSnapshot();
        });
    });

    describe('missing data', () => {
        it('returns undefined for nonexistent area', () => {
            const svg = exportWithState((state) => state.setArea(999, 0));
            expect(svg).toBeUndefined();
        });

        it('returns undefined for nonexistent z-level', () => {
            const svg = exportWithState((state) => state.setArea(1, 99));
            expect(svg).toBeUndefined();
        });
    });
});
