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

/**
 * Calculate the edge point of a rounded rectangle for a given direction.
 * Cardinal directions use the flat edge (same as rectangle).
 * Diagonal directions intersect the corner arc.
 */
export function movePointRoundedRect(
    x: number,
    y: number,
    direction?: MapData.direction,
    distance: number = 1,
    cornerRadius: number = 0,
) {
    if (!isPlanarDirection(direction)) {
        return {x, y};
    }

    const offset = planarDirectionOffsets[direction];
    const isDiagonal = offset.x !== 0 && offset.y !== 0;

    if (!isDiagonal || cornerRadius <= 0) {
        return movePoint(x, y, direction, distance);
    }

    // For diagonal directions, find the point on the rounded corner arc.
    // Arc center is (distance - r) from room center along each axis.
    // The intersection with a 45° line from center is at arcCenter + r/√2.
    const edgeDist = (distance - cornerRadius) + cornerRadius / Math.SQRT2;

    return {
        x: x + offset.x * edgeDist,
        y: y + offset.y * edgeDist,
    };
}

/**
 * Calculate the edge point of a circle for a given direction
 * For circles, we need to calculate the exact point on the circle's circumference
 * based on the angle to the direction
 */
export function movePointCircle(
    x: number,
    y: number,
    direction?: MapData.direction,
    radius: number = 1,
) {
    if (!isPlanarDirection(direction)) {
        return {x, y};
    }

    const offset = planarDirectionOffsets[direction];
    // Calculate the angle from the direction offset
    const angle = Math.atan2(offset.y, offset.x);

    // Calculate the point on the circle's edge
    return {
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius,
    };
}
