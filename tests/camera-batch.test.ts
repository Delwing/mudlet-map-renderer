import { describe, it, expect } from 'vitest';
import { Camera } from '../src/camera/Camera';

describe('Camera.batch', () => {
    it('emits a single change for multiple mutations', () => {
        const camera = new Camera(800, 600);
        let changes = 0;
        camera.on('change', () => changes++);

        camera.batch(() => {
            camera.setSize(1024, 768);
            camera.panToMapPoint(10, 20);
        });

        expect(changes).toBe(1);
    });

    it('reports the final settled state in the emitted change', () => {
        const camera = new Camera(800, 600);
        let observedBounds: ReturnType<Camera['getViewportBounds']> | null = null;
        camera.on('change', () => {
            observedBounds = camera.getViewportBounds();
        });

        camera.batch(() => {
            camera.setSize(400, 300);
            camera.panToMapPoint(50, 25);
        });

        // Final bounds should be centred on (50, 25) at the new size.
        expect(observedBounds).not.toBeNull();
        const b = observedBounds!;
        expect((b.minX + b.maxX) / 2).toBeCloseTo(50);
        expect((b.minY + b.maxY) / 2).toBeCloseTo(25);
    });

    it('does not emit when nothing inside the batch mutates', () => {
        const camera = new Camera(800, 600);
        let changes = 0;
        camera.on('change', () => changes++);

        camera.batch(() => {
            // setZoom to the current zoom returns false and never notifies
            camera.setZoom(camera.zoom);
        });

        expect(changes).toBe(0);
    });

    it('supports nesting — only the outermost batch emits', () => {
        const camera = new Camera(800, 600);
        let changes = 0;
        camera.on('change', () => changes++);

        camera.batch(() => {
            camera.setSize(1024, 768);
            camera.batch(() => {
                camera.panToMapPoint(10, 20);
            });
            expect(changes).toBe(0);
        });

        expect(changes).toBe(1);
    });

    it('propagates the function return value', () => {
        const camera = new Camera(800, 600);
        const result = camera.batch(() => {
            camera.setZoom(0.5);
            return 'done';
        });
        expect(result).toBe('done');
    });

    it('still emits when the batch function throws', () => {
        const camera = new Camera(800, 600);
        let changes = 0;
        camera.on('change', () => changes++);

        expect(() => {
            camera.batch(() => {
                camera.setSize(400, 300);
                throw new Error('boom');
            });
        }).toThrow('boom');

        expect(changes).toBe(1);
    });
});
