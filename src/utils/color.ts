export function colorLightness(color: string): number {
    let r: number, g: number, b: number;
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]) / 255;
        g = parseInt(rgbMatch[2]) / 255;
        b = parseInt(rgbMatch[3]) / 255;
    } else if (color.startsWith('#') && color.length >= 7) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    } else {
        return 0.5;
    }
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

export function darkenColor(color: string, factor: number): string {
    let r: number, g: number, b: number;
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
    } else if (color.startsWith('#') && color.length >= 7) {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
    } else {
        return color;
    }
    r = Math.round(r * (1 - factor));
    g = Math.round(g * (1 - factor));
    b = Math.round(b * (1 - factor));
    return `rgb(${r}, ${g}, ${b})`;
}

export function lightenColor(color: string, factor: number): string {
    let r: number, g: number, b: number;
    const rgbMatch = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
    } else if (color.startsWith('#') && color.length >= 7) {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
    } else {
        return color;
    }
    r = Math.min(255, Math.round(r + (255 - r) * factor));
    g = Math.min(255, Math.round(g + (255 - g) * factor));
    b = Math.min(255, Math.round(b + (255 - b) * factor));
    return `rgb(${r}, ${g}, ${b})`;
}

// Most-used CSS named colours. Covers what callers reach for in highlight/marker
// settings; unknown names fall back to the input string so they at least render.
const NAMED_COLORS: Record<string, [number, number, number]> = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
    lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255],
    aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
    silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128],
    maroon: [128, 0, 0], olive: [128, 128, 0], purple: [128, 0, 128], teal: [0, 128, 128],
    navy: [0, 0, 128], orange: [255, 165, 0], pink: [255, 192, 203], gold: [255, 215, 0],
    brown: [165, 42, 42], violet: [238, 130, 238], indigo: [75, 0, 130],
    transparent: [0, 0, 0],
};

/**
 * Apply an alpha value to any CSS colour. Accepts `#rgb`, `#rrggbb`, `rgb(...)`,
 * `rgba(...)` (alphas multiply), and the named colours in {@link NAMED_COLORS}.
 * Falls back to returning the input unchanged for unrecognised formats so the
 * shape stays visible rather than collapsing to black.
 *
 * The name is historical — see also call sites that take any user-supplied colour.
 */
export function hexToRgba(color: string, alpha: number): string {
    const c = color.trim();

    if (c.startsWith('#')) {
        let r: number, g: number, b: number;
        if (c.length === 4) {
            r = parseInt(c[1] + c[1], 16);
            g = parseInt(c[2] + c[2], 16);
            b = parseInt(c[3] + c[3], 16);
        } else if (c.length >= 7) {
            r = parseInt(c.slice(1, 3), 16);
            g = parseInt(c.slice(3, 5), 16);
            b = parseInt(c.slice(5, 7), 16);
        } else {
            return color;
        }
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return color;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const rgbaMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (rgbaMatch) {
        const r = parseInt(rgbaMatch[1], 10);
        const g = parseInt(rgbaMatch[2], 10);
        const b = parseInt(rgbaMatch[3], 10);
        const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) * alpha : alpha;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    const named = NAMED_COLORS[c.toLowerCase()];
    if (named) {
        return `rgba(${named[0]}, ${named[1]}, ${named[2]}, ${alpha})`;
    }

    return color;
}
