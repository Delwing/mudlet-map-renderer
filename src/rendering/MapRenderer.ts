import type {IMapReader} from "../reader/MapReader";
import type {IArea} from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import {KonvaRenderBackend} from "./KonvaRenderBackend";
import type {CoordFn} from "../coord/CoordFn";
import type {Style} from "../style";
import {identityStyle} from "../style";
import type {Camera} from "../camera/Camera";
import type {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {Exporter, ExportContext, ExportCanvas} from "../export/Exporter";
import type {DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from "../ScenePipeline";
import type {HitTester, HitResult} from "../hit/HitTester";

/**
 * Contract for interactive render backends.
 *
 * Engine-neutral surface — anything that requires a specific render engine
 * (Konva layers for live effects, Konva.Stage for `toCanvas`) is intentionally
 * not on this interface and lives only on the concrete backend.
 */
export interface InteractiveBackend {
    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly hitTester: HitTester;
    readonly events: TypedEventEmitter<RendererEventMap>;
    /** Forward map → render-space transform from the active style (identity for flat styles). */
    readonly coordinateTransform: CoordFn;
    /**
     * Apply a target-agnostic {@link Style} to the live scene. The style
     * transforms world-space shapes (paint, geometry, projection) before they
     * are rasterized; the backend re-renders the current scene to reflect it.
     */
    setStyle(style: Style): void;
    updateBackground(): void;
    refresh(): void;
    /** Capture the current camera as a canvas with background fill. */
    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined;
    addSceneOverlay(id: string, overlay: SceneOverlay): void;
    removeSceneOverlay(id: string): void;
    getSceneOverlays(): Iterable<SceneOverlay>;
    /**
     * Snapshot of inter-room exits as drawn in the last `buildScene` call
     * (polyline segments, arrows, bounds, dashes — exactly what the user
     * sees). Empty before the first draw. The list already reflects the
     * renderer's suppression rules, so anything drawn appears here and
     * anything not drawn does not.
     */
    getDrawnExits(): readonly DrawnExitEntry[];
    /** Companion to {@link getDrawnExits} for custom-line special exits. */
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[];
    /** Companion to {@link getDrawnExits} for one-way stub indicators. */
    getDrawnStubs(): readonly DrawnStubEntry[];
    destroy(): void;
}

/**
 * Unified map renderer facade.
 *
 * Public surface is intentionally narrow:
 * - **State mutations** (`drawArea`, `setPosition`, `renderHighlight`, …) emit
 *   events through `MapState` that the interactive backend reacts to.
 * - **{@link setStyle}** applies a target-agnostic visual transformation to the
 *   interactive canvas and every exporter.
 * - **{@link export}** runs an {@link Exporter} plug-in and returns its output
 *   (SVG string, PNG data URL, canvas, PDF bytes, …). New formats are added by
 *   shipping new `Exporter<T>` implementations — no new methods on this class.
 * - **{@link addSceneOverlay}** is target-agnostic and appears in every output.
 * - **{@link addLiveEffect}** registers interactive-only animated effects (Konva
 *   canvas only; skipped by exporters).
 */
export class MapRenderer {
    readonly state: MapState;
    readonly backend: InteractiveBackend;
    private currentStyle: Style = identityStyle;

    get settings(): Settings {
        return this.state.settings;
    }

    /** Camera owned by the active interactive backend. */
    get camera(): Camera {
        return this.backend.camera;
    }

    /** Culling manager owned by the active interactive backend. */
    get culling(): CullingManager {
        return this.backend.culling;
    }

    /** Hit-test index owned by the active interactive backend. */
    get hitTester(): HitTester {
        return this.backend.hitTester;
    }

    /** Renderer event emitter (room click, area exit click, zoom change, …). */
    get events(): TypedEventEmitter<RendererEventMap> {
        return this.backend.events;
    }

    /**
     * @param mapReader       Map data source.
     * @param settings        Renderer settings. Defaults to `createSettings()`.
     * @param container       DOM element for interactive rendering. Omit for headless.
     * @param backendFactory  Optional factory that receives the `MapState` and returns
     *   a custom `InteractiveBackend`. When omitted, a `KonvaRenderBackend` is created.
     */
    constructor(
        mapReader: IMapReader,
        settings?: Settings,
        container?: HTMLDivElement,
        backendFactory?: (state: MapState) => InteractiveBackend,
    ) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.backend = backendFactory
            ? backendFactory(this.state)
            : new KonvaRenderBackend(this.state, container);
    }

    destroy() {
        this.backend.destroy();
    }

    // --- State mutations (emit events → backend reacts) ---

    drawArea(id: number, zIndex: number) {
        this.state.setArea(id, zIndex);
    }

    getCurrentArea(): IArea | undefined {
        return this.state.currentAreaInstance;
    }

    setPosition(roomId: number, center: boolean = true) {
        this.state.setPosition(roomId, center);
    }

    updatePositionMarker(roomId: number) {
        this.state.updatePositionMarker(roomId);
    }

    clearPosition() {
        this.state.clearPosition();
    }

    centerOn(roomId: number, instant?: boolean) {
        this.state.setCenterRoom(roomId, instant);
    }

    renderHighlight(roomId: number, color: string) {
        this.state.addHighlight(roomId, color);
    }

    removeHighlight(roomId: number) {
        this.state.removeHighlight(roomId);
    }

    hasHighlight(roomId: number): boolean {
        return this.state.hasHighlight(roomId);
    }

    clearHighlights() {
        this.state.clearHighlights();
    }

    renderPath(locations: number[], color?: string) {
        this.state.addPath(locations, color);
    }

    clearPaths() {
        this.state.clearPaths();
    }

    refreshCurrentRoomOverlay() {
        this.state.refreshPosition();
    }

    // --- Style ---

    /**
     * Apply a {@link Style} to the interactive canvas and every export path.
     * The backend rebuilds the current scene under the new style — no explicit
     * `refresh()` is needed.
     *
     * ```ts
     * import {compose, Parchment, Sketchy} from 'mudlet-map-renderer';
     * renderer.setStyle(compose(Parchment, Sketchy({jitter: 0.012, color: '#4a3728'})));
     * ```
     *
     * Pass `identityStyle` (or call {@link clearStyle}) to remove the current style.
     */
    setStyle(style: Style) {
        this.currentStyle = style;
        this.backend.setStyle(style);
    }

    /** Equivalent to `setStyle(identityStyle)`. */
    clearStyle() {
        this.setStyle(identityStyle);
    }

    /** Returns the style currently applied (defaults to identity). */
    getStyle(): Style {
        return this.currentStyle;
    }

    updateBackground() {
        this.backend.updateBackground();
    }

    refresh() {
        this.backend.updateBackground();
        this.backend.refresh();
    }

    // --- Overlays ---

    /** Target-agnostic overlay; appears in every output including exporters. */
    addSceneOverlay(id: string, overlay: SceneOverlay) {
        this.backend.addSceneOverlay(id, overlay);
    }

    removeSceneOverlay(id: string) {
        this.backend.removeSceneOverlay(id);
    }

    /**
     * Register an interactive-only animated effect. No-ops when running with a
     * non-Konva backend. Does not appear in SVG/PNG exports — use
     * {@link addSceneOverlay} for overlays that must appear in exports.
     *
     * ```ts
     * renderer.addLiveEffect('rain', new RainEffect());
     * ```
     */
    addLiveEffect(id: string, effect: LiveEffect) {
        if (this.backend instanceof KonvaRenderBackend) {
            this.backend.addLiveEffect(id, effect);
        }
    }

    removeLiveEffect(id: string) {
        if (this.backend instanceof KonvaRenderBackend) {
            this.backend.removeLiveEffect(id);
        }
    }

    // --- Hit testing ---

    /**
     * Hit-test a world-space map point against the current scene.
     *
     * Returns the nearest pickable shape at `(worldX, worldY)`, or `null`
     * when no hittable shape is within range.  Coordinates must be in the
     * same flat map space as room positions — the method applies the active
     * style's world→scene projection internally, so callers never need to
     * think about Isometric mode.
     *
     * ```ts
     * const hit = renderer.hitTest(room.x, room.y);
     * if (hit?.kind === 'room') console.log('room', hit.id);
     * ```
     */
    hitTest(worldX: number, worldY: number): HitResult | null {
        const rendered = this.backend.coordinateTransform(worldX, worldY);
        return this.backend.hitTester.pick(rendered.x, rendered.y);
    }

    // --- Drawn geometry (hit-testing integration) ---

    /**
     * Polyline / arrow / bounds data for every inter-room exit the renderer
     * drew on the last scene build. Intended for tools (e.g. editors) that
     * need to hit-test against exactly what the user sees, including dash
     * patterns, one-way arrows, and the renderer's suppression rules.
     */
    getDrawnExits(): readonly DrawnExitEntry[] {
        return this.backend.getDrawnExits();
    }

    /** Companion to {@link getDrawnExits} for custom-line special exits. */
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] {
        return this.backend.getDrawnSpecialExits();
    }

    /**
     * Polyline data for every one-way stub indicator the renderer drew
     * (one entry per direction in `room.stubs`). Coordinates are in
     * render space and match what's on screen.
     */
    getDrawnStubs(): readonly DrawnStubEntry[] {
        return this.backend.getDrawnStubs();
    }

    // --- Export ---

    /**
     * Run an {@link Exporter} against the current scene and return its output.
     *
     * ```ts
     * const svg    = renderer.export(new SvgExporter({ padding: 5 }));
     * const url    = renderer.export(new PngExporter({ pixelRatio: 2 }));
     * const blob   = await renderer.export(new PngBlobExporter());
     * const canvas = renderer.export(new CanvasExporter({ width, height }));
     * ```
     */
    export<T>(exporter: Exporter<T>): T {
        const context: ExportContext = {
            state: this.state,
            backend: this.backend,
            style: this.currentStyle,
            sceneOverlays: this.backend.getSceneOverlays(),
        };
        return exporter.render(context);
    }

    // --- Camera & interaction ---

    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.backend.events.off(event, handler);
    }

    setZoom(zoom: number): boolean {
        return this.backend.camera.setZoom(zoom);
    }

    zoomToCenter(zoom: number): boolean {
        return this.backend.camera.zoomToCenter(zoom);
    }

    getZoom(): number {
        return this.backend.camera.zoom;
    }

    getViewportBounds(): ViewportBounds {
        return this.backend.camera.getViewportBounds();
    }

    getAreaBounds(): ViewportBounds | null {
        if (!this.state.currentAreaInstance || this.state.currentZIndex === undefined) return null;
        const plane = this.state.currentAreaInstance.getPlane(this.state.currentZIndex);
        if (!plane) return null;
        const b = this.state.getEffectiveBounds(this.state.currentAreaInstance, plane);
        const areaName = this.state.settings.areaName ? this.state.currentAreaInstance.getAreaName() : null;
        // Mirror the offsets used by computeExportBounds so that getAreaBounds()
        // covers the same region the export/preview image will render.
        const nameRight = areaName ? b.minX - 3.5 + areaName.length * 2.5 * 0.6 : b.maxX;
        const raw: ViewportBounds = {
            minX: areaName ? b.minX - 3.5 : b.minX,
            maxX: Math.max(b.maxX, nameRight),
            minY: areaName ? b.minY - 7 : b.minY,
            maxY: b.maxY,
        };
        const fn = this.backend.coordinateTransform;
        const c1 = fn(raw.minX, raw.minY);
        const c2 = fn(raw.maxX, raw.minY);
        const c3 = fn(raw.maxX, raw.maxY);
        const c4 = fn(raw.minX, raw.maxY);
        return {
            minX: Math.min(c1.x, c2.x, c3.x, c4.x),
            maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
            minY: Math.min(c1.y, c2.y, c3.y, c4.y),
            maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
        };
    }

    fitArea(insets?: { top?: number; right?: number; bottom?: number; left?: number }) {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.backend.camera.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, insets);
    }

    get centerOnResize(): boolean {
        return this.backend.camera.centerOnResize;
    }

    set centerOnResize(value: boolean) {
        this.backend.camera.centerOnResize = value;
    }

    get minZoom(): number {
        return this.backend.camera.minZoom;
    }

    set minZoom(value: number) {
        this.backend.camera.minZoom = value;
    }

    setCullingMode(mode: CullingMode) {
        this.state.settings.cullingMode = mode;
        this.state.settings.cullingEnabled = mode !== "none";
        this.backend.culling.scheduleCulling();
    }

    getCullingMode(): CullingMode {
        return this.state.settings.cullingMode;
    }
}
