/**
 * Ambient light data: a single image containing a smooth radial vignette,
 * positioned centered on the player.
 */
export type AmbientLightData = {
    cx: number;
    cy: number;
    displaySize: number;
    src: string;
};

/** Tunable parameters for the ambient light vignette. */
export type AmbientLightParams = {
    color: string;
    radius: number;
    intensity: number;
};

// --- Vignette texture cache ---
// Regenerate only when settings or display ratio change.
let _cachedUrl: string | undefined;
let _cacheKey: string | undefined;

const TEXTURE_SIZE = 256;

/**
 * Generate a vignette texture as a data URL.
 * Uses canvas 2D radial gradient + destination-out compositing to create
 * a smooth darkness overlay with a clear center — no banding.
 */
function getVignetteDataUrl(intensity: number, color: string, lightRatio: number): string {
    const key = `${intensity.toFixed(2)}:${color}:${lightRatio.toFixed(3)}`;
    if (_cacheKey === key && _cachedUrl) return _cachedUrl;

    const size = TEXTURE_SIZE;
    const half = size / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // 1. Fill entire canvas with uniform darkness
    ctx.fillStyle = `rgba(0, 0, 0, ${intensity})`;
    ctx.fillRect(0, 0, size, size);

    // 2. Punch a smooth gradient "hole" using destination-out.
    //    At center: remove all darkness (fully clear).
    //    At light edge (lightRatio): remove nothing (stays dark).
    ctx.globalCompositeOperation = 'destination-out';

    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    const lr = Math.min(lightRatio, 0.99);

    gradient.addColorStop(0,          'rgba(0, 0, 0, 1)');
    gradient.addColorStop(lr * 0.25,  'rgba(0, 0, 0, 0.97)');
    gradient.addColorStop(lr * 0.50,  'rgba(0, 0, 0, 0.82)');
    gradient.addColorStop(lr * 0.70,  'rgba(0, 0, 0, 0.50)');
    gradient.addColorStop(lr * 0.85,  'rgba(0, 0, 0, 0.22)');
    gradient.addColorStop(lr * 0.95,  'rgba(0, 0, 0, 0.06)');
    gradient.addColorStop(lr,         'rgba(0, 0, 0, 0)');
    if (lr < 0.98) {
        gradient.addColorStop(1,      'rgba(0, 0, 0, 0)');
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();

    // 3. Optional: subtle colored glow in the center
    ctx.globalCompositeOperation = 'source-over';
    const cr = parseInt(color.slice(1, 3), 16);
    const cg = parseInt(color.slice(3, 5), 16);
    const cb = parseInt(color.slice(5, 7), 16);

    const tintGradient = ctx.createRadialGradient(half, half, 0, half, half, half * lr);
    tintGradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.05)`);
    tintGradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    ctx.fillStyle = tintGradient;
    ctx.fillRect(0, 0, size, size);

    _cachedUrl = canvas.toDataURL();
    _cacheKey = key;
    return _cachedUrl;
}

/**
 * Compute ambient light vignette for the given player position and viewport.
 *
 * Produces a single image overlay containing a smooth radial gradient:
 * clear at center → full darkness at edges. The image is sized to always
 * cover the entire visible viewport with margin.
 */
export function computeAmbientLight(
    cx: number,
    cy: number,
    viewportBounds: { minX: number; maxX: number; minY: number; maxY: number },
    params: AmbientLightParams,
): AmbientLightData {
    const {radius, intensity, color} = params;

    const vw = viewportBounds.maxX - viewportBounds.minX;
    const vh = viewportBounds.maxY - viewportBounds.minY;
    const viewportDiag = Math.sqrt(vw * vw + vh * vh);

    // Display size: large enough that the dark edges always cover the full viewport.
    // The image is square and centered on the player, so corner distance = displaySize * √2 / 2.
    const displaySize = Math.max(viewportDiag * 2.5, radius * 4);

    // What fraction of the image half-diagonal corresponds to the light radius
    const lightRatio = Math.round(radius / (displaySize / 2) * 50) / 50; // snap to 0.02 steps for caching

    const src = getVignetteDataUrl(intensity, color, lightRatio);

    return {cx, cy, displaySize, src};
}
