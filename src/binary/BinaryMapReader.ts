import {
    type MudletMap,
    readerExport,
    readMapFromBuffer,
} from "mudlet-map-binary-reader";
import MapReader, {type IMapReader} from "../reader/MapReader";
import type {IArea} from "../reader/Area";
import type {IExplorationArea} from "../reader/ExplorationArea";

/**
 * {@link IMapReader} implementation backed by a parsed Mudlet binary map.
 *
 * Convenience wrapper around the existing {@link MapReader} that converts a
 * {@link MudletMap} (the in-memory binary model from
 * `mudlet-map-binary-reader`) into the renderer's `{mapData, colors}` shape
 * via `readerExport()`, then forwards every `IMapReader` call to the wrapped
 * reader.
 *
 * Useful for downstream apps (the upstream Mudix client is one) that already
 * own binary `.dat` bytes and want a single object they can hand to
 * {@link MapRenderer} without staging a separate JSON export step.
 *
 * `mudlet-map-binary-reader` is a `peerDependency`; consumers who do not use
 * binary maps never pay the bundle cost.
 */
export default class BinaryMapReader implements IMapReader {
    private readonly reader: MapReader;

    /** Build directly from a parsed {@link MudletMap}. */
    constructor(model: MudletMap) {
        const {mapData, colors} = readerExport(model);
        // RendererRoom (binary-reader output) and MapData.Room (renderer
        // input) overlap structurally — RendererRoom is missing only
        // `areaId`, which the renderer never reads from rooms (only from
        // the area). Cast through `unknown` to bridge the nominal gap.
        this.reader = new MapReader(mapData as unknown as MapData.Map, colors);
    }

    /**
     * Parse the given binary map buffer and construct a reader from it.
     * In Node, pass `fs.readFileSync(path)`; in the browser, construct a
     * `Buffer` from an `ArrayBuffer` (e.g. via the `buffer` polyfill).
     */
    static fromBuffer(buf: Parameters<typeof readMapFromBuffer>[0]): BinaryMapReader {
        return new BinaryMapReader(readMapFromBuffer(buf));
    }

    // --- IMapReader forwarding ---

    getArea(areaId: number): IArea {
        return this.reader.getArea(areaId);
    }

    getExplorationArea(areaId: number): IExplorationArea | undefined {
        return this.reader.getExplorationArea(areaId);
    }

    getAreas(): IArea[] {
        return this.reader.getAreas();
    }

    getRooms(): MapData.Room[] {
        return this.reader.getRooms();
    }

    getRoom(roomId: number): MapData.Room {
        return this.reader.getRoom(roomId);
    }

    decorateWithExploration(visitedRooms?: Iterable<number> | Set<number>): Set<number> | undefined {
        return this.reader.decorateWithExploration(visitedRooms);
    }

    getVisitedRooms(): Set<number> | undefined {
        return this.reader.getVisitedRooms();
    }

    clearExplorationDecoration(): void {
        this.reader.clearExplorationDecoration();
    }

    isExplorationEnabled(): boolean {
        return this.reader.isExplorationEnabled();
    }

    setVisitedRooms(visitedRooms: Iterable<number> | Set<number>): Set<number> {
        return this.reader.setVisitedRooms(visitedRooms);
    }

    addVisitedRoom(roomId: number): boolean {
        return this.reader.addVisitedRoom(roomId);
    }

    addVisitedRooms(roomIds: Iterable<number>): number {
        return this.reader.addVisitedRooms(roomIds);
    }

    hasVisitedRoom(roomId: number): boolean {
        return this.reader.hasVisitedRoom(roomId);
    }

    getColorValue(envId: number): string {
        return this.reader.getColorValue(envId);
    }

    getSymbolColor(envId: number, opacity?: number): string {
        return this.reader.getSymbolColor(envId, opacity);
    }
}
