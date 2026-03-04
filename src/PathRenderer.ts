import Konva from "konva";
import MapReader from "./reader/MapReader";
import type {Settings} from "./Renderer";
import {movePoint} from "./directions";
import {computePathData} from "./PathData";

const innerExits: MapData.direction[] = ["up", "down", "in", "out"];

export default class PathRenderer {
    private readonly mapReader: MapReader;
    private readonly overlayLayer: Konva.Layer;
    private readonly settings: Settings;
    private paths: (Konva.Shape | Konva.Group)[] = [];

    constructor(mapReader: MapReader, overlayLayer: Konva.Layer, settings: Settings) {
        this.mapReader = mapReader;
        this.overlayLayer = overlayLayer;
        this.settings = settings;
    }

    private createStrokedLine(points: number[], color: string): Konva.Group {
        const group = new Konva.Group();
        group.opacity(0.8);

        group.add(new Konva.Line({
            points,
            stroke: 'black',
            strokeWidth: this.settings.lineWidth * 8,
            lineCap: 'round',
            lineJoin: 'round',
        }));

        group.add(new Konva.Line({
            points,
            stroke: color,
            strokeWidth: this.settings.lineWidth * 4,
            lineCap: 'round',
            lineJoin: 'round',
        }));

        return group;
    }

    private renderInnerExitMarker(room: MapData.Room, direction: MapData.direction, color: string): Konva.Group {
        const group = new Konva.Group();
        group.opacity(0.8);

        const triangle = new Konva.RegularPolygon({
            x: room.x,
            y: room.y,
            sides: 3,
            fill: color,
            stroke: 'black',
            strokeWidth: this.settings.lineWidth * 2,
            radius: this.settings.roomSize / 5,
            scaleX: 1.4,
            scaleY: 0.8,
        });

        switch (direction) {
            case "up":
                triangle.position(movePoint(room.x, room.y, "south", this.settings.roomSize / 4));
                break;
            case "down":
                triangle.rotation(180);
                triangle.position(movePoint(room.x, room.y, "north", this.settings.roomSize / 4));
                break;
            case "in": {
                const inTriangle = triangle.clone();
                inTriangle.rotation(-90);
                inTriangle.position(movePoint(room.x, room.y, "east", this.settings.roomSize / 4));
                group.add(inTriangle);
                triangle.rotation(90);
                triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                break;
            }
            case "out": {
                const outTriangle = triangle.clone();
                outTriangle.rotation(90);
                outTriangle.position(movePoint(room.x, room.y, "east", this.settings.roomSize / 4));
                group.add(outTriangle);
                triangle.rotation(-90);
                triangle.position(movePoint(room.x, room.y, "west", this.settings.roomSize / 4));
                break;
            }
        }

        group.add(triangle);
        return group;
    }

    renderPath(locations: number[], currentArea?: number, currentZIndex?: number, color: string = '#66E64D') {
        if (currentArea === undefined || currentZIndex === undefined) {
            return;
        }

        const result = computePathData(this.mapReader, this.settings, locations, currentArea, currentZIndex);

        // Render segments as stroked lines
        for (const segment of result.segments) {
            const path = this.createStrokedLine(segment.points, color);
            this.overlayLayer.add(path);
            this.paths.push(path);
        }

        // Render custom lines from inner connections
        for (const cl of result.customLines) {
            const path = this.createStrokedLine(cl.points, color);
            this.overlayLayer.add(path);
            this.paths.push(path);
        }

        // Render inner exit markers
        for (const marker of result.innerMarkers) {
            const rendered = this.renderInnerExitMarker(marker.room, marker.direction, color);
            this.overlayLayer.add(rendered);
            this.paths.push(rendered);
        }

        return this.paths[0];
    }

    clearPaths() {
        this.paths.forEach(path => {
            path.destroy();
        });
        this.paths = [];
    }
}
