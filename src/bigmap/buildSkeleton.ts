import type {MapSkeleton} from "./Skeleton";
import {SKELETON_DIRS} from "./Skeleton";

const hasKeys = (o: Record<string, unknown> | undefined | null): boolean =>
    !!o && Object.keys(o).length > 0;

/**
 * Default detail promotion: a room is materialised in full only if it carries
 * visual detail the skeleton columns can't describe. Everything else (plain
 * terrain) renders from the compact columns alone.
 */
export function hasVisualDetail(room: MapData.Room): boolean {
    return !!room.roomChar || hasKeys(room.customLines) || hasKeys(room.specialExits) ||
        (room.stubs?.length ?? 0) > 0 || hasKeys(room.doors) || (room.exitLocks?.length ?? 0) > 0;
}

export interface BuildSkeletonOptions {
    /** Override which rooms are promoted to full-detail (default: {@link hasVisualDetail}). */
    isDetailRoom?: (room: MapData.Room) => boolean;
    /** Area ids to mark as adjacency grids (cardinal exit lines suppressed). */
    gridAreas?: number[];
}

/**
 * Eagerly build a {@link MapSkeleton} from an already-parsed map — the same
 * `(map, envs)` inputs the concrete `MapReader` constructor takes. Use this
 * when the map parses fine but is too dense to render as one Konva scene;
 * pair the result with `SkeletonMapReader` and `settings.lodEnabled`.
 *
 * The output is raw map space (room `y` copied verbatim). Detail rooms are
 * cloned, so the input map data is never mutated.
 */
export function buildSkeleton(
    map: MapData.Map,
    envs: MapData.Env[] = [],
    options: BuildSkeletonOptions = {},
): MapSkeleton {
    const isDetail = options.isDetailRoom ?? hasVisualDetail;

    let count = 0;
    for (const area of map) count += area.rooms.length;

    const x = new Int32Array(count), y = new Int32Array(count), z = new Int32Array(count);
    const areaCol = new Int32Array(count), env = new Int32Array(count), id = new Int32Array(count);
    const exits = new Int32Array(count * 12).fill(-1);
    const names: string[] = new Array(count);
    const userData: {id: number; data: Record<string, string>}[] = [];
    const detailRooms: MapData.Room[] = [];
    const labels: MapData.Label[] = [];
    const areaNames: Record<number, string> = {};

    let i = 0;
    for (const area of map) {
        const areaId = parseInt(area.areaId);
        areaNames[areaId] = area.areaName;
        for (const label of area.labels ?? []) {
            labels.push({...label, areaId: label.areaId ?? areaId});
        }
        for (const room of area.rooms) {
            x[i] = room.x;
            y[i] = room.y;
            z[i] = room.z;
            areaCol[i] = room.area;
            env[i] = room.env;
            id[i] = room.id;
            const base = i * 12;
            for (let d = 0; d < 12; d++) {
                const t = room.exits?.[SKELETON_DIRS[d]];
                if (t !== undefined) exits[base + d] = t;
            }
            names[i] = room.name ?? "";
            if (hasKeys(room.userData)) userData.push({id: room.id, data: room.userData});
            if (isDetail(room)) detailRooms.push({...room});
            i++;
        }
    }

    const customEnvColors: Record<number, {r: number; g: number; b: number}> = {};
    for (const e of envs) {
        customEnvColors[e.envId] = {r: e.colors[0], g: e.colors[1], b: e.colors[2]};
    }

    const areaGridMode: Record<number, boolean> = {};
    for (const a of options.gridAreas ?? []) areaGridMode[a] = true;

    return {
        count, x, y, z, area: areaCol, env, id, exits,
        areaNames, areaGridMode, customEnvColors,
        names, userData, detailRooms, labels,
    };
}
