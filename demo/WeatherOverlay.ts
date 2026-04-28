import type {ViewportBounds} from "@src/types/Settings";
import type {SceneOverlay, SceneOverlayContext, CanvasDrawState} from "@src";

export type WeatherType = "rain" | "snow" | "fog" | "dust" | "none";

export type WeatherStyle = {
    type: WeatherType;
    intensity: number;
    windAngle: number;
    windStrength: number;
    color?: string;
    opacity?: number;
};

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    opacity: number;
    phase: number;
    scale: number;
};

const DEFAULT_COLORS: Record<WeatherType, string> = {
    rain: '#aaccff',
    snow: '#ffffff',
    fog: '#cccccc',
    dust: '#c8a882',
    none: '#ffffff',
};

const DEFAULT_OPACITY: Record<WeatherType, number> = {
    rain: 0.5,
    snow: 0.7,
    fog: 0.3,
    dust: 0.6,
    none: 0,
};

export class WeatherOverlay implements SceneOverlay {
    private particles: Particle[] = [];
    private style: WeatherStyle;
    private bounds: ViewportBounds = {minX: 0, maxX: 10, minY: 0, maxY: 10};
    private scale: number = 75;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private unsubFrame?: () => void;

    constructor() {
        this.style = {type: "none", intensity: 0.5, windAngle: 10, windStrength: 1.0};
    }

    attach(ctx: SceneOverlayContext) {
        this.unsubFrame = ctx.onFrame((dt) => {
            if (this.style.type === "none") return;
            this.updateParticles(dt);
        });
    }

    detach() {
        this.unsubFrame?.();
        this.unsubFrame = undefined;
    }

    setStyle(style: WeatherStyle) {
        const typeChanged = this.style.type !== style.type;
        this.style = style;
        if (style.type === "none") {
            this.particles = [];
            return;
        }
        if (typeChanged || this.particles.length === 0) {
            this.initParticles();
        }
    }

    draw(ctx: CanvasRenderingContext2D, state: CanvasDrawState) {
        this.bounds = state.bounds;
        this.scale = state.scale;
        this.canvasWidth = state.canvasWidth;
        this.canvasHeight = state.canvasHeight;
        if (this.style.type === "none" || this.particles.length === 0) return;
        const color = this.style.color ?? DEFAULT_COLORS[this.style.type];
        const baseOpacity = this.style.opacity ?? DEFAULT_OPACITY[this.style.type];
        ctx.save();
        switch (this.style.type) {
            case "rain": this.drawRain(ctx, color, baseOpacity); break;
            case "snow": this.drawSnow(ctx, color, baseOpacity); break;
            case "dust": this.drawDust(ctx, color, baseOpacity); break;
            case "fog": this.drawFog(ctx, color, baseOpacity, state); break;
        }
        ctx.restore();
    }

    private viewW(): number { return this.bounds.maxX - this.bounds.minX; }
    private viewH(): number { return this.bounds.maxY - this.bounds.minY; }
    private margin(): number { return Math.max(this.viewW(), this.viewH()) * 0.5; }

    private getParticleCount(): number {
        const area = this.viewW() * this.viewH();
        const densityMap: Record<WeatherType, number> = {rain: 5, snow: 3, fog: 0.3, dust: 2, none: 0};
        const count = Math.round(area * (densityMap[this.style.type] ?? 0) * this.style.intensity);
        if (this.style.type === "fog") return Math.min(count, 40);
        return count;
    }

    private initParticles() {
        const count = this.getParticleCount();
        this.particles = [];
        for (let i = 0; i < count; i++) this.particles.push(this.spawnParticle(true));
    }

