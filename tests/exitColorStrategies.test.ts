import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("konva", () => {
    class Node {
        protected _name = "";
        protected _layer?: Layer;
        protected _children: Node[] = [];

        addName(name: string) {
            const names = new Set(this._name.split(/\s+/).filter(Boolean));
            names.add(name);
            this._name = Array.from(names).join(" ");
            return this;
        }

        name(value?: string) {
            if (value === undefined) {
                return this._name;
            }
            this._name = value;
            return this;
        }

        getLayer() {
            return this._layer;
        }

        setLayer(layer?: Layer) {
            this._layer = layer;
        }

        getChildren() {
            return this._children;
        }

        protected matchesSelector(selector: string) {
            if (selector.startsWith(".")) {
                const name = selector.slice(1);
                return this._name.split(/\s+/).includes(name);
            }
            return this.constructor.name === selector;
        }

        findOne(selector: string): Node | null {
            return this.matchesSelector(selector) ? this : null;
        }
    }

    class Shape extends Node {
        protected _stroke?: string;
        protected _fill?: string;

        constructor(config: {stroke?: string; fill?: string} = {}) {
            super();
            this._stroke = config.stroke;
            this._fill = config.fill;
        }

        stroke(value?: string) {
            if (value === undefined) {
                return this._stroke;
            }
            this._stroke = value;
            return this;
        }

        fill(value?: string) {
            if (value === undefined) {
                return this._fill;
            }
            this._fill = value;
            return this;
        }

        dash() {
            return this;
        }

        dashOffset() {
            return this;
        }
    }

    class Group extends Node {
        add(node: Node) {
            this._children.push(node);
            node.setLayer(this._layer);
        }

        setLayer(layer?: Layer) {
            super.setLayer(layer);
            this._children.forEach(child => child.setLayer(layer));
        }

        findOne(selector: string): Node | null {
            if (this.matchesSelector(selector)) {
                return this;
            }
            for (const child of this._children) {
                const match = child.findOne(selector);
                if (match) {
                    return match;
                }
            }
            return null;
        }
    }

    class Layer extends Group {
        destroyChildren() {
            this._children.forEach(child => child.setLayer(undefined));
            this._children = [];
        }

        batchDraw() {
            return this;
        }
    }

    class Line extends Shape {
        constructor(config: {stroke?: string; fill?: string} = {}) {
            super(config);
        }
    }

    class Arrow extends Line {}

    class Rect extends Shape {}

    class RegularPolygon extends Shape {
        rotation() {
            return this;
        }

        position() {
            return this;
        }

        clone() {
            const clone = new RegularPolygon();
            clone.stroke(this.stroke());
            clone.fill(this.fill());
            return clone;
        }

        scaleX() {
            return this;
        }

        scaleY() {
            return this;
        }
    }

    return {
        default: {
            Node,
            Group,
            Layer,
            Line,
            Arrow,
            Rect,
            RegularPolygon,
        },
    };
});

import Konva from "konva";
import ExitRenderer from "../src/ExitRenderer";
import type Exit from "../src/reader/Exit";
import type MapReader from "../src/reader/MapReader";
import {Settings} from "../src/Renderer";
import {performance} from "node:perf_hooks";

type RoomInit = {
    id: number;
    area?: number;
    env?: number;
    x?: number;
    y?: number;
    z?: number;
};

type StubRoom = ReturnType<typeof createRoom>;

type StubMapReader = Pick<MapReader, "getRoom" | "getColorValue" | "getSymbolColor">;

function createRoom({id, area = 1, env = 1, x = 0, y = 0, z = 0}: RoomInit): StubRoom {
    return {
        id,
        area,
        x,
        y,
        z,
        areaId: `${area}`,
        weight: 1,
        roomChar: "",
        name: `Room ${id}`,
        userData: {},
        customLines: {},
        stubs: [],
        hash: `room-${id}`,
        env,
        exits: {} as Record<string, number>,
        doors: {},
        specialExits: {},
    };
}

