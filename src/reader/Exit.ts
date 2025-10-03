export type Kind = "exit" | "specialExit";

export default interface Exit {
    a: number;
    b: number;
    aDir?: MapData.direction;
    bDir?: MapData.direction;
    kind?: Kind;
    zIndex: number[];
}

export const regularExits: MapData.direction[] = ["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];
export const shortTolong: Record<string, MapData.direction> = {
    "n": "north",
    "s": "south",
    "e": "east",
    "w": "west",
    "ne": "northeast",
    "nw": "northwest",
    "se": "southeast",
    "sw": "southwest",
}
export const longToShort: Record<MapData.direction, string> = {
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
    "northeast": "ne",
    "northwest": "nw",
    "southeast": "se",
    "southwest": "sw",
    "up": "u",
    "down": "d",
    "in": "i",
    "out": "o"
}
