import Konva from "konva";
import type {Camera} from "../../camera/Camera";
import type {ViewportBounds} from "../../types/Settings";
import {cssToPackedRGBA, paintRasterOverview} from "./RasterOverview";

/** Visit every room (renderer-space x/y + env id) inside `bounds`. */
export type RasterVisit = (
    bounds: ViewportBounds,
    fn: (x: number, y: number, envId: number) => void,
) => void;

/** Fraction of the viewport added on each side of the painted region. */
const REGION_PAD = 0.25;
/** Hard cap on the offscreen canvas edge, in device pixels. */
const MAX_CANVAS_PX = 8192;

/**
 * Owns the raster LOD underlay: an offscreen canvas painted with the room
 * overview, shown through a single map-space `Konva.Image` on the (bottom)
 * LOD layer. Because the image is positioned in map coordinates, the stage
 * transform pans and zooms it like any other node — panning inside the
 * painted region costs nothing, and a repaint is only needed when the camera
 * escapes the region or the zoom changes (RAF-coalesced; the stretched image
 * covers the frames in between).
 *
 * Note: the raster paints raw renderer-space coordinates — decorator styles
 * with a `worldToScene` transform (e.g. isometric) are not applied to it.
 */
export class LodController {
    private readonly canvas: HTMLCanvasElement;
    private image?: Konva.Image;
    private visit: RasterVisit | null = null;
    private paintedRegion: ViewportBounds | null = null;
    private paintedScale = 0;
    private repaintScheduled = false;
    private destroyed = false;
    private readonly packedCache = new Map<number, number>();

    constructor(
        private readonly layer: Konva.Layer,
        private readonly camera: Camera,
        private readonly colorCss: (envId: number) => string,
        private readonly roomSizeOf: () => number,
    ) {
        this.canvas = Konva.Util.createCanvasElement();
        this.layer.visible(false);
    }

    /** Activate the raster overview over `visit` and paint immediately. */
    setSource(visit: RasterVisit): void {
        this.visit = visit;
        this.packedCache.clear();
        this.paint();
    }

    /** Deactivate and hide the overview (vector mode). */
    clear(): void {
        if (this.visit === null && !this.layer.visible()) return;
        this.visit = null;
        this.paintedRegion = null;
        this.layer.visible(false);
        this.layer.batchDraw();
    }

    /**
     * Camera moved: repaint (coalesced) if the viewport left the painted
     * region or the zoom changed; otherwise the stage transform already
     * moved the image correctly and there is nothing to do.
     */
    onViewportChange(): void {
        if (!this.visit || this.repaintScheduled) return;
        const r = this.paintedRegion;
        if (r && this.camera.getScale() === this.paintedScale) {
            const vp = this.camera.getViewportBounds();
            if (vp.minX >= r.minX && vp.maxX <= r.maxX &&
                vp.minY >= r.minY && vp.maxY <= r.maxY) return;
        }
        this.repaintScheduled = true;
        const run = () => {
            this.repaintScheduled = false;
            if (!this.destroyed && this.visit) this.paint();
        };
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(run);
        else queueMicrotask(run);
    }

    destroy(): void {
        this.destroyed = true;
        this.visit = null;
    }

    private colorOf = (envId: number): number => {
        let v = this.packedCache.get(envId);
        if (v === undefined) {
            v = cssToPackedRGBA(this.colorCss(envId));
            this.packedCache.set(envId, v);
        }
        return v;
    };

    private paint(): void {
        const visit = this.visit;
        if (!visit) return;
        const vp = this.camera.getViewportBounds();
        const scale = this.camera.getScale();
        const padX = (vp.maxX - vp.minX) * REGION_PAD;
        const padY = (vp.maxY - vp.minY) * REGION_PAD;
        const region: ViewportBounds = {
            minX: vp.minX - padX, maxX: vp.maxX + padX,
            minY: vp.minY - padY, maxY: vp.maxY + padY,
        };
        const wPx = Math.min(MAX_CANVAS_PX, Math.max(1, Math.ceil((region.maxX - region.minX) * scale)));
        const hPx = Math.min(MAX_CANVAS_PX, Math.max(1, Math.ceil((region.maxY - region.minY) * scale)));

        this.canvas.width = wPx;
        this.canvas.height = hPx;
        const ctx = this.canvas.getContext("2d")!;
        const img = ctx.createImageData(wPx, hPx);
        paintRasterOverview(img, fn => visit(region, fn), {
            scale,
            offsetX: -region.minX * scale,
            offsetY: -region.minY * scale,
            colorOf: this.colorOf,
            roomSize: this.roomSizeOf(),
        });
        ctx.putImageData(img, 0, 0);

        // The image lives in map space over the painted region; the stage
        // transform does the rest.
        if (!this.image) {
            this.image = new Konva.Image({image: this.canvas, listening: false});
            this.layer.add(this.image);
        } else {
            this.image.image(this.canvas);
        }
        this.image.position({x: region.minX, y: region.minY});
        this.image.size({
            width: region.maxX - region.minX,
            height: region.maxY - region.minY,
        });
        this.paintedRegion = region;
        this.paintedScale = scale;
        this.layer.visible(true);
        this.layer.batchDraw();
    }
}
