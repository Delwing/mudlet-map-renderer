import type {ViewportBounds} from "@src/types/Settings";
import type {SceneOverlay, SceneOverlayContext, CanvasDrawState} from "@src";

export type TerrainEffectType = "water" | "forest" | "lava" | "ice";

export type TerrainRoom = {
    x: number;
    y: number;
    effect: TerrainEffectType;
    size?: number;
};

type RippleState = { phase: number; speed: number };
type LeafParticle = { ox: number; oy: number; vx: number; vy: number; rot: number; rotSpeed: number; size: number; opacity: number; phase: number };
type SparkleState = { ox: number; oy: number; phase: number; speed: number; size: number };

const EFFECT_COLORS: Record<TerrainEffectType, string> = {
    water: '#4488cc', forest: '#44aa44', lava: '#ff4400', ice: '#aaddff',
};

export class TerrainOverlay implements SceneOverlay {
    private rooms: TerrainRoom[] = [];
    private bounds: ViewportBounds = {minX: 0, maxX: 10, minY: 0, maxY: 10};
    private scale: number = 75;
    private time: number = 0;
    private coordTransform: (x: number, y: number) => {x: number; y: number} = (x, y) => ({x, y});
    private ripples: RippleState[] = [];
    private leaves: LeafParticle[][] = [];
    private sparkles: SparkleState[][] = [];
    private unsubFrame?: () => void;

    attach(ctx: SceneOverlayContext) {
        this.unsubFrame = ctx.onFrame((dt) => {
            if (this.rooms.length === 0) return;
            this.update(dt);
        });
    }

    detach() {
        this.unsubFrame?.();
        this.unsubFrame = undefined;
    }

    setRooms(rooms: TerrainRoom[]) {
        this.rooms = rooms;
        this.initState();
    }

    draw(ctx: CanvasRenderingContext2D, state: CanvasDrawState) {
        this.bounds = state.bounds;
        this.scale = state.scale;
        this.coordTransform = state.coordinateTransform;
        if (this.rooms.length === 0) return;
        const {minX, maxX, minY, maxY} = this.bounds;
        ctx.save();
        for (let i = 0; i < this.rooms.length; i++) {
            const room = this.rooms[i];
            const pos = this.coordTransform(room.x, room.y);
            if (pos.x < minX - 1 || pos.x > maxX + 1 || pos.y < minY - 1 || pos.y > maxY + 1) continue;
            switch (room.effect) {
                case "water": this.drawWater(ctx, room, this.ripples[i]); break;
                case "forest": this.drawForest(ctx, room, this.leaves[i]); break;
                case "lava": this.drawLava(ctx, room, this.ripples[i]); break;
                case "ice": this.drawIce(ctx, room, this.sparkles[i]); break;
            }
        }
        ctx.restore();
    }

