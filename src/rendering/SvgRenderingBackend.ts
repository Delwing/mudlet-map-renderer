import {CanvasBackend} from '../backend/CanvasBackend';
import {SvgLayerNode} from '../backend/SvgLayerNode';
import type {DrawingBackend, CoordFn, Style, GroupNode} from '../backend/DrawingBackend';
import {IDENTITY_TRANSFORM} from '../backend/DrawingBackend';
import type {Camera} from '../Camera';
import type {RendererEventMap, ViewportBounds} from '../types/Settings';
import type {SceneBuildResult, DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from '../ScenePipeline';
import type {SceneOverlay} from '../overlay/SceneOverlay';
import type {ExportCanvas} from '../export/Exporter';
import type {MapRenderer, RenderingBackend} from './MapRenderer';
import {TypedEventEmitter} from '../TypedEventEmitter';

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * SVG rendering backend. Attaches to MapRenderer and renders the current scene
 * into SvgLayerNodes backed by DrawCommand[]. Call toSvg() to serialise.
 *
 * ```ts
 * // Export what's currently on screen:
 * const svg = new SvgRenderingBackend(renderer, renderer.camera);
 * const output = svg.toSvg();
 * svg.destroy();
 *
 * // Export full area with its own camera:
 * const cam = new Camera(1920, 1080);
 * cam.fitToMapBounds(renderer.getAreaBounds()!.minX, renderer.getAreaBounds()!.maxX, ...);
 * const svg = new SvgRenderingBackend(renderer, cam, style);
 * const output = svg.toSvg();
 * svg.destroy();
 * ```
 */
export class SvgRenderingBackend implements RenderingBackend {
    readonly gridLayer    = new SvgLayerNode();
    readonly linkLayer    = new SvgLayerNode();
    readonly roomLayer    = new SvgLayerNode();
    readonly topLabelLayer = new SvgLayerNode();
    readonly overlayLayer = new SvgLayerNode();
    readonly positionLayer = new SvgLayerNode();

    readonly drawingBackend: DrawingBackend;
    readonly coordinateTransform: CoordFn;
    readonly camera: Camera;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private readonly renderer: MapRenderer;
    private lastBuildResult?: SceneBuildResult;

    constructor(renderer: MapRenderer, camera: Camera, style?: Style) {
        this.renderer = renderer;
        this.camera = camera;
        const base = new CanvasBackend();
        this.drawingBackend = style ? style(base) : base;
        this.coordinateTransform = this.drawingBackend.getTransform();
        this.events = new TypedEventEmitter<RendererEventMap>();
        renderer._attachBackend(this);
    }

    // --- RenderingBackend: lifecycle callbacks (static export — mostly no-ops) ---

    onCameraChanged(_scale: number, _position: { x: number; y: number }, _viewportBounds: ViewportBounds): void {}

    onPositionChanged(_roomId: number | undefined, _center: boolean, _areaChanged: boolean): void {}

    animatePanTo(_renderX: number, _renderY: number): void {}

    setStyle(_style: Style): void {}

    updateBackground(): void {}

    onSceneOverlayAdded(_id: string, overlay: SceneOverlay): void {
        const bounds = this.camera.getViewportBounds();
        const out = overlay.render(this.drawingBackend, this.renderer.state, bounds);
        if (!out) return;
        const nodes = Array.isArray(out) ? out : [out];
        for (const node of nodes) this.overlayLayer.addNode(node);
    }

    onSceneOverlayRemoved(_id: string): void {}

    toCanvas(): ExportCanvas | undefined { return undefined; }

    exportCanvas(): ExportCanvas | undefined { return undefined; }

    getDrawnExits(): readonly DrawnExitEntry[] { return this.lastBuildResult?.drawnExits ?? []; }
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] { return this.lastBuildResult?.drawnSpecialExits ?? []; }
    getDrawnStubs(): readonly DrawnStubEntry[] { return this.lastBuildResult?.drawnStubs ?? []; }

    /** @internal — called by MapRenderer after building the scene for this backend. */
    _setLastBuildResult(result: SceneBuildResult): void {
        this.lastBuildResult = result;
    }

    destroy(): void {
        this.renderer._detachBackend(this);
    }

    // --- SVG serialisation ---

    /**
     * Assemble and return the full SVG string from all scene layers.
     * Pass the bounds to use as the SVG viewBox; if omitted, the camera's
     * viewport bounds are used.
     */
    toSvg(viewBounds?: { x: number; y: number; w: number; h: number }): string | undefined {
        const { state } = this.renderer;
        if (state.currentArea === undefined) return undefined;

        let x: number, y: number, w: number, h: number;
        if (viewBounds) {
            ({ x, y, w, h } = viewBounds);
        } else {
            const vp = this.camera.getViewportBounds();
            x = vp.minX; y = vp.minY;
            w = vp.maxX - vp.minX; h = vp.maxY - vp.minY;
        }

        const bg = state.settings.backgroundColor;
        const lines: string[] = [];
        lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">`);
        lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(bg)}"/>`);

        const gridSvg = this.gridLayer.toSvg();
        if (gridSvg) lines.push(gridSvg);
        const linkSvg = this.linkLayer.toSvg();
        if (linkSvg) lines.push(linkSvg);
        const roomSvg = this.roomLayer.toSvg();
        if (roomSvg) lines.push(roomSvg);
        const overlaySvg = this.overlayLayer.toSvg();
        if (overlaySvg) lines.push(overlaySvg);
        const topLabelSvg = this.topLabelLayer.toSvg();
        if (topLabelSvg) lines.push(topLabelSvg);

        lines.push('</svg>');
        return lines.join('\n');
    }
}
