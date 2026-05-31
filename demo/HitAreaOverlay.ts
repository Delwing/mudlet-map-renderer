import type {HitTester, HitDebugEntry, HitGeom} from "@src/hit/HitTester";
import type {SceneOverlay} from "@src/overlay/SceneOverlay";
import type {MapState} from "@src/MapState";
import type {ViewportBounds} from "@src/types/Settings";
import type {Shape} from "@src/scene/Shape";

const KIND_COLOR: Record<string, string> = {
    room:        "#ff4444",
    areaExit:    "#ffaa00",
    label:       "#44ff44",
    specialExit: "#cc44ff",
    exit:        "#4488ff",
    stub:        "#44ddff",
};

const OUTLINE_WIDTH = 0.015;

export class HitAreaOverlay implements SceneOverlay {
    // debugEntries() geometry is in rendered space (the HitTester has already
    // applied the coord transform). Skip the Style transform so it isn't
    // projected a second time under coordinate-warping styles (Isometric).
    readonly sceneSpace = true;

    private readonly hitTester: HitTester;

    constructor(hitTester: HitTester) {
        this.hitTester = hitTester;
    }

    render(_state: MapState, _bounds: ViewportBounds): Shape[] {
        const shapes: Shape[] = [];
        for (const entry of this.hitTester.debugEntries()) {
            const color = KIND_COLOR[entry.kind] ?? "#ffffff";
            appendEntryShapes(entry, color, shapes);
        }
        return shapes;
    }
}

function appendEntryShapes(entry: HitDebugEntry, color: string, out: Shape[]) {
    const {marginRadius} = entry;
    for (const geom of entry.geoms) {
        appendGeomShapes(geom, color, marginRadius, out);
    }
}

function appendGeomShapes(
    geom: HitGeom,
    color: string,
    marginRadius: number,
    out: Shape[],
) {
    if (geom.type === "circle") {
        // Actual geometry
        out.push({
            type: "circle",
            cx: geom.cx, cy: geom.cy, radius: geom.r,
            paint: {stroke: color, strokeWidth: OUTLINE_WIDTH},
            layer: "overlay",
        });
        // Margin zone
        if (marginRadius > 0) {
            out.push({
                type: "circle",
                cx: geom.cx, cy: geom.cy, radius: geom.r + marginRadius,
                paint: {stroke: color, strokeWidth: OUTLINE_WIDTH * 0.6,
                        dash: [0.06, 0.04], alpha: 0.5},
                layer: "overlay",
            });
        }
        return;
    }

    if (geom.closed) {
        // Margin zone: the actual narrow-phase hit area is "inside the polygon
        // OR within marginRadius of an edge". Draw it as a fat round-joined band
        // tracing the edges so it follows the projected shape — under Isometric
        // this hugs the diamond instead of the misleading axis-aligned bbox. No
        // interior fill: a translucent fill would cover room symbols and labels.
        if (marginRadius > 0) {
            const band = (geom.pts as number[]).slice();
            band.push(geom.pts[0], geom.pts[1]); // close the loop
            out.push({
                type: "line",
                points: band,
                paint: {stroke: color, strokeWidth: marginRadius * 2, alpha: 0.15},
                lineCap: "round",
                lineJoin: "round",
                layer: "overlay",
            });
        }
        // Solid outline of the actual hit geometry on top
        out.push({
            type: "polygon",
            vertices: geom.pts as number[],
            paint: {stroke: color, strokeWidth: OUTLINE_WIDTH},
            layer: "overlay",
        });
    } else {
        // Fat translucent band showing the hit zone width (2× marginRadius)
        if (marginRadius > 0) {
            out.push({
                type: "line",
                points: geom.pts as number[],
                paint: {stroke: color, strokeWidth: marginRadius * 2, alpha: 0.2},
                lineCap: "round",
                layer: "overlay",
            });
        }
        // Actual geometry on top
        out.push({
            type: "line",
            points: geom.pts as number[],
            paint: {stroke: color, strokeWidth: OUTLINE_WIDTH},
            lineCap: "round",
            layer: "overlay",
        });
    }
}
