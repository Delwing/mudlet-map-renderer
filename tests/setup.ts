import 'konva/canvas-backend';
import { vi } from 'vitest';

vi.mock('../src/utils/textMeasure', () => ({
    measureTextBaselineOffset: () => ({ baselineRatio: 0.35, konvaCorrectionRatio: 0 }),
}));
