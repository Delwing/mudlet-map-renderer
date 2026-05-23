import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { KonvaRenderBackend } from '../src/rendering/KonvaRenderBackend';
import { createSettings } from '../src/types/Settings';
import { Isometric } from '../src/style';

const isoStyle = Isometric({depth: 0.18});
import { SpotlightOverlay } from '../demo/SpotlightOverlay';
import { createTestMapReader } from './helpers';

function backend(renderer: MapRenderer): KonvaRenderBackend {
    return renderer.backend as KonvaRenderBackend;
}

describe('KonvaRenderBackend — multi-shape style output (regression)', () => {
    it('replaces the position marker on every move under isometric style', () => {
        const renderer = new MapRenderer(createTestMapReader(), createSettings());
        renderer.setStyle(isoStyle);
        renderer.setPosition(1);
        const afterFirst = backend(renderer).positionLayer.getChildren().length;
        expect(afterFirst).toBeGreaterThan(0);

        for (let i = 0; i < 5; i++) {
            renderer.setPosition(1);
        }

        expect(backend(renderer).positionLayer.getChildren().length).toBe(afterFirst);
    });

    it('replaces a scene overlay on every render under isometric style', () => {
        const renderer = new MapRenderer(createTestMapReader(), createSettings());
        renderer.setStyle(isoStyle);
        renderer.setPosition(1);
        renderer.addSceneOverlay('spotlight', new SpotlightOverlay());
        const baseline = backend(renderer).overlayLayer.getChildren().length;
        expect(baseline).toBeGreaterThan(0);

        for (let i = 0; i < 5; i++) {
            renderer.setPosition(1);
        }

        expect(backend(renderer).overlayLayer.getChildren().length).toBe(baseline);
    });
});
