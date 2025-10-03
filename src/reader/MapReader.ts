import Area from "./Area";
import ExplorationArea from "./ExplorationArea";

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

export default class MapReader {

    private rooms: Record<number, MapData.Room> = {};
    private areas: Record<number, Area> = {};
    private areaSources: Record<number, MapData.Area> = {};
    private visitedRooms?: Set<number>;
    private colors: Record<number, Color> = {};

    constructor(map: MapData.Map, envs: MapData.Env[]) {
        map.forEach(area => {
            area.rooms.forEach(room => {
                room.y = -room.y;
                this.rooms[room.id] = room;
            })
            const areaId = parseInt(area.areaId);
            this.areas[areaId] = new Area(area);
            this.areaSources[areaId] = area;
        })
        this.colors = envs.reduce((acc, c) => ({
            ...acc,
            [c.envId]: {
                rgb: c.colors,
                rgbValue: `rgb(${c.colors.join(',')}`,
                symbolColor: calculateLuminance(c.colors) > 0.41 ? [25, 25, 25] : [225, 255, 255],
                symbolColorValue: calculateLuminance(c.colors) > 0.41 ? 'rgb(25,25,25)' : 'rgb(225,255,255)'
            }
        }), {});
    }

    getArea(areaId: number) {
        return this.areas[areaId];
    }

    getExplorationArea(areaId: number) {
        const area = this.areas[areaId];
        if (area instanceof ExplorationArea) {
            return area;
        }
        return undefined;
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

    decorateWithExploration(visitedRooms?: Iterable<number> | Set<number>) {
        this.visitedRooms = visitedRooms instanceof Set ? visitedRooms : new Set(visitedRooms ?? []);
        Object.entries(this.areaSources).forEach(([id, area]) => {
            const numericId = parseInt(id, 10);
            this.areas[numericId] = new ExplorationArea(area, this.visitedRooms);
        });
        return this.visitedRooms;
    }

    getVisitedRooms() {
        return this.visitedRooms;
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