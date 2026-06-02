import Konva from "konva";
import type {CoordinateTransform, LiveEffect} from "./LiveEffect";
import type {ViewportBounds} from "../types/Settings";

export interface RippleOptions {
    /** Animation length in milliseconds. Default 400. */
    duration?: number;
    /** Ring colour (any CSS colour). Default "#00e5b2". */
    color?: string;
    /** Starting ring radius in world units. Default 0.3. */
    startRadius?: number;
    /** Final ring radius in world units. Default 1.2. */
    endRadius?: number;
    /** Ring stroke width in world units. Default 0.08. */
    strokeWidth?: number;
    /**
     * Invoked once when the animation finishes. The host should use this to
     * remove the (now spent) effect, e.g. `removeLiveEffect(id)`.
     */
    onComplete?: () => void;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const raf: (cb: (t: number) => void) => number =
    typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame
        : (cb) => setTimeout(() => cb(now()), 16) as unknown as number;
const caf: (id: number) => void =
    typeof cancelAnimationFrame !== "undefined"
        ? cancelAnimationFrame
        : (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

/**
 * One-shot expanding, fading ring centred on a world-space point — used to
 * pulse the player marker when it moves. Implements {@link LiveEffect}, so it
 * works on both the Konva and OffscreenCanvas backends (the latter composites
 * it on its main-thread effect stage).
 *
 * The ring lives in scene space (the host layer carries the camera transform),
 * so it tracks the map as the user pans/zooms. It self-animates and calls
 * {@link RippleOptions.onComplete} when done.
 */
export class RippleEffect implements LiveEffect {
    private ring?: Konva.Circle;
    private rafId?: number;
    private cancelled = false;
    private transform: CoordinateTransform = (x, y) => ({x, y});

    private readonly duration: number;
    private readonly color: string;
    private readonly startRadius: number;
    private readonly endRadius: number;
    private readonly strokeWidth: number;
    private readonly onComplete?: () => void;

    constructor(
        private readonly worldX: number,
        private readonly worldY: number,
        options: RippleOptions = {},
    ) {
        this.duration = options.duration ?? 400;
        this.color = options.color ?? "#00e5b2";
        this.startRadius = options.startRadius ?? 0.3;
        this.endRadius = options.endRadius ?? 1.2;
        this.strokeWidth = options.strokeWidth ?? 0.08;
        this.onComplete = options.onComplete;
    }

    attach(layer: Konva.Layer): void {
        const p = this.transform(this.worldX, this.worldY);
        this.ring = new Konva.Circle({
            x: p.x,
            y: p.y,
            radius: this.startRadius,
            stroke: this.color,
            strokeWidth: this.strokeWidth,
            listening: false,
        });
        layer.add(this.ring);
        layer.batchDraw();

        const apply = (t: number) => {
            if (!this.ring) return;
            this.ring.radius(this.startRadius + (this.endRadius - this.startRadius) * t);
            this.ring.opacity(1 - t);
            layer.batchDraw();
        };

        if (this.duration <= 0) {
            apply(1);
            this.onComplete?.();
            return;
        }

        const start = now();
        const step = (time: number) => {
            if (this.cancelled) return;
            const t = Math.min((time - start) / this.duration, 1);
            apply(t);
            if (t < 1) {
                this.rafId = raf(step);
            } else {
                this.rafId = undefined;
                this.onComplete?.();
            }
        };
        this.rafId = raf(step);
    }

    updateViewport(_bounds: ViewportBounds, _scale: number, coordinateTransform: CoordinateTransform): void {
        this.transform = coordinateTransform;
        if (this.ring) {
            const p = coordinateTransform(this.worldX, this.worldY);
            this.ring.position({x: p.x, y: p.y});
        }
    }

    destroy(): void {
        this.cancelled = true;
        if (this.rafId !== undefined) {
            caf(this.rafId);
            this.rafId = undefined;
        }
        this.ring?.destroy();
        this.ring = undefined;
    }
}
