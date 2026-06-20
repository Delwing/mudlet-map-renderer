import {
    type MudletMap,
    readerExport,
    readMapFromBuffer,
} from "mudlet-map-binary-reader";
import MapReader, {type IMapReader} from "../reader/MapReader";
import type {IArea} from "../reader/Area";

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
     * Accepts any `Uint8Array`: in Node pass `fs.readFileSync(path)`; in the
     * browser pass `new Uint8Array(await file.arrayBuffer())`. The underlying
     * `mudlet-map-binary-reader` (>=1.0.0) is browser-safe and needs no
     * Node `Buffer` polyfill.
     */
    static fromBuffer(buf: Parameters<typeof readMapFromBuffer>[0]): BinaryMapReader {
        return new BinaryMapReader(readMapFromBuffer(buf));
    }

    // --- IMapReader forwarding ---

    getArea(areaId: number): IArea {
        return this.reader.getArea(areaId);
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

    getColorValue(envId: number): string {
        return this.reader.getColorValue(envId);
    }

    getSymbolColor(envId: number, opacity?: number): string {
        return this.reader.getSymbolColor(envId, opacity);
    }
}
