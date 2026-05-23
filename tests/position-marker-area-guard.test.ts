import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { KonvaRenderBackend } from '../src/rendering/KonvaRenderBackend';
import { createSettings } from '../src/types/Settings';
import { createTestMapReader } from './helpers';

function createRenderer() {
    const reader = createTestMapReader();
    const settings = createSettings();
    return new MapRenderer(reader, settings);
}

function positionLayer(renderer: MapRenderer) {
    return (renderer.backend as KonvaRenderBackend).positionLayer;
}

describe('KonvaRenderBackend position marker — area/z guard', () => {
    it('hides the marker when drawArea switches to an area that does not contain the player room', () => {
        const renderer = createRenderer();
        renderer.setPosition(1); // room 1 lives in area 1 z=0
        expect(positionLayer(renderer).getChildren().length).toBeGreaterThan(0);

        renderer.drawArea(2, 0);
        expect(positionLayer(renderer).getChildren().length).toBe(0);
        expect(renderer.state.positionRoomId).toBe(1);
    });

    it('restores the marker when switching back to the player area/z', () => {
        const renderer = createRenderer();
        renderer.setPosition(1);
        renderer.drawArea(2, 0);
        expect(positionLayer(renderer).getChildren().length).toBe(0);

        renderer.drawArea(1, 0);
        expect(positionLayer(renderer).getChildren().length).toBeGreaterThan(0);
    });

    it('hides the marker when switching to a different z on the same area', () => {
        const renderer = createRenderer();
        renderer.setPosition(1); // z=0
        expect(positionLayer(renderer).getChildren().length).toBeGreaterThan(0);

        renderer.drawArea(1, 1); // same area, room 10 is here — player room 1 is not
        expect(positionLayer(renderer).getChildren().length).toBe(0);
        expect(renderer.state.positionRoomId).toBe(1);
    });

    it('setPosition continues to switch area and show the marker', () => {
        const renderer = createRenderer();
        renderer.drawArea(2, 0);
        expect(positionLayer(renderer).getChildren().length).toBe(0);

        renderer.setPosition(1); // switches to area 1 z=0
        expect(renderer.state.currentArea).toBe(1);
        expect(renderer.state.currentZIndex).toBe(0);
        expect(positionLayer(renderer).getChildren().length).toBeGreaterThan(0);
    });
});