    private spawnParticle(scatter: boolean): Particle {
        const {minX, maxX, minY, maxY} = this.bounds;
        const m = this.margin();
        const windRad = (this.style.windAngle * Math.PI) / 180;
        const wx = Math.sin(windRad) * this.style.windStrength;
        const x = minX - m + Math.random() * (maxX - minX + m * 2);
        const y = scatter ? minY - m + Math.random() * (maxY - minY + m * 2) : minY - m - Math.random() * 2;

        switch (this.style.type) {
            case "rain": {
                const speed = 3 + Math.random() * 4;
                return {x, y, vx: wx * speed * 0.3, vy: speed, size: 0.02 + Math.random() * 0.03, opacity: 0.3 + Math.random() * 0.4, phase: 0, scale: 1};
            }
            case "snow": {
                const speed = 0.8 + Math.random();
                return {x, y, vx: wx * 0.4, vy: speed, size: 0.03 + Math.random() * 0.06, opacity: 0.5 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2, scale: 1};
            }
            case "dust": {
                const hSpeed = (0.3 + Math.random() * 0.6) * (wx >= 0 ? 1 : -1) * Math.max(Math.abs(wx), 0.5);
                return {x: scatter ? x : (wx >= 0 ? minX - m : maxX + m), y: minY - m + Math.random() * (maxY - minY + m * 2), vx: hSpeed, vy: -0.1 + Math.random() * 0.2, size: 0.02 + Math.random() * 0.05, opacity: 0.4 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2, scale: 1};
            }
            case "fog":
            default:
                return {x: Math.random(), y: Math.random(), vx: (0.01 + Math.random() * 0.02) * (wx >= 0 ? 1 : -1), vy: -0.005 + Math.random() * 0.01, size: 2 + Math.random() * 4, opacity: 0.08 + Math.random() * 0.15, phase: Math.random() * Math.PI * 2, scale: 1.5 + Math.random() * 2.5};
        }
    }

    private updateParticles(dt: number) {
        const {minX, maxX, minY, maxY} = this.bounds;
        const m = this.margin();
        const targetCount = this.getParticleCount();
        while (this.particles.length < targetCount) this.particles.push(this.spawnParticle(true));
        while (this.particles.length > targetCount) this.particles.pop();

        const isFog = this.style.type === "fog";
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (this.style.type === "snow") { p.phase += dt * 1.5; p.x += Math.sin(p.phase) * 0.15 * dt; }
            if (this.style.type === "dust") { p.phase += dt * 3; p.y += Math.sin(p.phase) * 0.2 * dt; p.x += Math.cos(p.phase * 0.7) * 0.05 * dt; }
            if (isFog) {
                p.phase += dt * 0.3; p.y += Math.sin(p.phase) * 0.01 * dt;
                if (p.x > 1.3) p.x -= 1.6; if (p.x < -0.3) p.x += 1.6;
                if (p.y > 1.3) p.y -= 1.6; if (p.y < -0.3) p.y += 1.6;
                continue;
            }
            if (p.y > maxY + m || p.y < minY - m || p.x > maxX + m || p.x < minX - m) this.particles[i] = this.spawnParticle(false);
        }
    }

    private drawRain(ctx: CanvasRenderingContext2D, color: string, baseOpacity: number) {
        const minWidth = 0.8 / this.scale, minLen = 4 / this.scale;
        ctx.lineCap = 'round';
        for (const p of this.particles) {
            const len = Math.max(p.vy * 0.06, minLen);
            ctx.strokeStyle = color; ctx.globalAlpha = p.opacity * baseOpacity; ctx.lineWidth = Math.max(p.size, minWidth);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * 0.06, p.y + len); ctx.stroke();
        }
    }

    private drawSnow(ctx: CanvasRenderingContext2D, color: string, baseOpacity: number) {
        const minRadius = 1.2 / this.scale;
        ctx.fillStyle = color;
        for (const p of this.particles) {
            ctx.globalAlpha = p.opacity * baseOpacity;
            ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(p.size, minRadius), 0, Math.PI * 2); ctx.fill();
        }
    }

    private drawDust(ctx: CanvasRenderingContext2D, color: string, baseOpacity: number) {
        const minRadius = 1;
        ctx.fillStyle = color;
        for (const p of this.particles) {
            ctx.globalAlpha = p.opacity * baseOpacity;
            ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(minRadius / this.scale, p.size), 0, Math.PI * 2); ctx.fill();
        }
    }

    private drawFog(ctx: CanvasRenderingContext2D, color: string, baseOpacity: number, state: CanvasDrawState) {
        const sw = state.canvasWidth, sh = state.canvasHeight;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const p of this.particles) {
            const sx = p.x * sw, sy = p.y * sh, r = 120 * p.scale;
            ctx.globalAlpha = p.opacity * baseOpacity;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
            grad.addColorStop(0, color); grad.addColorStop(0.4, color); grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
}
