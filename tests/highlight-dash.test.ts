import { describe, it, expect } from 'vitest';
import { resolveDash } from '../src/scene/Shape';

// Regression: the interactive (Konva recording) path applied a line's dash
// regardless of `dashEnabled`, so dashed highlights drawn with line segments —
// rectangular / "match room shape" highlights and multi-colour pie wedges —
// ignored the dash toggle while rect/circle highlights honoured it. All shape
// kinds now route their dash through `resolveDash`.

describe('resolveDash', () => {
    it('blanks the dash when dashEnabled is false', () => {
        expect(resolveDash([0.05, 0.05], false)).toBeUndefined();
    });

    it('keeps the dash when dashEnabled is true', () => {
        expect(resolveDash([0.05, 0.05], true)).toEqual([0.05, 0.05]);
    });

    it('keeps the dash when dashEnabled is unset (e.g. exits/paths)', () => {
        expect(resolveDash([0.05, 0.05], undefined)).toEqual([0.05, 0.05]);
    });

    it('returns undefined when there is no dash pattern', () => {
        expect(resolveDash(undefined, true)).toBeUndefined();
    });
});
