import type {MapState} from "../MapState";
import type {ViewportBounds} from "../types/Settings";
import type {Shape} from "../scene/Shape";
import {placeLabels, type Direction8, type LabelPlacementItem, type Obstacle} from "../labelPlacement";
import type {SceneOverlay, SceneOverlayContext} from "./SceneOverlay";

export interface Waypoint {
    roomId: number;
    /** Label text. An array renders as stacked lines in one bubble. */
    label: string | string[];
    /** Marker / accent colour (hex). Default amber. */
    color?: string;
    /** Optional preferred label direction (nudge only). */
    preferred?: Direction8;
    /**
     * Optional click handler. Fired when the waypoint's bubble is clicked.
     * Wire pointer hits to it via {@link WaypointOverlay.hitTest} (see below).
     * Waypoints without a handler are inert.
     */
    onClick?: (waypoint: Waypoint) => void;
}

/** A bubble rect placed in world space, paired with its waypoint. */
interface PlacedBubble {
    wp: Waypoint;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Persistent named markers anchored to rooms (shops, banks, quest givers …),
 * with auto-placed labels that dodge neighbouring rooms, exits, and each other
 * via {@link placeLabels}. A {@link SceneOverlay}, so it renders on the
 * interactive canvas and in every export.
 *
 * A room may carry more than one waypoint (e.g. a transport stop served by two
 * routes): the list is flat, so push several entries with the same `roomId` and
 * each gets its own auto-placed bubble. Alternatively give one waypoint a
 * multi-line `label` to list them in a single bubble.
 *
 * Waypoints can be clickable. Bubbles are overlay-layer shapes, so they are not
 * part of the renderer's {@link HitTester}; the overlay instead records the
 * rects it places and resolves them via {@link hitTest}. Wire pointer clicks to
 * it by converting the cursor to world space:
 *
 * ```ts
 * const waypoints = new WaypointOverlay();
 * waypoints.add({ roomId: 42, label: 'Bank', onClick: wp => console.log(wp.roomId) });
 * renderer.addSceneOverlay('waypoints', waypoints);
 *
 * container.addEventListener('click', e => {
 *     const p = renderer.camera.clientToMapPoint(e.clientX, e.clientY, container.getBoundingClientRect());
 *     if (!p) return;
 *     const wp = waypoints.hitTest(p.x, p.y);
 *     wp?.onClick?.(wp);
 * });
 * ```
 */
export class WaypointOverlay implements SceneOverlay {
    private waypoints: Waypoint[] = [];
    private ctx?: SceneOverlayContext;
    /** Bubble rects from the last render, for click hit-testing (world space). */
    private placed: PlacedBubble[] = [];

    set(list: Waypoint[]) {
        this.waypoints = [...list];
        this.ctx?.invalidate();
    }

    add(waypoint: Waypoint) {
        this.waypoints.push(waypoint);
        this.ctx?.invalidate();
    }

    /** Remove every waypoint anchored to this room. */
    remove(roomId: number) {
        const before = this.waypoints.length;
        this.waypoints = this.waypoints.filter(w => w.roomId !== roomId);
        if (this.waypoints.length !== before) this.ctx?.invalidate();
    }

    has(roomId: number): boolean {
        return this.waypoints.some(w => w.roomId === roomId);
    }

    /**
     * Topmost waypoint whose bubble contains the given **world-space** point, or
     * `undefined`. Hit-tests the bubbles placed by the last {@link render} (in
     * reverse, so later-drawn bubbles win). Convert a pointer position to world
     * space with `renderer.camera.clientToMapPoint(...)` before calling.
     */
    hitTest(worldX: number, worldY: number): Waypoint | undefined {
        for (let i = this.placed.length - 1; i >= 0; i--) {
            const b = this.placed[i];
            if (worldX >= b.x && worldX <= b.x + b.width
                && worldY >= b.y && worldY <= b.y + b.height) {
                return b.wp;
            }
        }
        return undefined;
    }

    attach(ctx: SceneOverlayContext) {
        this.ctx = ctx;
    }

    detach() {
        this.ctx = undefined;
        this.placed = [];
    }