describe("ExitRenderer color strategies", () => {
    let rooms: Map<number, StubRoom>;
    let mapReader: StubMapReader;
    let renderer: ExitRenderer;
    let layer: Konva.Layer;

    beforeEach(() => {
        Settings.lineColor = "rgb(225, 255, 225)";
        rooms = new Map();
        const roomA = createRoom({id: 1, x: 0, y: 0});
        const roomB = createRoom({id: 2, x: 1, y: 0});
        rooms.set(roomA.id, roomA);
        rooms.set(roomB.id, roomB);

        mapReader = {
            getRoom: (id: number) => rooms.get(id),
            getColorValue: () => "rgb(255, 0, 0)",
            getSymbolColor: () => "rgba(255,255,255)",
        } as StubMapReader;

        renderer = new ExitRenderer(mapReader as MapReader);
        layer = new Konva.Layer();
    });

    function renderTwoWayExit() {
        const exit: Exit = {
            a: 1,
            b: 2,
            aDir: "east",
            bDir: "west",
            zIndex: [0],
        };
        const node = renderer.render(exit);
        expect(node).toBeDefined();
        layer.add(node!);
        return node!;
    }

    it("updates directional exits via cached references", () => {
        const node = renderTwoWayExit();
        const result = renderer.setDirectionalExitColorByReference(1, "east", "#123456");
        expect(result).toBe(true);
        const line = node.findOne("Line") as Konva.Line;
        expect(line.stroke()).toBe("#123456");
    });

    it("updates directional exits via node names", () => {
        renderTwoWayExit();
        const updated = renderer.setDirectionalExitColorByName(layer, 1, "east", "#654321");
        expect(updated).toBe(true);
        const group = layer.findOne(".exit-1-direction:east") as Konva.Group;
        const line = group.findOne("Line") as Konva.Line;
        expect(line.stroke()).toBe("#654321");
    });

    it("updates special exits with both strategies", () => {
        const room = rooms.get(1)!;
        room.customLines = {
            link: {
                points: [{x: 0.5, y: 0}],
                attributes: {
                    color: {r: 100, g: 150, b: 200, alpha: 1},
                    style: "solid line",
                    arrow: true,
                },
            },
        };
        const renders = renderer.renderSpecialExits(room);
        renders.forEach(node => layer.add(node));

        const refUpdated = renderer.setSpecialExitColorByReference(1, "link", "#abcdef");
        expect(refUpdated).toBe(true);
        const byRef = layer.findOne(".exit-1-special:link") as Konva.Node;
        expect((byRef as Konva.Arrow).stroke()).toBe("#abcdef");
        expect((byRef as Konva.Arrow).fill()).toBe("#abcdef");

        const nameUpdated = renderer.setSpecialExitColorByName(layer, 1, "link", "#fedcba");
        expect(nameUpdated).toBe(true);
        const byName = layer.findOne(".exit-1-special:link") as Konva.Arrow;
        expect(byName.stroke()).toBe("#fedcba");
        expect(byName.fill()).toBe("#fedcba");
    });

    it("performs faster with cached references", () => {
        renderTwoWayExit();

        const iterations = 2000;
        const colors = Array.from({length: iterations}, (_, index) => {
            const channel = (index % 256).toString(16).padStart(2, "0");
            return `#${channel}ff33`;
        });

        const referenceStart = performance.now();
        colors.forEach(color => {
            const ok = renderer.setDirectionalExitColorByReference(1, "east", color);
            if (!ok) throw new Error("reference update failed");
        });
        const referenceTime = performance.now() - referenceStart;

        const nameStart = performance.now();
        colors.forEach(color => {
            const ok = renderer.setDirectionalExitColorByName(layer, 1, "east", color);
            if (!ok) throw new Error("name update failed");
        });
        const nameTime = performance.now() - nameStart;

        expect(referenceTime).toBeLessThan(nameTime);
    });
});
