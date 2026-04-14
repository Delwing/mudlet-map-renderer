import MapReader from "./reader/MapReader";
import Area from "./reader/Area";
import type Plane from "./reader/Plane";
import type {Settings} from "./Renderer";
import type {SvgOverlays} from "./SvgExporter";
import {TypedEventEmitter} from "./TypedEventEmitter";

export type HighlightEntry = { color: string; area: number; z: number };
export type PathEntry = { locations: number[]; color: string };

export type MapStateEventMap = {
    area: { area: Area; zIndex: number };
    position: { roomId: number | undefined; center: boolean; areaChanged: boolean };
    center: { roomId: number; instant: boolean };
    highlight: { roomId: number; color: string | undefined };
    path: undefined;
    clear: undefined;
};

/**
 * Pure data + events layer for map state.
 * No Konva, no DOM — just tracks what area is displayed,
 * where the player is, which rooms are highlighted, and active paths.
 *
 * Rendering backends subscribe to events and sync their visual state.
 */
export class MapState {
    readonly mapReader: MapReader;
    readonly settings: Settings;
    readonly events = new TypedEventEmitter<MapStateEventMap>();

    currentArea?: number;
    currentAreaInstance?: Area;
    currentZIndex?: number;
    currentAreaVersion?: number;
    positionRoomId?: number;
    centerRoomId?: number;
    highlights: Map<number, HighlightEntry> = new Map();
    paths: PathEntry[] = [];

    constructor(mapReader: MapReader, settings: Settings) {
        this.mapReader = mapReader;
        this.settings = settings;
    }

    /**
     * Set the displayed area and z-level.
     * Returns true if the area/z actually changed (or area version bumped).
     */
    setArea(id: number, zIndex: number): boolean {
        const area = this.mapReader.getArea(id);
        if (!area) return false;
        const plane = area.getPlane(zIndex);
        if (!plane) return false;

        this.currentArea = id;
        this.currentAreaInstance = area;
        this.currentZIndex = zIndex;
        this.currentAreaVersion = area.getVersion();

        this.events.emit('area', {area, zIndex});
        return true;
    }

    setPosition(roomId: number, center: boolean = true): boolean {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return false;

        // Switch area/z if needed
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        const areaChanged =
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area);

        if (areaChanged) {
            this.setArea(room.area, room.z);
        }

        this.positionRoomId = roomId;
        this.events.emit('position', {roomId, center, areaChanged});
        return true;
    }

    /**
     * Update position marker without centering or switching area.
     * Used when you want to show where the player is without moving the viewport.
     */
    updatePositionMarker(roomId: number) {
        this.positionRoomId = roomId;
        this.events.emit('position', {roomId, center: false, areaChanged: false});
    }

    /**
     * Re-emit position for the current room (e.g. after settings change).
     */
    refreshPosition() {
        if (this.positionRoomId !== undefined) {
            this.events.emit('position', {roomId: this.positionRoomId, center: false, areaChanged: false});
        }
    }

    clearPosition() {
        this.positionRoomId = undefined;
        this.events.emit('position', {roomId: undefined, center: false, areaChanged: false});
    }

    setCenterRoom(roomId: number, instant?: boolean): boolean {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return false;

        const areaChanged =
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z;

        if (areaChanged || this.needsAreaRedraw(room)) {
            this.setArea(room.area, room.z);
        }

        this.centerRoomId = roomId;
        this.events.emit('center', {roomId, instant: instant ?? areaChanged});
        return true;
    }

    needsAreaRedraw(room: MapData.Room): boolean {
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        return (
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        );
    }

    addHighlight(roomId: number, color: string): boolean {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return false;
        this.highlights.set(roomId, {color, area: room.area, z: room.z});
        this.events.emit('highlight', {roomId, color});
        return true;
    }

    removeHighlight(roomId: number) {
        if (!this.highlights.has(roomId)) return;
        this.highlights.delete(roomId);
        this.events.emit('highlight', {roomId, color: undefined});
    }

    hasHighlight(roomId: number): boolean {
        return this.highlights.has(roomId);
    }

    clearHighlights() {
        this.highlights.clear();
        this.events.emit('clear', undefined);
    }

    addPath(locations: number[], color: string = '#66E64D') {
        this.paths.push({locations, color});
        this.events.emit('path', undefined);
    }

    clearPaths() {
        this.paths = [];
        this.events.emit('path', undefined);
    }

    /**
     * Build the overlay descriptor for the current area/z,
     * merging stateful overlays with any extra overlays passed in.
     */
    getOverlaysForArea(extra?: SvgOverlays): SvgOverlays {
        const overlays: SvgOverlays = {...extra};

        // Position
        if (this.positionRoomId !== undefined) {
            const room = this.mapReader.getRoom(this.positionRoomId);
            if (room && room.area === this.currentArea && room.z === this.currentZIndex) {
                overlays.position = {roomId: this.positionRoomId};
            }
        }

        // Highlights (only for current area/z)
        const highlights: Array<{ roomId: number; color: string }> = [...(extra?.highlights ?? [])];
        for (const [roomId, entry] of this.highlights) {
            if (entry.area === this.currentArea && entry.z === this.currentZIndex) {
                highlights.push({roomId, color: entry.color});
            }
        }
        if (highlights.length > 0) overlays.highlights = highlights;

        // Paths
        const paths: Array<{ locations: number[]; color: string }> = [...(extra?.paths ?? [])];
        paths.push(...this.paths);
        if (paths.length > 0) overlays.paths = paths;

        return overlays;
    }

    /**
     * Get the effective plane bounds (respects uniformLevelSize setting).
     */
    getEffectiveBounds(area: Area, plane: Plane) {
        return this.settings.uniformLevelSize ? area.getFullBounds() : plane.getBounds();
    }

    /**
     * Compute export bounds for a given area/plane, optionally centered on a room.
     */
    computeExportBounds(area: Area, plane: Plane, roomId: number | undefined, padding: number) {
        if (roomId !== undefined) {
            const room = this.mapReader.getRoom(roomId);
            if (!room) throw new Error(`Room ${roomId} not found`);
            return {x: room.x - padding, y: room.y - padding, w: padding * 2, h: padding * 2};
        }
        const b = this.getEffectiveBounds(area, plane);
        const areaName = this.settings.areaName ? area.getAreaName() : undefined;
        const nameOverhead = areaName ? 7 : 0;
        const nameLeftOffset = areaName ? 3.5 : 0;
        const minX = b.minX - nameLeftOffset;
        const minY = b.minY - nameOverhead;
        const nameRight = areaName ? (b.minX - 3.5 + areaName.length * 2.5 * 0.6) : -Infinity;
        const maxX = Math.max(b.maxX, nameRight);
        return {x: minX - padding, y: minY - padding, w: (maxX - minX) + padding * 2, h: (b.maxY - minY) + padding * 2};
    }
}
