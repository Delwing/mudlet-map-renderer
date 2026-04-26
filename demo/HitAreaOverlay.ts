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
    const {marginRadius, minX, maxX, minY, maxY} = entry;
    for (const geom of entry.geoms) {
        appendGeomShapes(geom, color, marginRadius, minX, maxX, minY, maxY, out);
    }
}

function appendGeomShapes(
    geom: HitGeom,
    color: string,
    marginRadius: number,
    minX: number, maxX: number, minY: number, maxY: number,
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
        // Solid outline of the actual hit geometry
        out.push({
            type: "polygon",
            vertices: geom.pts as number[],
            paint: {stroke: color, strokeWidth: OUTLINE_WIDTH},
            layer: "overlay",
        });
        // Margin zone: expanded bbox (dashed), which is the exact AABB filter boundary
        if (marginRadius > 0) {
            out.push({
                type: "rect",
                x: minX - marginRadius, y: minY - marginRadius,
                width:  (maxX - minX) + 2 * marginRadius,
                height: (maxY - minY) + 2 * marginRadius,
                paint: {stroke: color, strokeWidth: OUTLINE_WIDTH * 0.6,
                        dash: [0.06, 0.04], alpha: 0.5},
                layer: "overlay",
            });
        }
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
