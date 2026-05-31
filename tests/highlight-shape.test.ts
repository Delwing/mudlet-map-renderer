import { describe, it, expect } from 'vitest';
import { computeHighlight } from '../src/scene/OverlayStyle';
import { highlightToShape } from '../src/scene/elements/OverlayLayout';
import { createSettings } from '../src/types/Settings';

const room = { x: 1, y: 2 } as MapData.Room;

describe('computeHighlight shape selection', () => {
    it("'circle' forces a circle regardless of roomShape", () => {
        const s = createSettings();
        s.roomShape = 'rectangle';
        s.highlight.shape = 'circle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('circle');
    });

    it("'rectangle' forces a square with no corner radius", () => {
        const s = createSettings();
        s.roomShape = 'circle';
        s.highlight.shape = 'rectangle';
        const d = computeHighlight(room, '#f00', s);
        expect(d.shape).toBe('rect');
        expect(d.cornerRadius).toBe(0);
    });

    it("'roundedRectangle' forces a rect with a corner radius", () => {
        const s = createSettings();
        s.highlight.shape = 'roundedRectangle';
        const d = computeHighlight(room, '#f00', s);
        expect(d.shape).toBe('rect');
        expect(d.cornerRadius).toBeGreaterThan(0);
    });

    it("'match' follows roomShape (the default behaviour)", () => {
        const s = createSettings();
        s.highlight.shape = 'match';
        s.highlight.matchRoomShape = true;

        s.roomShape = 'circle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('circle');

        s.roomShape = 'rectangle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('rect');

        s.roomShape = 'roundedRectangle';
        expect(computeHighlight(room, '#f00', s).cornerRadius).toBeGreaterThan(0);
    });

    it("'match' with matchRoomShape off is always a circle", () => {
        const s = createSettings();
        s.highlight.shape = 'match';
        s.highlight.matchRoomShape = false;
        s.roomShape = 'rectangle';
        expect(computeHighlight(room, '#f00', s).shape).toBe('circle');
    });
});

describe('highlightToShape rounded vs square outline', () => {
    it("roundedRectangle renders a single rounded rect with a stroke (not 4 lines)", () => {
        const s = createSettings();
        s.highlight.shape = 'roundedRectangle';
        const shape = highlightToShape(computeHighlight(room, '#f00', s)) as {
            type: string; cornerRadius?: number; paint?: { stroke?: string };
        };
        expect(shape.type).toBe('rect');
        expect(shape.cornerRadius ?? 0).toBeGreaterThan(0);
        expect(shape.paint?.stroke).toBeTruthy();
    });

    it("rectangle renders a group of straight line segments", () => {
        const s = createSettings();
        s.highlight.shape = 'rectangle';
        const shape = highlightToShape(computeHighlight(room, '#f00', s));
        expect(shape.type).toBe('group');
    });

    it("circle renders a circle", () => {
        const s = createSettings();
        s.highlight.shape = 'circle';
        const shape = highlightToShape(computeHighlight(room, '#f00', s));
        expect(shape.type).toBe('circle');
    });
});

function maxStrokeDist(shape: unknown, cx: number, cy: number): number {
    const group = shape as { type: string; children?: Array<{ type: string; points?: number[] }> };
    let max = 0;
    for (const child of group.children ?? []) {
        if (child.type !== 'line' || !child.points) continue;
        for (let i = 0; i < child.points.length; i += 2) {
            max = Math.max(max, Math.hypot(child.points[i] - cx, child.points[i + 1] - cy));
        }
    }
    return max;
}

describe('multi-colour rounded wedges follow the corner radius', () => {
    it('pulls the wedge corners inside the sharp square corner', () => {
        const colors = ['#ff0000', '#00ff00'];

        const sharp = createSettings();
        sharp.highlight.shape = 'rectangle';
        const rounded = createSettings();
        rounded.highlight.shape = 'roundedRectangle';

        const sharpShape = highlightToShape(computeHighlight(room, colors, sharp));
        const roundedShape = highlightToShape(computeHighlight(room, colors, rounded));

        const sharpMax = maxStrokeDist(sharpShape, room.x, room.y);
        const roundedMax = maxStrokeDist(roundedShape, room.x, room.y);

        const half = (sharp.roomSize / 2) * sharp.highlight.sizeFactor;
        // The sharp wedge reaches the square's corner (~half·√2); the rounded one
        // is pulled measurably inside it.
        expect(sharpMax).toBeGreaterThan(roundedMax + 1e-6);
        expect(sharpMax).toBeGreaterThan(half * 1.39);   // ≈ half·√2
        expect(roundedMax).toBeLessThan(half * Math.SQRT2);
    });
});
