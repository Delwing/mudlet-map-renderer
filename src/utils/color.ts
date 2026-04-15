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

export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
