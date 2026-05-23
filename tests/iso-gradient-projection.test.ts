import { describe, it, expect } from 'vitest';
import { isometricShapeStyle } from '../src/style/shape/IsometricStyle';
import { isGradientFill, type LinearGradient, type RectShape } from '../src/scene/Shape';

const ctx = { scale: 1, roomSize: 1 };

function buildRectWithVerticalGradient(): RectShape {
    const grad: LinearGradient = {
        type: 'linear',
        x0: 0, y0: 0, x1: 0, y1: 10,
        stops: [
            { offset: 0, color: '#ffffff' },
            { offset: 1, color: '#000000' },
        ],
    };
    return {
        type: 'rect',
        x: 0, y: 0, width: 10, height: 10,
        paint: { fill: grad },
    };
}

describe('IsometricStyle — gradient projection', () => {
    it('projects linear-gradient endpoints to match the diamond geometry (flat, no depth)', () => {
        const style = isometricShapeStyle({ depth: 0, rotation: 0 });
        const result = style.transform(buildRectWithVerticalGradient(), ctx);
        const polygons = Array.isArray(result) ? result : [result];
        const top = polygons.find(s => s.type === 'polygon')!;
        expect(top.type).toBe('polygon');

        const fill = (top as any).paint.fill;
        expect(isGradientFill(fill)).toBe(true);

        const verts = (top as any).vertices as number[];
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < verts.length; i += 2) {
            if (verts[i] < minY) minY = verts[i];
            if (verts[i] > maxY) maxY = verts[i];
        }
        expect(fill.y0).toBeCloseTo(minY, 6);
        expect(fill.y1).toBeCloseTo(maxY, 6);
    });

    it('projects linear-gradient endpoints on the top diamond when depth is set', () => {
        const style = isometricShapeStyle({ depth: 0.18, rotation: 0 });
        const result = style.transform(buildRectWithVerticalGradient(), ctx);
        const shapes = Array.isArray(result) ? result : [result];
        const polygons = shapes.filter(s => s.type === 'polygon') as any[];
        expect(polygons.length).toBeGreaterThanOrEqual(3);

        const top = polygons[polygons.length - 1];
        const fill = top.paint.fill;
        expect(isGradientFill(fill)).toBe(true);

        const verts = top.vertices as number[];
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < verts.length; i += 2) {
            if (verts[i] < minY) minY = verts[i];
            if (verts[i] > maxY) maxY = verts[i];
        }
        expect(fill.y0).toBeCloseTo(minY, 6);
        expect(fill.y1).toBeCloseTo(maxY, 6);
    });

    it('projects gradient endpoints under rotation', () => {
        const style = isometricShapeStyle({ depth: 0, rotation: 30 });
        const result = style.transform(buildRectWithVerticalGradient(), ctx);
        const top = (Array.isArray(result) ? result : [result]).find(s => s.type === 'polygon') as any;
        const fill = top.paint.fill as LinearGradient;

        // Original endpoint (0,10). With rotation=30°, iso(0,10) = (-sin30·10, cos30·10/2)
        // = (-5, ~4.33). The endpoint must have moved off the original Y axis.
        expect(fill.x1).toBeCloseTo(-5, 4);
        expect(fill.y1).toBeCloseTo(Math.cos(Math.PI / 6) * 5, 4);
    });
});
