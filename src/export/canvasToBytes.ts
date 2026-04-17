import type {ExportCanvas} from "./Exporter";

/**
 * Serialize an {@link ExportCanvas} to raw bytes, synchronously, using the
 * portable `toDataURL` API. Works identically in the browser and in Node.
 *
 * ```ts
 * const canvas = renderer.export(new CanvasExporter({ width, height }));
 * const png = canvasToBytes(canvas);     // Uint8Array
 * fs.writeFileSync('out.png', png);       // Node
 * // or: new Blob([png], { type: 'image/png' })   — browser
 * ```
 *
 * @param canvas    Canvas produced by {@link CanvasExporter} or the
 *                  interactive backend's `exportCanvas`.
 * @param mimeType  Output format. Defaults to `'image/png'`. Pass `'image/jpeg'`
 *                  + `quality` (0..1) for JPEG.
 * @param quality   JPEG quality (ignored for PNG).
 */
export function canvasToBytes(
    canvas: ExportCanvas,
    mimeType: string = 'image/png',
    quality?: number,
): Uint8Array {
    const dataUrl = canvas.toDataURL(mimeType, quality);
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

    // `atob` is standard in browsers and available globally in Node ≥16.
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
