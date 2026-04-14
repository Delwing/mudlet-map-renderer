import { vi } from 'vitest';

vi.mock('../src/utils/textMeasure', () => ({
    measureTextBaselineOffset: () => 0.35,
}));
