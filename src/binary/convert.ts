import type {RendererRoom, RendererLabel, MudletRoom} from "mudlet-map-binary-reader";

/**
 * RendererRoom -> MapData.Room: fills the fields RendererRoom leaves optional
 * (`env`/`roomChar` are only set upstream when truthy; `hash` is resolved
 * separately from the header's `mpRoomDbHashToRoomId` index since streamRooms
 * doesn't hydrate it per-room). `customLines` colour drops `alpha` upstream —
 * SpecialExitStyle only ever reads r/g/b, so 255 (opaque) is a safe filler,
 * never a real behavioural difference.
 */
export function toMapRoom(r: RendererRoom, areaId: string, hash = ""): MapData.Room {
    const customLines: Record<string, MapData.Line> = {};
    for (const key in r.customLines) {
        const line = r.customLines[key];
        customLines[key] = {
            points: line.points,
            attributes: {
                color: {alpha: 255, r: line.attributes.color.r, g: line.attributes.color.g, b: line.attributes.color.b},
                style: line.attributes.style,
                arrow: line.attributes.arrow,
            },
        };
    }
    return {
        id: r.id,
        area: r.area,
        x: r.x,
        y: r.y,
        z: r.z,
        areaId,
        weight: r.weight,
        roomChar: r.roomChar ?? "",
        name: r.name,
        userData: r.userData,
        customLines,
        stubs: r.stubs,
        hash: r.hash ?? hash,
        env: r.env ?? 0,
        exits: r.exits as Record<MapData.direction, number>,
        // Mudlet door states are always 1|2|3 at runtime; MudletRoom types them as plain number.
        doors: r.doors as Record<string, 1 | 2 | 3>,
        specialExits: r.specialExits,
        exitLocks: r.exitLocks,
        exitWeights: r.exitWeights,
        mSpecialExitLocks: r.mSpecialExitLocks,
    };
}

/** RendererLabel -> MapData.Label; areaId/labelId are stamped from the enclosing header.labels[areaId] key when omitted. */
export function toMapLabel(l: RendererLabel, fallbackAreaId: number): MapData.Label {
    return {
        labelId: l.labelId ?? l.id,
        areaId: l.areaId ?? fallbackAreaId,
        pixMap: l.pixMap || undefined,
        X: l.X, Y: l.Y, Z: l.Z, Width: l.Width, Height: l.Height, Text: l.Text,
        FgColor: l.FgColor, BgColor: l.BgColor,
        noScaling: l.noScaling, showOnTop: l.showOnTop,
    };
}

const hasKeys = (o: Record<string, unknown> | undefined | null): boolean => !!o && Object.keys(o).length > 0;

/**
 * A room carries non-default metadata the skeleton's compact columns can't
 * encode (or that a plain visual-detail check would silently drop —
 * `weight`, `exitWeights`) and must be promoted to a fully materialised
 * MapData.Room.
 */
export function hasExtraDetail(room: MudletRoom): boolean {
    return !!room.symbol || hasKeys(room.customLines) || hasKeys(room.mSpecialExits) ||
        (room.stubs?.length ?? 0) > 0 || hasKeys(room.doors) || (room.exitLocks?.length ?? 0) > 0 ||
        room.weight !== 1 || hasKeys(room.exitWeights);
}