    render(state: MapState, _bounds: ViewportBounds): Shape[] {
        // Recomputed below; clear stale hit-test rects so clicks never resolve
        // to bubbles that are no longer drawn (plane switch, removal, …).
        this.placed = [];
        const areaId = state.currentArea;
        const z = state.currentZIndex;
        if (areaId === undefined || z === undefined || this.waypoints.length === 0) return [];
        const plane = state.currentAreaInstance?.getPlane(z);
        if (!plane) return [];

        const rs = state.settings.roomSize;
        const fontSize = rs * 0.6;
        const pad = fontSize * 0.5;
        const lineHeight = fontSize * 1.2;

        // Obstacles: every room on the plane (hard) + exit lines (so labels
        // don't sit on connectors). Exits are derived from room adjacency as
        // thin centre-to-centre segments — reliable and in the same world space
        // as the rooms.
        const planeRooms = plane.getRooms();
        const obstacles: Obstacle[] = planeRooms.map(r => ({
            x: r.x - rs / 2, y: r.y - rs / 2, width: rs, height: rs, kind: "room",
        }));
        const seg = (x1: number, y1: number, x2: number, y2: number) => obstacles.push({
            x: Math.min(x1, x2) - 0.03, y: Math.min(y1, y2) - 0.03,
            width: Math.abs(x2 - x1) + 0.06, height: Math.abs(y2 - y1) + 0.06, kind: "exit",
        });
        for (const r of planeRooms) {
            for (const tid of [...Object.values(r.exits), ...Object.values(r.specialExits)]) {
                const t = state.mapReader.getRoom(tid);
                if (t && t.area === areaId && t.z === z) seg(r.x, r.y, t.x, t.y);
            }
        }

        // One placement item per waypoint that lives on the current plane.
        // Multiple waypoints may share a room — each becomes its own item and the
        // placer keeps them from stacking.
        const items: LabelPlacementItem[] = [];
        const meta: Array<{wp: Waypoint; rx: number; ry: number; lines: string[]}> = [];
        for (const wp of this.waypoints) {
            const room = state.mapReader.getRoom(wp.roomId);
            if (!room || room.area !== areaId || room.z !== z) continue;
            const lines = Array.isArray(wp.label) ? wp.label : [wp.label];
            const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
            const width = longest * fontSize * 0.6 + pad * 2;
            const height = lines.length * lineHeight + fontSize * 0.4;
            // Index (not roomId) as id, so rooms with several waypoints stay distinct.
            items.push({x: room.x, y: room.y, width, height, id: items.length, preferred: wp.preferred});
            meta.push({wp, rx: room.x, ry: room.y, lines});
        }
        if (items.length === 0) return [];

        const bg = "rgba(20, 20, 24, 0.82)";
        const placed = placeLabels(items, obstacles, {
            offset: rs * 0.7,
            // Allow escaping a junction, but cap clearance reward so labels stay
            // close — only as clear as they need to be (off the lines), not far
            // out in a void.
            extend: rs * 4,
            clearCap: rs * 1.5,
            // If even the best spot is this cramped, the room is surrounded — sit
            // close on an exit (north-preferred) rather than floating far out.
            minClearance: rs * 0.7,
        });

        const shapes: Shape[] = [];

        for (let i = 0; i < placed.length; i++) {
            const p = placed[i];
            const {wp, rx, ry} = meta[i];
            const color = wp.color ?? "#ffcc33";

            // Speech-bubble tail pointing at the room. For cardinal placements
            // the base sits flush on the room-facing edge; for diagonal ones it
            // spans the room-facing corner (a rotated corner tail).
            const dx = rx - (p.x + p.width / 2), dy = ry - (p.y + p.height / 2);
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;          // unit vector toward the room
            const tip = fontSize * 0.7, half = fontSize * 0.5;
            const diagonal = p.direction.length === 2;   // ne / nw / se / sw
            let vertices: number[];
            if (diagonal) {
                // Corner the room faces, and the two base points stepping back
                // along each edge from it.
                const cxn = ux < 0 ? p.x : p.x + p.width;
                const cyn = uy < 0 ? p.y : p.y + p.height;
                const leg = fontSize * 0.85;
                vertices = [
                    cxn + (ux < 0 ? leg : -leg), cyn,    // along the horizontal edge
                    cxn + ux * tip, cyn + uy * tip,      // apex out the corner toward room
                    cxn, cyn + (uy < 0 ? leg : -leg),    // along the vertical edge
                ];
            } else {
                const adx = Math.abs(dx), ady = Math.abs(dy);
                const onSide = (adx > 1e-6 ? (p.width / 2) / adx : Infinity)
                    <= (ady > 1e-6 ? (p.height / 2) / ady : Infinity);
                // Midpoint of the room-facing edge.
                const ex = onSide ? (ux < 0 ? p.x : p.x + p.width) : p.x + p.width / 2;
                const ey = onSide ? p.y + p.height / 2 : (uy < 0 ? p.y : p.y + p.height);
                const tgx = onSide ? 0 : 1, tgy = onSide ? 1 : 0;  // base runs along the edge
                vertices = [
                    ex + tgx * half, ey + tgy * half,
                    ex + ux * tip, ey + uy * tip,
                    ex - tgx * half, ey - tgy * half,
                ];
            }
            shapes.push({
                type: "polygon", vertices,
                paint: {fill: bg, stroke: color, strokeWidth: rs * 0.03},
                layer: "top",
            });
            // Label background.
            shapes.push({
                type: "rect", x: p.x, y: p.y, width: p.width, height: p.height,
                cornerRadius: fontSize * 0.3,
                paint: {fill: bg, stroke: color, strokeWidth: rs * 0.03},
                layer: "top",
            });
            // Record the bubble for click hit-testing (world space).
            this.placed.push({wp, x: p.x, y: p.y, width: p.width, height: p.height});
            // Label text — one shape per line, stacked and vertically centred so
            // multi-line labels sit evenly inside the bubble.
            const lines = meta[i].lines;
            const topPad = (p.height - lines.length * lineHeight) / 2;
            for (let li = 0; li < lines.length; li++) {
                shapes.push({
                    type: "text", x: p.x, y: p.y + topPad + li * lineHeight,
                    width: p.width, height: lineHeight,
                    text: lines[li], fontSize, fontFamily: state.settings.fontFamily,
                    fill: "#f4f4f6", align: "center", verticalAlign: "middle", layer: "top",
                });
            }
        }
        return shapes;
    }
}
