import Konva from "konva";
import type {ViewportBounds} from "@src/types/Settings";
import type {LiveEffect, CoordinateTransform} from "@src";

export type FogOfWarStyle = {
    /** Darkness opacity (0.0 - 1.0). Default: 0.85 */
    intensity: number;
    /** Reveal radius around each visited room in map units. Default: 1.5 */
    radius: number;
    /** Fog color. Default: '#000000' */
    color: string;
};

type RevealedRoom = { x: number; y: number };
type RevealedConnection = { x1: number; y1: number; x2: number; y2: number };

/**
 * Fog of War overlay plugin.
 *
 * Draws a darkness layer over the entire visible map, then punches
 * smooth radial "light holes" at each revealed room position.
 * Unvisited areas remain shrouded; visited areas are clearly visible
 * with a smooth gradient at the boundary.
 *
 * ```ts
 * const fog = new FogOfWarOverlay();
 * renderer.addLiveEffect('fog-of-war', fog);
 * fog.setStyle({ intensity: 0.85, radius: 1.5 });
 * fog.setRevealedRooms([{ x: 5, y: 10 }, { x: 6, y: 10 }]);
 * ```
 */
export class FogOfWarOverlay implements LiveEffect {
    private layer!: Konva.Layer;
    private shape!: Konva.Shape;
    private style: FogOfWarStyle;
    private rooms: RevealedRoom[] = [];
    private connections: RevealedConnection[] = [];
    private bounds: ViewportBounds = {minX: 0, maxX: 10, minY: 0, maxY: 10};
    private scale: number = 75;
    private coordTransform?: CoordinateTransform;
    private dirty = true;

    constructor() {
        this.style = {intensity: 0.85, radius: 1.5, color: '#000000'};
    }

    attach(layer: Konva.Layer) {
        this.layer = layer;
        this.shape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (ctx) => {
                const c2d: CanvasRenderingContext2D = ctx._context;
                this.draw(c2d);
            },
        });
        layer.add(this.shape);
    }

    setStyle(style: Partial<FogOfWarStyle>) {
        Object.assign(this.style, style);
        this.dirty = true;
        if (this.layer) this.layer.batchDraw();
    }

    /**
     * Set the list of revealed (visited) room positions and their connections.
     * Connections draw revealed corridors between linked rooms.
     * Call this when rooms are visited or when the area changes.
     */
    setRevealedRooms(rooms: RevealedRoom[], connections?: RevealedConnection[]) {
        this.rooms = rooms;
        this.connections = connections ?? [];
        this.dirty = true;
        if (this.layer) this.layer.batchDraw();
    }

    /**
     * Add a single room to the revealed set (e.g. when player moves).
     */
    revealRoom(x: number, y: number) {
        this.rooms.push({x, y});
        this.dirty = true;
        if (this.layer) this.layer.batchDraw();
    }

    updateViewport(bounds: ViewportBounds, scale: number, coordinateTransform?: CoordinateTransform) {
        this.bounds = bounds;
        this.scale = scale;
        if (coordinateTransform) this.coordTransform = coordinateTransform;
        this.dirty = true;
    }

    destroy() {
        if (this.shape) this.shape.destroy();
    }

    /** Transform a map point through the coordinate transform (e.g. isometric) then to screen pixels. */
    private toScreen(x: number, y: number, s: number, pos: {x: number; y: number}): {sx: number; sy: number} {
        if (this.coordTransform) {
            const t = this.coordTransform(x, y);
            return {sx: t.x * s + pos.x, sy: t.y * s + pos.y};
        }
        return {sx: x * s + pos.x, sy: y * s + pos.y};
    }

    private draw(ctx: CanvasRenderingContext2D) {
        if (this.rooms.length === 0 && this.style.intensity <= 0) return;

        const stage = this.layer.getStage();
        if (!stage) return;

        const sw = stage.width();
        const sh = stage.height();
        const s = this.scale;
        const pos = stage.position();

        // Work in screen space for consistent fog density
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // 1. Fill entire screen with darkness
        const {color, intensity} = this.style;
        const cr = parseInt(color.slice(1, 3), 16) || 0;
        const cg = parseInt(color.slice(3, 5), 16) || 0;
        const cb = parseInt(color.slice(5, 7), 16) || 0;

        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${intensity})`;
        ctx.fillRect(0, 0, sw, sh);

        // 2. Punch revealed areas using destination-out
        ctx.globalCompositeOperation = 'destination-out';

        const radiusPx = this.style.radius * s;
        const {minX, maxX, minY, maxY} = this.bounds;
        const margin = this.style.radius * 2;

        // 2a. Draw corridors between connected revealed rooms
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
        ctx.lineWidth = radiusPx * 1.2;
        for (const conn of this.connections) {
            // Cull connections fully outside viewport
            const cMinX = Math.min(conn.x1, conn.x2);
            const cMaxX = Math.max(conn.x1, conn.x2);
            const cMinY = Math.min(conn.y1, conn.y2);
            const cMaxY = Math.max(conn.y1, conn.y2);
            if (cMaxX < minX - margin || cMinX > maxX + margin ||
                cMaxY < minY - margin || cMinY > maxY + margin) continue;

            const p1 = this.toScreen(conn.x1, conn.y1, s, pos);
            const p2 = this.toScreen(conn.x2, conn.y2, s, pos);
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(p1.sx, p1.sy);
            ctx.lineTo(p2.sx, p2.sy);
            ctx.stroke();
        }

        // 2b. Punch smooth radial holes at each revealed room
        for (const room of this.rooms) {
            const {sx, sy} = this.toScreen(room.x, room.y, s, pos);

            // Cull if off-screen (with margin)
            if (sx < -radiusPx * 2 || sx > sw + radiusPx * 2 ||
                sy < -radiusPx * 2 || sy > sh + radiusPx * 2) continue;

            const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, radiusPx);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
            gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.95)');
            gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.7)');
            gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.3)');
            gradient.addColorStop(0.95, 'rgba(0, 0, 0, 0.05)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(sx, sy, radiusPx, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}
