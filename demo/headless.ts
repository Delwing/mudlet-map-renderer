import "konva/canvas-backend";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MapRenderer, createSettings, PathFinder, SvgExporter, CanvasExporter, canvasToBytes } from "@src";
import MapReader from "@src/reader/MapReader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI argument parsing ---

function parseArgs(argv: string[]) {
    const args = {
        area: undefined as number | undefined,
        z: undefined as number | undefined,
        room: undefined as number | undefined,
        highlights: [] as number[],
        pathFrom: undefined as number | undefined,
        pathTo: undefined as number | undefined,
        format: "svg" as "svg" | "png",
        output: undefined as string | undefined,
        width: 1920,
        height: 1080,
        padding: undefined as number | undefined,
        // Settings flags
        frameMode: false,
        emboss: false,
        roomShape: "rectangle" as "rectangle" | "circle" | "roundedRectangle",
        grid: false,
        labelMode: "image" as "image" | "data",
        bgColor: undefined as string | undefined,
        lineColor: undefined as string | undefined,
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        switch (arg) {
            case "--area":
                args.area = parseInt(next, 10);
                i++;
                break;
            case "--z":
                args.z = parseInt(next, 10);
                i++;
                break;
            case "--room":
                args.room = parseInt(next, 10);
                i++;
                break;
            case "--highlight":
                args.highlights.push(parseInt(next, 10));
                i++;
                break;
            case "--path": {
                const [from, to] = (next ?? "").split(",").map(s => parseInt(s, 10));
                args.pathFrom = from;
                args.pathTo = to;
                i++;
                break;
            }
            case "--format":
                if (next === "png" || next === "svg") args.format = next;
                i++;
                break;
            case "--output":
                args.output = next;
                i++;
                break;
            case "--width":
                args.width = parseInt(next, 10);
                i++;
                break;
            case "--height":
                args.height = parseInt(next, 10);
                i++;
                break;
            case "--padding":
                args.padding = parseInt(next, 10);
                i++;
                break;
            case "--frame-mode":
                args.frameMode = true;
                break;
            case "--emboss":
                args.emboss = true;
                break;
            case "--room-shape":
                if (next === "circle" || next === "roundedRectangle" || next === "rectangle") args.roomShape = next;
                i++;
                break;
            case "--grid":
                args.grid = true;
                break;
            case "--label-mode":
                if (next === "image" || next === "data") args.labelMode = next;
                i++;
                break;
            case "--bg-color":
                args.bgColor = next;
                i++;
                break;
            case "--line-color":
                args.lineColor = next;
                i++;
                break;
            case "--help":
                printUsage();
                process.exit(0);
        }
    }

    return args;
}

function printUsage() {
    console.log(`Usage: tsx demo/headless.ts [options]

Options:
  --area <id>         Area ID to render
  --z <level>         Z-level (default: 0, or auto from --room)
  --room <id>         Room ID for position marker (auto-selects area/z)
  --highlight <id>    Highlight a room (repeatable)
  --path <from>,<to>  Render pathfinding between two rooms
  --format svg|png    Output format (default: svg)
  --output <file>     Output filename (default: map.svg or map.png)
  --width <px>        PNG width (default: 1920)
  --height <px>       PNG height (default: 1080)
  --padding <units>   Padding around the view in map units (default: 3)

  Settings:
  --frame-mode        Frame rendering: rooms outlined instead of filled
  --emboss            3D emboss effect on rooms
  --room-shape <s>    rectangle | circle | roundedRectangle (default: rectangle)
  --grid              Show background grid
  --label-mode <m>    image | data (default: image)
  --bg-color <hex>    Background color (e.g. #1a1a2e)
  --line-color <rgb>  Line color (e.g. "rgb(200,200,255)")

  --help              Show this help

When --room is specified, the export is centered on that room and cropped
to the surrounding area (controlled by --padding). Without --room, the
full area is exported.

Examples:
  tsx demo/headless.ts --area 57
  tsx demo/headless.ts --room 3287 --format png
  tsx demo/headless.ts --room 3287 --frame-mode --room-shape circle
  tsx demo/headless.ts --area 17 --emboss --grid --format png`);
}

// --- Main ---

