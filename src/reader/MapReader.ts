import Area, {IArea} from "./Area";

/**
 * Public, renderer-facing surface for map data. Everything the renderer
 * (and other library consumers) call on `MapReader` is on this interface —
 * private state and internal helpers are not.
 *
 * Downstream apps with their own room/area store can implement `IMapReader`
 * directly (no need to subclass {@link MapReader}) and hand the result to
 * {@link MapRenderer}. Visibility filtering (exploration, scope overlays,
 * etc.) lives on the renderer's lens — it is intentionally not on this
 * interface.
 */
export interface IMapReader {
    getArea(areaId: number): IArea;
    getAreas(): IArea[];
    getRooms(): MapData.Room[];
    getRoom(roomId: number): MapData.Room;
    /** Returns the env's `rgb(r,g,b)` string, or a default colour if the env id is unknown. */
    getColorValue(envId: number): string;
    /** Returns a contrasting symbol colour for the env, optionally with the given alpha. */
    getSymbolColor(envId: number, opacity?: number): string;
}

interface Color {
    rgb: number[];
    rgbValue: string;
    symbolColor: number[];
    symbolColorValue: string,
}

const defaultColor: Color = {
    rgb: [114, 1, 0],
    rgbValue: 'rgb(114, 1, 0)',
    symbolColor: [225, 225, 225],
    symbolColorValue: 'rgb(225,225,225)'
}

function calculateLuminance(rgb: number[]) {
    const rn = rgb[0] / 255;
    const gn = rgb[1] / 255;
    const bn = rgb[2] / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);

    return (max + min) / 2;
}

export default class MapReader implements IMapReader {

    private rooms: Record<number, MapData.Room> = {};
    private areas: Record<number, Area> = {};
    private colors: Record<number, Color> = {};

    constructor(map: MapData.Map, envs: MapData.Env[]) {
        map.forEach(area => {
            const clonedArea: MapData.Area = {
                ...area,
                rooms: area.rooms.map(room => ({ ...room, y: -room.y })),
            };
            clonedArea.rooms.forEach(room => {
                this.rooms[room.id] = room;
            });
            const areaId = parseInt(area.areaId);
            this.areas[areaId] = new Area(clonedArea);
        })
        this.colors = envs.reduce((acc, c) => ({
            ...acc,
            [c.envId]: {
                rgb: c.colors,
                rgbValue: `rgb(${c.colors.join(',')})`,
                symbolColor: calculateLuminance(c.colors) > 0.41 ? [25, 25, 25] : [225, 255, 255],
                symbolColorValue: calculateLuminance(c.colors) > 0.41 ? 'rgb(25,25,25)' : 'rgb(225,255,255)'
            }
        }), {});
    }

    getArea(areaId: number) {
        return this.areas[areaId];
    }

    getAreas() {
        return Object.values(this.areas);
    }

    getRooms() {
        return Object.values(this.rooms);
    }

    getRoom(roomId: number) {
        return this.rooms[roomId];
    }

    getColorValue(envId: number): string {
        return this.colors[envId]?.rgbValue ?? defaultColor.rgbValue;
    }

    getSymbolColor(envId: number, opacity?: number): string {
        const color = this.colors[envId]?.symbolColor ?? defaultColor.symbolColor;
        const normalizedOpacity = Math.min(Math.max(opacity ?? 1, 0), 1);
        const value = color.join(',');
        if (normalizedOpacity != 1) {
            return `rgba(${value}, ${normalizedOpacity})`;
        }
        return `rgba(${value})`;
    }

}
