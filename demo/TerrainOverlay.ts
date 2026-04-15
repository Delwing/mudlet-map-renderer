import Konva from "konva";
import type {ViewportBounds} from "@src/types/Settings";
import type {OverlayPlugin} from "@src/types/OverlayPlugin";

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

export class TerrainOverlay implements OverlayPlugin {
    private layer!: Konva.Layer;
    private shape!: Konva.Shape;
    private rooms: TerrainRoom[] = [];
    private bounds: ViewportBounds = {minX: 0, maxX: 10, minY: 0, maxY: 10};
    private scale: number = 75;
    private animation: Konva.Animation | null = null;
    private time: number = 0;
    private destroyed = false;
    private ripples: RippleState[] = [];
    private leaves: LeafParticle[][] = [];
    private sparkles: SparkleState[][] = [];

    attach(layer: Konva.Layer) {
        this.layer = layer;
        this.shape = new Konva.Shape({
            listening: false, perfectDrawEnabled: false,
            sceneFunc: (ctx) => { this.draw((ctx as any)._context); },
        });
        layer.add(this.shape);
    }

    setRooms(rooms: TerrainRoom[]) {
        this.rooms = rooms;
        this.initState();
        if (rooms.length > 0 && this.layer) this.startAnimation();
        else this.stopAnimation();
    }

    updateViewport(bounds: ViewportBounds, scale?: number) {
        this.bounds = bounds;
        if (scale !== undefined) this.scale = scale;
    }

    destroy() {
        this.destroyed = true;
        this.stopAnimation();
        if (this.shape) this.shape.destroy();
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
                    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++)
                        ss.push({ox: (Math.random() - 0.5) * rs * 0.8, oy: (Math.random() - 0.5) * rs * 0.8, phase: Math.random() * Math.PI * 2, speed: 1.5 + Math.random() * 2, size: 0.02 + Math.random() * 0.03});
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

    private draw(ctx: CanvasRenderingContext2D) {
        if (this.rooms.length === 0) return;
        const {minX, maxX, minY, maxY} = this.bounds;
        ctx.save();
        for (let i = 0; i < this.rooms.length; i++) {
            const room = this.rooms[i];
            if (room.x < minX - 1 || room.x > maxX + 1 || room.y < minY - 1 || room.y > maxY + 1) continue;
            switch (room.effect) {
                case "water": this.drawWater(ctx, room, this.ripples[i]); break;
                case "forest": this.drawForest(ctx, room, this.leaves[i]); break;
                case "lava": this.drawLava(ctx, room, this.ripples[i]); break;
                case "ice": this.drawIce(ctx, room, this.sparkles[i]); break;
            }
        }
        ctx.restore();
    }

    private drawWater(ctx: CanvasRenderingContext2D, room: TerrainRoom, state: RippleState) {
        const rs = room.size ?? 0.6, half = rs / 2, color = EFFECT_COLORS.water;
        const seed1 = (room.x * 7.3 + room.y * 13.7) % 1, seed2 = (room.x * 3.1 + room.y * 11.9) % 1;
        for (let r = 0; r < 3; r++) {
            const ox = (((r * 0.37 + seed1) % 1) - 0.5) * half * 0.8;
            const oy = (((r * 0.53 + seed2) % 1) - 0.5) * half * 0.8;
            const t = ((state.phase + r * 2.1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            const progress = t / (Math.PI * 2);
            const radius = (half * 0.1) + (half * 0.7) * progress;
            const alpha = 0.7 * (1 - progress);
            if (alpha <= 0.03) continue;
            ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.025, 1.2 / this.scale);
            ctx.beginPath(); ctx.arc(room.x + ox, room.y + oy, radius, 0, Math.PI * 2); ctx.stroke();
        }
    }

    private drawForest(ctx: CanvasRenderingContext2D, room: TerrainRoom, leaves: LeafParticle[]) {
        const color = EFFECT_COLORS.forest;
        for (const leaf of leaves) {
            ctx.globalAlpha = leaf.opacity; ctx.fillStyle = color;
            ctx.save(); ctx.translate(room.x + leaf.ox, room.y + leaf.oy); ctx.rotate(leaf.rot);
            ctx.beginPath(); ctx.ellipse(0, 0, leaf.size, leaf.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }

    private drawLava(ctx: CanvasRenderingContext2D, room: TerrainRoom, state: RippleState) {
        const rs = room.size ?? 0.6, half = rs / 2, cx = room.x, cy = room.y;
        const pulse = 0.3 + 0.3 * Math.sin(state.phase), radius = half * 0.7;
        ctx.globalAlpha = pulse;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, '#ff6600'); grad.addColorStop(0.5, '#ff2200'); grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
        const flicker = Math.sin(state.phase * 3.7) * 0.5 + 0.5;
        if (flicker > 0.7) {
            ctx.globalAlpha = (flicker - 0.7) * 2; ctx.fillStyle = '#ffaa00';
            ctx.beginPath(); ctx.arc(cx + Math.cos(state.phase * 2.3) * half * 0.3, cy + Math.sin(state.phase * 1.7) * half * 0.3, 0.04, 0, Math.PI * 2); ctx.fill();
        }
    }

    private drawIce(ctx: CanvasRenderingContext2D, room: TerrainRoom, sparkles: SparkleState[]) {
        const cx = room.x, cy = room.y, color = EFFECT_COLORS.ice;
        for (const spark of sparkles) {
            const alpha = Math.max(0, Math.sin(spark.phase));
            if (alpha < 0.05) continue;
            ctx.globalAlpha = alpha * 0.8; ctx.fillStyle = color;
            const sx = cx + spark.ox, sy = cy + spark.oy, r = Math.max(spark.size, 1 / this.scale);
            ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx, sy - r * 0.3); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r * 0.3); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * 0.3, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r * 0.3, sy); ctx.closePath(); ctx.fill();
        }
    }

    private startAnimation() {
        if (this.animation) return;
        let lastTime = performance.now();
        this.animation = new Konva.Animation((frame) => {
            if (this.destroyed || this.rooms.length === 0) { this.stopAnimation(); return; }
            const now = frame?.time ?? performance.now();
            const dt = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now; this.update(dt);
        }, this.layer);
        this.animation.start();
    }

    private stopAnimation() {
        if (this.animation) { this.animation.stop(); this.animation = null; }
    }
}
