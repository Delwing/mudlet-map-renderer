import {describe, it, expect} from 'vitest';
import type {Style} from '../src/style/Style';
import {identityStyle} from '../src/style/Style';
import {serializeTransform, forwardFn, inverseFn} from '../src/rendering/offscreen/serializeTransform';

const isoLike: Style = {
    transform: (s) => s,
    worldToScene: (x, y) => ({x: x * 2 + 3, y: y * 0.5 - 1}),
    sceneToWorld: (x, y) => ({x: (x - 3) / 2, y: (y + 1) / 0.5}),
};

describe('serializeTransform', () => {
    it('flat styles serialize to identity', () => {
        const t = serializeTransform(identityStyle);
        expect(t.kind).toBe('identity');
        expect(forwardFn(t)).toBeUndefined();
        expect(inverseFn(t)).toBeUndefined();
    });

    it('affine styles reconstruct worldToScene exactly', () => {
        const t = serializeTransform(isoLike);
        expect(t.kind).toBe('affine');
        const fwd = forwardFn(t)!;
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [3, 7], [-4, 2.5]]) {
            const got = fwd(x, y);
            const expected = isoLike.worldToScene!(x, y);
            expect(got.x).toBeCloseTo(expected.x, 10);
            expect(got.y).toBeCloseTo(expected.y, 10);
        }
    });

    it('forward/inverse round-trip', () => {
        const t = serializeTransform(isoLike);
        const fwd = forwardFn(t)!;
        const inv = inverseFn(t)!;
        for (const [x, y] of [[0, 0], [3, 7], [-4, 2.5]]) {
            const s = fwd(x, y);
            const back = inv(s.x, s.y);
            expect(back.x).toBeCloseTo(x, 10);
            expect(back.y).toBeCloseTo(y, 10);
        }
    });
});
