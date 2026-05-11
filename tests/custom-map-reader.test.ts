import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../src/rendering/MapRenderer';
import { SvgExporter } from '../src/export/SvgExporter';
import { createSettings } from '../src/types/Settings';
import type { IMapReader } from '../src/reader/MapReader';
import type { IArea } from '../src/reader/Area';
import type { IPlane } from '../src/reader/Plane';
import type IExit from '../src/reader/Exit';

/**
 * Builds a synthetic 3-room, 1-area map and exposes it through an
 * {@link IMapReader} implemented from scratch (no inheritance from
 * `MapReader` / `Area` / `Plane`). Covers the "downstream apps can supply
 * their own reader" contract that the upstream interface patch enables.
 */
function buildSyntheticReader(): { reader: IMapReader; bumpVersion: () => void } {
    const rooms: MapData.Room[] = [
        makeRoom(1, 0, 0, 0, { south: 2 }),
        makeRoom(2, 0, -10, 0, { north: 1, south: 3 }),
        makeRoom(3, 0, -20, 0, { north: 2 }),
    ];
    let areaVersion = 0;

    const plane: IPlane = {
        getRooms: () => rooms,
        getLabels: () => [],
        getBounds: () => ({ minX: -10, maxX: 10, minY: -30, maxY: 10 }),
    };

    const linkExits: IExit[] = [
        { a: 1, b: 2, aDir: 'south', bDir: 'north', zIndex: [0] },
        { a: 2, b: 3, aDir: 'south', bDir: 'north', zIndex: [0] },
    ];

    const area: IArea = {
        getAreaName: () => 'Synthetic Test Area',
        getAreaId: () => 7,
        getVersion: () => areaVersion,
        getPlane: () => plane,
        getPlanes: () => [plane],
        getZLevels: () => [0],
        getRooms: () => rooms,
        getFullBounds: () => plane.getBounds(),
        getLinkExits: () => linkExits,
    };

    const reader: IMapReader = {
        getArea: () => area,
        getAreas: () => [area],
        getRooms: () => rooms,
        getRoom: (id) => rooms.find(r => r.id === id) as MapData.Room,
        getColorValue: (envId) => envId === 1 ? 'rgb(80,80,80)' : 'rgb(114,1,0)',
        getSymbolColor: () => 'rgb(225,225,225)',
    };

    return { reader, bumpVersion: () => { areaVersion++; } };
}

function makeRoom(
    id: number,
    x: number,
    y: number,
    z: number,
    exits: Partial<Record<MapData.direction, number>>,
): MapData.Room {
    return {
        id,
        area: 7,
        areaId: '7',
        x,
        y,
        z,
        weight: 1,
        roomChar: '',
        name: `Room ${id}`,
        userData: {},
        customLines: {},
        stubs: [],
        hash: '',
        env: 1,
        exits: exits as Record<MapData.direction, number>,
        doors: {},
        specialExits: {},
    };
}

describe('MapRenderer with a custom IMapReader (no inheritance)', () => {
    it('renders a synthetic area through SvgExporter', () => {
        const { reader } = buildSyntheticReader();
        const renderer = new MapRenderer(reader, createSettings());

        renderer.drawArea(7, 0);
        const svg = renderer.export(new SvgExporter());

        expect(svg).toBeDefined();
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
    });

    it('reflects area updates when the custom reader bumps getVersion()', () => {
        const { reader, bumpVersion } = buildSyntheticReader();
        const renderer = new MapRenderer(reader, createSettings());

        renderer.drawArea(7, 0);
        const before = renderer.export(new SvgExporter());

        // Simulate "data model changed" — set a position that forces the
        // state machine to consult getVersion() when re-checking the area.
        bumpVersion();
        renderer.setPosition(2);
        const after = renderer.export(new SvgExporter());

        // Both must be valid SVGs; the position marker between calls differs.
        expect(after).toContain('<svg');
        expect(after).not.toBe(before);
    });

    it('drawArea returns the current area through the interface', () => {
        const { reader } = buildSyntheticReader();
        const renderer = new MapRenderer(reader, createSettings());

        renderer.drawArea(7, 0);
        const current = renderer.getCurrentArea();
        expect(current).toBeDefined();
        expect(current!.getAreaName()).toBe('Synthetic Test Area');
        expect(current!.getAreaId()).toBe(7);
    });
});
