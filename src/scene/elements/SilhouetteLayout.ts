import type {IArea} from "../../reader/Area";
import type {IMapReader} from "../../reader/MapReader";
import type {RoomLens} from "../../lens/RoomLens";
import type {Settings} from "../../types/Settings";
import type {Shape} from "../Shape";
import {hexToRgba} from "../../utils/color";

type Bounds = { x: number; y: number; width: number; height: number };

/** One silhouette shape (room body or exit line) paired with its world-space bounds. */
export type SilhouetteShapeRef = { shape: Shape; bounds: Bounds };

/**
 * Lay out faded silhouettes of the levels below/above `zIndex` (see
 * {@link Settings.levelSilhouettes}). Returned in draw order: the farthest
 * level first, so nearer levels paint over farther ones, and within a level
 * exit lines before room bodies.
 *
 * Shapes carry no `hit` — silhouettes are never pickable. Opacity is baked
 * into the colour strings (like hidden-room fading) rather than `paint.alpha`,
 * so styles that rebuild paint from scratch still draw them translucent.
 */
export function layoutLevelSilhouettes(
    area: IArea,
    zIndex: number,
    mapReader: IMapReader,
    settings: Settings,
    isVisible: RoomLens["isVisible"],
): SilhouetteShapeRef[] {
    const cfg = settings.levelSilhouettes;
    if (!cfg || (!cfg.below && !cfg.above)) return [];
    const depth = Math.max(0, Math.floor(cfg.depth));
    if (depth === 0 || cfg.alpha <= 0) return [];

    const levels = new Set(area.getZLevels());
    const out: SilhouetteShapeRef[] = [];

    for (let k = depth; k >= 1; k--) {
        const alpha = cfg.alpha * Math.pow(cfg.falloff, k - 1);
        if (alpha <= 0) continue;
        if (cfg.below) {
            emitLevel(out, area, zIndex - k, k, alpha, cfg.belowColor, levels, mapReader, settings, isVisible);
        }
        if (cfg.above) {
            emitLevel(out, area, zIndex + k, -k, alpha, cfg.aboveColor, levels, mapReader, settings, isVisible);
        }
    }
    return out;
}

function emitLevel(
    out: SilhouetteShapeRef[],
    area: IArea,
    z: number,
    step: number,
    alpha: number,
    color: string,
    levels: Set<number>,
    mapReader: IMapReader,
    settings: Settings,
    isVisible: RoomLens["isVisible"],
) {
    if (!levels.has(z)) return;
    const plane = area.getPlane(z);
    if (!plane) return;
    const rooms = plane.getRooms().filter(isVisible);
    if (rooms.length === 0) return;

    const cfg = settings.levelSilhouettes;
    const dx = cfg.offsetX * step;
    const dy = cfg.offsetY * step;
    const paintColor = hexToRgba(color, alpha);
    // With useRoomColors, rooms keep their environment colour (memoised per env
    // for this level) and exits use the regular line colour.
    const envPaint = new Map<number, string>();
    const roomPaint = (room: MapData.Room): string => {
        if (!cfg.useRoomColors) return paintColor;
        let c = envPaint.get(room.env);
        if (c === undefined) {
            c = hexToRgba(mapReader.getColorValue(room.env), alpha);
            envPaint.set(room.env, c);
        }
        return c;
    };
    const exitPaint = cfg.useRoomColors ? hexToRgba(settings.lineColor, alpha) : paintColor;

    if (cfg.exits) {
        const areaId = area.getAreaId();
        for (const exit of area.getLinkExits(z)) {
            const a = mapReader.getRoom(exit.a);
            const b = mapReader.getRoom(exit.b);
            // Straight centre-to-centre connectors only for exits that stay on
            // this level and inside this area; everything else is noise at
            // silhouette fidelity.
            if (!a || !b || a.z !== z || b.z !== z || a.area !== areaId || b.area !== areaId) continue;
            if (!isVisible(a) || !isVisible(b)) continue;
            // Trim both ends to the room edge: the fill is translucent, so a
            // centre-to-centre line would show through the room body.
            const lx = b.x - a.x, ly = b.y - a.y;
            const len = Math.hypot(lx, ly);
            if (len === 0) continue;
            const ux = lx / len, uy = ly / len;
            const trim = settings.roomShape === "circle"
                ? settings.roomSize / 2
                : settings.roomSize / 2 / Math.max(Math.abs(ux), Math.abs(uy));
            if (len <= trim * 2) continue;
            const x1 = a.x + ux * trim + dx, y1 = a.y + uy * trim + dy;
            const x2 = b.x - ux * trim + dx, y2 = b.y - uy * trim + dy;
            out.push({
                shape: {
                    type: "line",
                    layer: "link",
                    points: [x1, y1, x2, y2],
                    paint: {stroke: exitPaint, strokeWidth: settings.lineWidth},
                },
                bounds: {
                    x: Math.min(x1, x2), y: Math.min(y1, y2),
                    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
                },
            });
        }
    }

    const rs = settings.roomSize;
    const half = rs / 2;
    for (const room of rooms) {
        const fill = roomPaint(room);
        const cx = room.x + dx;
        const cy = room.y + dy;
        const shape: Shape = settings.roomShape === "circle"
            ? {type: "circle", layer: "link", cx, cy, radius: half, paint: {fill}}
            : {
                type: "rect", layer: "link",
                x: cx - half, y: cy - half, width: rs, height: rs,
                cornerRadius: settings.roomShape === "roundedRectangle" ? rs * 0.2 : undefined,
                paint: {fill},
            };
        out.push({shape, bounds: {x: cx - half, y: cy - half, width: rs, height: rs}});
    }
}
