import Room = MapData.Room;
import Area from "./Area";

interface Color {
    rgb: number[];
    rgbValue: string;
}

const defaultColor: Color = {
    rgb: [114, 1, 0],
    rgbValue: 'rgb(114, 1, 0)'
}



export default class MapReader {

    private rooms: Record<number, MapData.Room> = {};
    private areas: Record<number, Area> = {};
    private colors: Record<number, Color> = {};

    constructor(map: MapData.Map, envs: MapData.Env[]) {
        map.forEach(area => {
            area.rooms.forEach(room => {
                this.rooms[room.id] = room;
            })
            this.areas[parseInt(area.areaId)] = new Area(area);
        })
        this.colors = envs.reduce((acc, c) => ({
            ...acc,
            [c.envId]: {rgb: c.colors, rgbValue: `rgb(${c.colors.join(',')}`}
        }), {});

    }

    getArea(areaId: number) {
        return this.areas[areaId];
    }

    getRoom(roomId: number) {
        return this.rooms[roomId];
    }

    getColorValue(envId: number): string {
        return this.colors[envId]?.rgbValue ?? defaultColor.rgbValue;
    }

}