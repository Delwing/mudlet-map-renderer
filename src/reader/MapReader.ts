import Area, {IArea} from "./Area";
import ExplorationArea, {IExplorationArea} from "./ExplorationArea";

/**
 * Public, renderer-facing surface for map data. Everything the renderer
 * (and other library consumers) call on `MapReader` is on this interface —
 * private state and internal helpers are not.
 *
 * Downstream apps with their own room/area store can implement `IMapReader`
 * directly (no need to subclass {@link MapReader}) and hand the result to
 * {@link MapRenderer}.
 */
export interface IMapReader {
    getArea(areaId: number): IArea;
    getExplorationArea(areaId: number): IExplorationArea | undefined;
    getAreas(): IArea[];
    getRooms(): MapData.Room[];
    getRoom(roomId: number): MapData.Room;
    decorateWithExploration(visitedRooms?: Iterable<number> | Set<number>): Set<number> | undefined;
    getVisitedRooms(): Set<number> | undefined;
    clearExplorationDecoration(): void;
    isExplorationEnabled(): boolean;
    setVisitedRooms(visitedRooms: Iterable<number> | Set<number>): Set<number>;
    addVisitedRoom(roomId: number): boolean;
    addVisitedRooms(roomIds: Iterable<number>): number;
    hasVisitedRoom(roomId: number): boolean;
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
    private areaSources: Record<number, MapData.Area> = {};
    private visitedRooms?: Set<number>;
    private explorationEnabled = false;
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
            this.areaSources[areaId] = clonedArea;
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

    private ensureVisitedRooms() {
        if (!this.visitedRooms) {
            this.visitedRooms = new Set();
        }
        return this.visitedRooms;
    }

    private applyExplorationDecoration() {
        if (!this.visitedRooms) {
            return;
        }
        Object.entries(this.areaSources).forEach(([id, area]) => {
            const numericId = parseInt(id, 10);
            this.areas[numericId] = new ExplorationArea(area, this.visitedRooms);
        });
    }

    decorateWithExploration(visitedRooms?: Iterable<number> | Set<number>) {
        if (visitedRooms !== undefined) {
            this.setVisitedRooms(visitedRooms);
        } else {
            this.ensureVisitedRooms();
        }
        this.applyExplorationDecoration();
        this.explorationEnabled = true;
        return this.visitedRooms;
    }

    getVisitedRooms() {
        return this.visitedRooms;
    }

    clearExplorationDecoration() {
        Object.entries(this.areaSources).forEach(([id, area]) => {
            const numericId = parseInt(id, 10);
            this.areas[numericId] = new Area(area);
        });
        this.explorationEnabled = false;
    }

    isExplorationEnabled() {
        return this.explorationEnabled;
    }

    setVisitedRooms(visitedRooms: Iterable<number> | Set<number>) {
        this.visitedRooms = visitedRooms instanceof Set ? visitedRooms : new Set(visitedRooms);
        if (this.explorationEnabled) {
            this.applyExplorationDecoration();
        }
        return this.visitedRooms;
    }

    addVisitedRoom(roomId: number) {
        if (this.explorationEnabled) {
            const room = this.getRoom(roomId);
            if (room) {
                const area = this.getExplorationArea(room.area);
                if (area) {
                    return area.addVisitedRoom(roomId);
                }
            }
        }
        const visitedRooms = this.ensureVisitedRooms();
        const wasVisited = visitedRooms.has(roomId);
        visitedRooms.add(roomId);
        return !wasVisited;
    }

    addVisitedRooms(roomIds: Iterable<number>) {
        const visitedRooms = this.ensureVisitedRooms();
        let newlyVisited = 0;
        for (const roomId of roomIds) {
            if (this.explorationEnabled) {
                const room = this.getRoom(roomId);
                if (room) {
                    const area = this.getExplorationArea(room.area);
                    if (area) {
                        if (area.addVisitedRoom(roomId)) {
                            newlyVisited++;
                        }
                        continue;
                    }
                }
            }
            const wasVisited = visitedRooms.has(roomId);
            visitedRooms.add(roomId);
            if (!wasVisited) {
                newlyVisited++;
            }
        }
        return newlyVisited;
    }

    hasVisitedRoom(roomId: number) {
        return this.visitedRooms?.has(roomId) ?? false;
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