const DEFAULT_ROOM_ID = 3287;

async function main() {
    const args = parseArgs(process.argv);

    // Load data
    const mapDataPath = path.join(__dirname, "mapExport.json");
    const colorDataPath = path.join(__dirname, "colors.json");

    if (!fs.existsSync(mapDataPath)) {
        console.error(`Map data not found: ${mapDataPath}`);
        process.exit(1);
    }

    console.log("Loading map data...");
    const mapData = JSON.parse(fs.readFileSync(mapDataPath, "utf-8")) as MapData.Map;
    const colorData = JSON.parse(fs.readFileSync(colorDataPath, "utf-8")) as MapData.Env[];

    const mapReader = new MapReader(mapData, colorData);
    const settings = createSettings();
    settings.areaName = true;
    settings.highlightCurrentRoom = false;
    settings.frameMode = args.frameMode;
    settings.emboss = args.emboss;
    settings.roomShape = args.roomShape;
    settings.gridEnabled = args.grid;
    settings.labelRenderMode = args.labelMode;
    if (args.bgColor) settings.backgroundColor = args.bgColor;
    if (args.lineColor) settings.lineColor = args.lineColor;
    const renderer = new MapRenderer(mapReader, settings);

    // Determine area and z from --room or --area/--z
    let areaId = args.area;
    let zLevel = args.z;

    if (args.room !== undefined) {
        const room = mapReader.getRoom(args.room);
        if (!room) {
            console.error(`Room ${args.room} not found.`);
            process.exit(1);
        }
        if (areaId === undefined) areaId = room.area;
        if (zLevel === undefined) zLevel = room.z;
    }

    if (areaId === undefined) {
        const defaultRoom = mapReader.getRoom(DEFAULT_ROOM_ID);
        if (defaultRoom) {
            areaId = defaultRoom.area;
            if (zLevel === undefined) zLevel = defaultRoom.z;
        } else {
            console.error("No --area or --room specified and default room not found.");
            process.exit(1);
        }
    }
    if (zLevel === undefined) zLevel = 0;

    const area = mapReader.getArea(areaId!);
    if (!area) {
        console.error(`Area ${areaId} not found.`);
        process.exit(1);
    }

    console.log(`Rendering area ${areaId} (${area.getAreaName() ?? "unnamed"}), z=${zLevel}`);
    renderer.drawArea(areaId!, zLevel);

    // Position marker
    if (args.room !== undefined) {
        renderer.setPosition(args.room);
        console.log(`Position marker on room ${args.room}`);
    }

    // Highlights
    for (const id of args.highlights) {
        renderer.renderHighlight(id, "yellow");
        console.log(`Highlighted room ${id}`);
    }

    // Pathfinding
    if (args.pathFrom !== undefined && args.pathTo !== undefined) {
        const pathFinder = new PathFinder(mapReader);
        const pathResult = pathFinder.findPath(args.pathFrom, args.pathTo);
        if (pathResult) {
            renderer.renderPath(pathResult, "#66E64D");
            console.log(`Path: ${args.pathFrom} → ${args.pathTo} (${pathResult.length - 1} steps)`);
        } else {
            console.warn(`No path found from ${args.pathFrom} to ${args.pathTo}`);
        }
    }

    // Export
    const defaultFilename = `map.${args.format}`;
    const outputPath = path.resolve(args.output ?? defaultFilename);
    const exportPadding = args.padding ?? 3;

    if (args.format === "svg") {
        const svg = renderer.export(new SvgExporter({ roomId: args.room, padding: exportPadding }));
        if (!svg) {
            console.error("SVG export failed.");
            process.exit(1);
        }
        fs.writeFileSync(outputPath, svg, "utf-8");
        console.log(`SVG written to ${outputPath}`);
    } else {
        // PNG via headless Konva (uses canvas package internally)
        const canvas = renderer.export(new CanvasExporter({
            width: args.width,
            height: args.height,
            roomId: args.room,
            padding: exportPadding,
        }));
        if (!canvas) {
            console.error("PNG export failed.");
            process.exit(1);
        }

        fs.writeFileSync(outputPath, canvasToBytes(canvas));
        console.log(`PNG (${args.width}x${args.height}) written to ${outputPath}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
