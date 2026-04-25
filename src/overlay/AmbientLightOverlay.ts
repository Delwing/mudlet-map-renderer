import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";
import {computeAmbientLight, type AmbientLightParams} from "../scene/AmbientLightStyle";
import type {Shape} from "../scene/Shape";
import type {SceneOverlay, SceneOverlayContext} from "./SceneOverlay";

export type AmbientLightOptions = Partial<AmbientLightParams>;

const DEFAULTS: AmbientLightParams = {
    color: '#ffcc44',
    radius: 12,
    intensity: 0.7,
};

/**
 * Vignette centered on the player room. Re-renders on position changes and
 * viewport changes (pan/zoom/resize). Registering the overlay turns the effect
 * on; removing it turns it off — there is no global settings flag.
 *
 * ```ts
 * const ambient = new AmbientLightOverlay({ color: '#ffcc44', radius: 12 });
 * renderer.addSceneOverlay('ambient-light', ambient);
 * // later:
 * ambient.setOptions({ intensity: 0.9 });
 * renderer.removeSceneOverlay('ambient-light');
 * ```
 */
export class AmbientLightOverlay implements SceneOverlay {
    private params: AmbientLightParams;
    private ctx?: SceneOverlayContext;
    private viewportUnsub?: () => void;
    private readonly onPosition = () => this.ctx?.invalidate();

    constructor(options?: AmbientLightOptions) {
        this.params = {...DEFAULTS, ...options};
    }

    /** Update tunables at runtime. Triggers a re-render. */
    setOptions(options: AmbientLightOptions): void {
        this.params = {...this.params, ...options};
        this.ctx?.invalidate();
    }

    getOptions(): AmbientLightParams {
        return {...this.params};
    }

    attach(ctx: SceneOverlayContext): void {
        this.ctx = ctx;
        ctx.state.events.on('position', this.onPosition);
        this.viewportUnsub = ctx.onViewportChange(() => ctx.invalidate());
    }

    detach(): void {
        this.ctx?.state.events.off('position', this.onPosition);
        this.viewportUnsub?.();
        this.viewportUnsub = undefined;
        this.ctx = undefined;
    }

    render(state: MapState, bounds: ViewportBounds): Shape | void {
        if (state.positionRoomId === undefined) return;
        const room = state.mapReader.getRoom(state.positionRoomId);
        if (!room) return;
        const data = computeAmbientLight(room.x, room.y, bounds, this.params);
        return {
            type: "image",
            x: data.cx - data.displaySize / 2,
            y: data.cy - data.displaySize / 2,
            width: data.displaySize,
            height: data.displaySize,
            src: data.src,
            layer: "overlay",
        };
    }
}
