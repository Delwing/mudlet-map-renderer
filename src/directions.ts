export type PlanarDirection =
    | "north"
    | "south"
    | "east"
    | "west"
    | "northeast"
    | "northwest"
    | "southeast"
    | "southwest";

const planarDirectionOffsets: Record<PlanarDirection, {x: number; y: number}> = {
    north: {x: 0, y: -1},
    south: {x: 0, y: 1},
    east: {x: 1, y: 0},
    west: {x: -1, y: 0},
    northeast: {x: 1, y: -1},
    northwest: {x: -1, y: -1},
    southeast: {x: 1, y: 1},
    southwest: {x: -1, y: 1},
};

export const planarDirections: PlanarDirection[] = [
    "north",
    "south",
    "east",
    "west",
    "northeast",
    "northwest",
    "southeast",
    "southwest",
];

export const oppositeDirections: Record<PlanarDirection, PlanarDirection> = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
    northeast: "southwest",
    northwest: "southeast",
    southeast: "northwest",
    southwest: "northeast",
};

function isPlanarDirection(direction: MapData.direction | undefined): direction is PlanarDirection {
    if (!direction) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(planarDirectionOffsets, direction);
}

export function movePoint(
    x: number,
    y: number,
    direction?: MapData.direction,
    distance: number = 1,
) {
    if (!isPlanarDirection(direction)) {
        return {x, y};
    }

    const offset = planarDirectionOffsets[direction];
    return {
        x: x + offset.x * distance,
        y: y + offset.y * distance,
    };
}
