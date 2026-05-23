import type {MapState, SceneOverlay, SceneOverlayContext, Shape, ViewportBounds} from "@src";

export type SpotlightOptions = {
    /** CSS colour of the spotlight halo (hex). Default `#ffd166`. */
    color: string;
    /** Halo radius in map units. Default 8. */
    radius: number;
    /** Peak alpha at the rim of the halo (0..1). Default 0.55. */
    intensity: number;
};

const DEFAULTS: SpotlightOptions = {
    color: "#ffd166",
    radius: 8,
    intensity: 0.55,
};

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.startsWith("#") ? hex.slice(1) : hex;
    const s = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const n = parseInt(s, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Magical spotlight halo around the player room. Single circle shape filled
 * with a {@link RadialGradient} — transparent at the centre, rising to peak
 * alpha at ~70% of the radius, fading back out at the rim. Demonstrates the
 * new gradient {@link FillStyle} in a {@link SceneOverlay}, so it appears in
 * the interactive canvas, SVG export, and PNG export with no per-target code.
 */
export class SpotlightOverlay implements SceneOverlay {
    private opts: SpotlightOptions;
    private ctx?: SceneOverlayContext;
    private readonly onPosition = () => this.ctx?.invalidate();

    constructor(options?: Partial<SpotlightOptions>) {
        this.opts = {...DEFAULTS, ...options};
    }

    getOptions(): SpotlightOptions {
        return {...this.opts};
    }

    setOptions(options: Partial<SpotlightOptions>) {
        this.opts = {...this.opts, ...options};
        this.ctx?.invalidate();
    }

    attach(ctx: SceneOverlayContext) {
        this.ctx = ctx;
        ctx.state.events.on("position", this.onPosition);
    }

    detach() {
        this.ctx?.state.events.off("position", this.onPosition);
        this.ctx = undefined;
    }

    render(state: MapState, _bounds: ViewportBounds): Shape | void {
        if (state.positionRoomId === undefined) return;
        const room = state.mapReader.getRoom(state.positionRoomId);
        if (!room) return;

        const {color, radius, intensity} = this.opts;
        const [r, g, b] = hexToRgb(color);
        const peak = `rgba(${r}, ${g}, ${b}, ${intensity})`;
        const transparent = `rgba(${r}, ${g}, ${b}, 0)`;

        return {
            type: "circle",
            cx: room.x,
            cy: room.y,
            radius,
            layer: "overlay",
            paint: {
                fill: {
                    type: "radial",
                    cx: room.x,
                    cy: room.y,
                    r: radius,
                    stops: [
                        {offset: 0.00, color: transparent},
                        {offset: 0.45, color: peak},
                        {offset: 1.00, color: transparent},
                    ],
                },
            },
        };
    }
}
