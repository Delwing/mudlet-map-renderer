/**
 * Synthetic single-area grid map for benchmarking. One area, `size × size`
 * rooms on z=0, each wired to its N/S/E/W neighbours, cycling through a handful
 * of env colours. Generated in-memory so the repo carries no multi-MB fixture
 * and the size is tunable from the URL (`?size=`).
 */

export interface GeneratedMap {
    map: MapData.Map;
    envs: MapData.Env[];
    roomCount: number;
}

const ENVS: MapData.Env[] = [
    {envId: 1, colors: [128, 128, 128]},
    {envId: 2, colors: [200, 160, 40]},
    {envId: 3, colors: [30, 120, 30]},
    {envId: 4, colors: [80, 60, 40]},
    {envId: 5, colors: [40, 80, 160]},
    {envId: 6, colors: [150, 50, 60]},
];

export function generateGridMap(size: number): GeneratedMap {
    const idAt = (c: number, r: number) => r * size + c + 1;
    const rooms: MapData.Room[] = [];

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const exits: Record<string, number> = {};
            if (r > 0) exits.north = idAt(c, r - 1);
            if (r < size - 1) exits.south = idAt(c, r + 1);
            if (c < size - 1) exits.east = idAt(c + 1, r);
            if (c > 0) exits.west = idAt(c - 1, r);

            rooms.push({
                id: idAt(c, r),
                area: 1,
                x: c,
                y: r,
                z: 0,
                areaId: "1",
                weight: 1,
                roomChar: "",
                name: `R${c},${r}`,
                userData: {},
                customLines: {},
                stubs: [],
                hash: "",
                env: ((c + r) % ENVS.length) + 1,
                exits: exits as MapData.Room["exits"],
                doors: {},
                specialExits: {},
            } as MapData.Room);
        }
    }

    const map: MapData.Map = [
        {areaName: `Benchmark Grid ${size}×${size}`, areaId: "1", rooms, labels: []} as unknown as MapData.Map[number],
    ];

    return {map, envs: ENVS, roomCount: rooms.length};
}
