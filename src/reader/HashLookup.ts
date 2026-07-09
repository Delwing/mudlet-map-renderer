/**
 * Optional capability interface for readers that can resolve a Mudlet room
 * content hash (`MapData.Room.hash`) directly to a room id.
 *
 * `SkeletonMapReader.getRooms()` deliberately always returns `[]` (see
 * {@link ViewportDataSource} — never materialise the full room list), so a
 * linear `getRooms().find(r => r.hash === hash)` scan — the only option
 * `IMapReader` supports on its own — can never find anything on a big/
 * streamed map. This interface gives such readers a way to opt into an O(1)
 * (or otherwise scan-free) hash lookup instead.
 */
export interface HashLookupCapable {
    readonly hashLookupCapable: true;
    /** Resolve a room's content hash to its id, or `undefined` if unknown. */
    getRoomIdByHash(hash: string): number | undefined;
}

export function isHashLookupCapable(reader: unknown): reader is HashLookupCapable {
    return !!reader && (reader as HashLookupCapable).hashLookupCapable === true;
}
