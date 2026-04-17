/**
 * Minimap preview for the demo.
 *
 * Mirrors the browser-script's preview behavior so the export/preview
 * scenarios (especially iso) can be tested in the lib directly.
 *
 * Captures a full-area PNG via renderer.backend.toCanvas() (which doesn't
 * disturb the visible viewport) and tracks the current viewport position
 * as a rectangle inside the preview.
 */

import type {MapRenderer, ViewportBounds} from "@src";

const MAX_SIZE = 400;

export class DemoPreview {
    private readonly stage: HTMLDivElement;
    private readonly renderer: MapRenderer;
    private readonly preview: HTMLElement;
    private readonly previewBg: HTMLElement;
    private readonly previewPan: HTMLElement;

    private areaBounds: ViewportBounds | null = null;

    constructor(stage: HTMLDivElement, renderer: MapRenderer) {
        this.stage = stage;
        this.renderer = renderer;
        this.preview = document.getElementById("demo-preview-container") as HTMLElement;
        this.previewBg = document.getElementById("demo-preview-bg") as HTMLElement;
        this.previewPan = document.getElementById("demo-preview-pan") as HTMLElement;

        this.stage.addEventListener("pan", () => this.update());
    }

    /** Capture a fresh full-area thumbnail (call after area change or render-mode change). */
    refresh(): void {
        const bounds = this.renderer.getAreaBounds();
        if (!bounds) return;
        const areaW = bounds.maxX - bounds.minX;
        const areaH = bounds.maxY - bounds.minY;
        if (areaW <= 0 || areaH <= 0) {
            this.preview.style.opacity = "0";
            return;
        }

        const aspect = areaW / areaH;
        const width = aspect >= 1 ? MAX_SIZE : Math.round(MAX_SIZE * aspect);
        const height = aspect >= 1 ? Math.round(MAX_SIZE / aspect) : MAX_SIZE;

        const canvas = this.renderer.backend.toCanvas({width, height, padding: 3});
        if (!canvas) return;

        // Size the preview box to the area aspect ratio
        let boxW: number, boxH: number;
        if (aspect >= 1) {
            boxW = MAX_SIZE;
            boxH = MAX_SIZE / aspect;
        } else {
            boxH = MAX_SIZE;
            boxW = MAX_SIZE * aspect;
        }
        this.preview.style.width = `${Math.round(boxW)}px`;
        this.preview.style.height = `${Math.round(boxH)}px`;
        this.preview.style.opacity = "1";

        this.previewBg.style.backgroundImage = `url(${canvas.toDataURL("image/png")})`;
        this.previewBg.style.backgroundSize = "100% 100%";
        this.previewBg.style.opacity = "0.7";

        this.areaBounds = bounds;
        this.update();
    }

    update(): void {
        if (!this.areaBounds) return;

        const viewport = this.renderer.getViewportBounds();
        const areaW = this.areaBounds.maxX - this.areaBounds.minX;
        const areaH = this.areaBounds.maxY - this.areaBounds.minY;
        if (areaW <= 0 || areaH <= 0) return;

        const left = ((viewport.minX - this.areaBounds.minX) / areaW) * 100;
        const top = ((viewport.minY - this.areaBounds.minY) / areaH) * 100;
        const width = ((viewport.maxX - viewport.minX) / areaW) * 100;
        const height = ((viewport.maxY - viewport.minY) / areaH) * 100;

        const clampedLeft = Math.max(0, Math.min(left, 100));
        const clampedTop = Math.max(0, Math.min(top, 100));
        const clampedRight = Math.min(100, left + width);
        const clampedBottom = Math.min(100, top + height);

        this.previewPan.style.left = `${clampedLeft}%`;
        this.previewPan.style.top = `${clampedTop}%`;
        this.previewPan.style.width = `${Math.max(0, clampedRight - clampedLeft)}%`;
        this.previewPan.style.height = `${Math.max(0, clampedBottom - clampedTop)}%`;

        this.previewPan.style.borderLeftStyle = left < 0 ? "none" : "";
        this.previewPan.style.borderTopStyle = top < 0 ? "none" : "";
        this.previewPan.style.borderRightStyle = left + width > 100 ? "none" : "";
        this.previewPan.style.borderBottomStyle = top + height > 100 ? "none" : "";
    }
}
