import Konva from "konva";
import MapReader from "./reader/MapReader";
import {Settings} from "./Renderer";
import {movePoint, PlanarDirection, planarDirections, oppositeDirections} from "./directions";

export default class PathRenderer {
    private readonly mapReader: MapReader;
    private readonly overlayLayer: Konva.Layer;
    private paths: Konva.Line[] = [];

    constructor(mapReader: MapReader, overlayLayer: Konva.Layer) {
        this.mapReader = mapReader;
        this.overlayLayer = overlayLayer;
    }

    renderPath(locations: number[], currentArea?: number, currentZIndex?: number) {
        if (currentArea === undefined || currentZIndex === undefined) {
            return;
        }

        const rooms = locations
            .map(location => this.mapReader.getRoom(location))
            .filter((room): room is MapData.Room => room !== undefined);

        const segments: number[][] = [];
        let currentSegment: number[] | null = null;

        const finalizeSegment = () => {
            if (!currentSegment) {
                return;
            }
            if (currentSegment.length < 4) {
                segments.pop();
            }
            currentSegment = null;
        };

        const ensureSegment = () => {
            if (!currentSegment) {
                currentSegment = [];
                segments.push(currentSegment);
            }
            return currentSegment;
        };

        rooms.forEach((room, index) => {
            if (!this.isRoomVisible(room, currentArea, currentZIndex)) {
                return;
            }

            const previousRoom = index > 0 ? rooms[index - 1] : undefined;
            const nextRoom = index < rooms.length - 1 ? rooms[index + 1] : undefined;
            const previousVisible = this.isRoomVisible(previousRoom, currentArea, currentZIndex);

            if (!previousVisible) {
                finalizeSegment();
                const segment = ensureSegment();
                if (previousRoom) {
                    const directionToPrevious = this.getDirectionTowards(room, previousRoom);
                    if (directionToPrevious) {
                        const startPoint = movePoint(room.x, room.y, directionToPrevious, Settings.roomSize);
                        segment.push(startPoint.x, startPoint.y);
                    }
                }
            } else {
                ensureSegment();
            }

            currentSegment?.push(room.x, room.y);

            const nextVisible = this.isRoomVisible(nextRoom, currentArea, currentZIndex);
            if (!nextVisible && nextRoom) {
                const directionToNext = this.getDirectionTowards(room, nextRoom);
                if (directionToNext) {
                    const endPoint = movePoint(room.x, room.y, directionToNext, Settings.roomSize);
                    currentSegment?.push(endPoint.x, endPoint.y);
                }
                finalizeSegment();
            }
        });

        finalizeSegment();

        const paths = segments
            .filter(points => points.length >= 4)
            .map(points => new Konva.Line({
                points,
                stroke: 'green',
                strokeWidth: 0.1
            }));

        paths.forEach(path => {
            this.overlayLayer.add(path);
            this.paths.push(path);
        });

        return paths[0];
    }

    clearPaths() {
        this.paths.forEach(path => {
            path.destroy();
        });
        this.paths = [];
    }

    private isRoomVisible(room: MapData.Room | undefined, currentArea: number | undefined, currentZIndex: number | undefined) {
        if (!room) {
            return false;
        }
        return room.area === currentArea && room.z === currentZIndex;
    }

    private getDirectionTowards(from: MapData.Room, to: MapData.Room): PlanarDirection | undefined {
        for (const direction of planarDirections) {
            if (from.exits[direction] === to.id) {
                return direction;
            }
        }

        for (const direction of planarDirections) {
            if (to.exits[direction] === from.id) {
                return oppositeDirections[direction];
            }
        }

        return undefined;
    }
}