    private initState() {
        this.ripples = []; this.leaves = []; this.sparkles = [];
        for (const room of this.rooms) {
            const rs = room.size ?? 0.6, half = rs / 2;
            switch (room.effect) {
                case "water":
                    this.ripples.push({phase: Math.random() * Math.PI * 2, speed: 0.8 + Math.random() * 0.6});
                    this.leaves.push([]); this.sparkles.push([]); break;
                case "forest": {
                    const ls: LeafParticle[] = [];
                    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) ls.push(this.spawnLeaf(half));
                    this.ripples.push({phase: 0, speed: 0}); this.leaves.push(ls); this.sparkles.push([]); break;
                }
                case "lava":
                    this.ripples.push({phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 0.3});
                    this.leaves.push([]); this.sparkles.push([]); break;
                case "ice": {
                    const ss: SparkleState[] = [];
                    for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++)
                        ss.push({ox: (Math.random() - 0.5) * rs * 0.9, oy: (Math.random() - 0.5) * rs * 0.9, phase: Math.random() * Math.PI * 2, speed: 2.0 + Math.random() * 3, size: 0.03 + Math.random() * 0.05});
                    this.ripples.push({phase: 0, speed: 0}); this.leaves.push([]); this.sparkles.push(ss); break;
                }
            }
        }
    }

    private spawnLeaf(half: number): LeafParticle {
        return {ox: (Math.random() - 0.5) * half * 1.2, oy: (Math.random() - 0.5) * half * 1.2, vx: (Math.random() - 0.5) * 0.1, vy: 0.02 + Math.random() * 0.06, rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 3, size: 0.03 + Math.random() * 0.04, opacity: 0.5 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2};
    }

    private update(dt: number) {
        this.time += dt;
        for (let i = 0; i < this.rooms.length; i++) {
            const room = this.rooms[i], rs = room.size ?? 0.6, half = rs / 2;
            switch (room.effect) {
                case "water": case "lava": this.ripples[i].phase += dt * this.ripples[i].speed; break;
                case "forest":
                    for (const leaf of this.leaves[i]) {
                        leaf.ox += leaf.vx * dt; leaf.oy += leaf.vy * dt; leaf.rot += leaf.rotSpeed * dt; leaf.phase += dt * 2;
                        leaf.ox += Math.sin(leaf.phase) * 0.02 * dt;
                        if (Math.abs(leaf.ox) > half * 1.3 || Math.abs(leaf.oy) > half * 1.3) { Object.assign(leaf, this.spawnLeaf(half)); leaf.oy = -half * 0.8; }
                    }
                    break;
                case "ice": for (const spark of this.sparkles[i]) spark.phase += dt * spark.speed; break;
            }
        }
    }

    private getAffineBasis(cx: number, cy: number): { pos: {x: number; y: number}; ax: number; ay: number; bx: number; by: number } {
        const o = this.coordTransform(cx, cy);
        const px = this.coordTransform(cx + 1, cy);
        const py = this.coordTransform(cx, cy + 1);
        return {
            pos: o,
            ax: px.x - o.x, ay: px.y - o.y,
            bx: py.x - o.x, by: py.y - o.y,
        };
    }

    private applyRoomTransform(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
        const {pos, ax, ay, bx, by} = this.getAffineBasis(cx, cy);
        ctx.save();
        ctx.transform(ax, ay, bx, by, pos.x, pos.y);
    }

    private drawWater(ctx: CanvasRenderingContext2D, room: TerrainRoom, state: RippleState) {
        const rs = room.size ?? 0.6, half = rs / 2, color = EFFECT_COLORS.water;
        const seed1 = (room.x * 7.3 + room.y * 13.7) % 1, seed2 = (room.x * 3.1 + room.y * 11.9) % 1;
        this.applyRoomTransform(ctx, room.x, room.y);
        for (let r = 0; r < 3; r++) {
            const ox = (((r * 0.37 + seed1) % 1) - 0.5) * half * 0.8;
            const oy = (((r * 0.53 + seed2) % 1) - 0.5) * half * 0.8;
            const t = ((state.phase + r * 2.1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            const progress = t / (Math.PI * 2);
            const radius = (half * 0.1) + (half * 0.7) * progress;
            const alpha = 0.7 * (1 - progress);
            if (alpha <= 0.03) continue;
            ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.025, 1.2 / this.scale);
            ctx.beginPath(); ctx.arc(ox, oy, radius, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
    }

    private drawForest(ctx: CanvasRenderingContext2D, room: TerrainRoom, leaves: LeafParticle[]) {
        const color = EFFECT_COLORS.forest;
        this.applyRoomTransform(ctx, room.x, room.y);
        for (const leaf of leaves) {
            ctx.globalAlpha = leaf.opacity; ctx.fillStyle = color;
            ctx.save(); ctx.translate(leaf.ox, leaf.oy); ctx.rotate(leaf.rot);
            ctx.beginPath(); ctx.ellipse(0, 0, leaf.size, leaf.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    private drawLava(ctx: CanvasRenderingContext2D, room: TerrainRoom, state: RippleState) {
        const rs = room.size ?? 0.6, half = rs / 2;
        this.applyRoomTransform(ctx, room.x, room.y);
        const radius = half * 0.7;
        ctx.globalAlpha = 0.3 + 0.3 * Math.sin(state.phase);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStop(0, '#ff6600'); grad.addColorStop(0.5, '#ff2200'); grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        const flicker = Math.sin(state.phase * 3.7) * 0.5 + 0.5;
        if (flicker > 0.7) {
            ctx.globalAlpha = (flicker - 0.7) * 2; ctx.fillStyle = '#ffaa00';
            ctx.beginPath(); ctx.arc(Math.cos(state.phase * 2.3) * half * 0.3, Math.sin(state.phase * 1.7) * half * 0.3, 0.04, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    private drawIce(ctx: CanvasRenderingContext2D, room: TerrainRoom, sparkles: SparkleState[]) {
        const rs = room.size ?? 0.6, half = rs / 2;
        const color = EFFECT_COLORS.ice;
        this.applyRoomTransform(ctx, room.x, room.y);
        ctx.globalAlpha = 0.15;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, half * 0.8);
        grad.addColorStop(0, '#cceeff'); grad.addColorStop(0.6, '#aaddff'); grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, half * 0.8, 0, Math.PI * 2); ctx.fill();
        for (const spark of sparkles) {
            const alpha = Math.max(0, Math.sin(spark.phase));
            if (alpha < 0.05) continue;
            ctx.globalAlpha = alpha; ctx.fillStyle = color;
            const sx = spark.ox, sy = spark.oy, r = Math.max(spark.size, 1 / this.scale);
            ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx, sy - r * 0.3); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r * 0.3); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * 0.3, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r * 0.3, sy); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }
}
