/**
 * OffscreenCanvasBackend — opt-in {@link InteractiveBackend} that renders in a
 * Web Worker via `OffscreenCanvas`.
 *
 * The main thread keeps everything that must stay synchronous or that touches
 * the DOM: the {@link Camera}, {@link CullingManager}, {@link HitTester},
 * interaction handling, and the (text-measuring, therefore DOM-bound) scene
 * build. It styles the resulting shapes, then ships plain {@link Shape} lists to
 * the worker. The worker owns the per-frame hot path (cull → draw commands →
 * rasterise). See {@link renderFrame} and {@link worker}.
 *
 * Differences from {@link KonvaRenderBackend}:
 *  - `exportCanvas` returns `undefined` (the live canvas lives in the worker and
 *    isn't readable here) — use the headless `CanvasExporter`/`PngBytesExporter`,
 *    which rebuild from state. An async {@link captureViewport} is offered for
 *    callers that genuinely need a live snapshot.
 *  - Image shapes (image labels, ambient-light vignette) ARE supported: the
 *    worker decodes their `src` via `createImageBitmap` (see worker.ts).
 *  - Live effects ARE supported, but run on a main-thread Konva overlay stage
 *    composited above the worker canvas (Konva animations can't run in a
 *    worker); the map itself still rasterises off-thread.
 */

import Konva from "konva";
import type {InteractiveBackend} from "../MapRenderer";
import type {MapState} from "../../MapState";
import type {RendererEventMap} from "../../types/Settings";
import {Camera} from "../../camera/Camera";
import {CullingManager} from "../../CullingManager";
import {HitTester, type LayerOffset} from "../../hit/HitTester";
import {TypedEventEmitter} from "../../TypedEventEmitter";
import {InteractionHandler} from "../../InteractionHandler";
import {ScenePipeline, type SceneBuildResult, type DrawnExitEntry, type DrawnSpecialExitEntry, type DrawnStubEntry} from "../../ScenePipeline";
import {buildBuiltInOverlayShapes} from "../../export/flushSceneShapes";
import {layoutRoom} from "../../scene/elements/RoomLayout";
import {layoutInnerExits} from "../../scene/elements/ExitLayout";
import {computeSpecialExits} from "../../scene/SpecialExitStyle";
import {specialExitToShape} from "../../scene/elements/SpecialExitLayout";
import {computeStubs} from "../../scene/StubStyle";
import {stubToShape} from "../../scene/elements/StubLayout";
import type {Shape, GroupShape} from "../../scene/Shape";
import type {Style, StyleContext} from "../../style/Style";
import {identityStyle} from "../../style/Style";
import {applyStyleToShapes} from "../../style/applyStyle";
import type {CoordFn} from "../../coord/CoordFn";
import {IDENTITY_TRANSFORM} from "../../coord/CoordFn";
import type {SceneOverlay, SceneOverlayContext} from "../../overlay/SceneOverlay";
import type {LiveEffect} from "../../overlay/LiveEffect";
import type {ExportCanvas} from "../../export/Exporter";
import {serializeTransform} from "./serializeTransform";
import type {Bounds, LayerPayload, MainToWorkerMessage, WorkerToMainMessage} from "./protocol";

const currentRoomColor = "rgb(120, 72, 0)";

/** Transport the backend talks to. A real `Worker` satisfies this directly. */
export interface WorkerTransport {
    postMessage(message: MainToWorkerMessage, transfer?: Transferable[]): void;
    addEventListener?(type: "message", handler: (ev: {data: WorkerToMainMessage}) => void): void;
    onmessage?: ((ev: {data: WorkerToMainMessage}) => void) | null;
    terminate?(): void;
}

export interface OffscreenBackendOptions {
    /** Pre-created transport (used by the inline-worker factory and by tests). */
    transport?: WorkerTransport;
    /** Lazily create the transport. Ignored when {@link transport} is provided. */
    createTransport?: () => WorkerTransport;
    /** Override the device pixel ratio (tests / forcing 1x). */
    devicePixelRatio?: number;
}

function supportsOffscreen(): boolean {
    return (
        typeof document !== "undefined" &&
        typeof HTMLCanvasElement !== "undefined" &&
        typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
    );
}

export class OffscreenCanvasBackend implements InteractiveBackend {
    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;
    readonly hitTester: HitTester = new HitTester();

    private readonly state: MapState;
    private readonly container?: HTMLDivElement;
    private readonly transport?: WorkerTransport;
    private readonly pipeline: ScenePipeline;
    private readonly dpr: number;

    private currentStyle: Style = identityStyle;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;
    private coordinateLayerOffset: LayerOffset | undefined;

    private lastResult?: SceneBuildResult;
    private lastHitShapes: Shape[] = [];
    private boundsByShape: Map<Shape, Bounds> = new Map();

    private interactionHandler?: InteractionHandler;
    private cameraChangeHandler?: () => void;
    private readonly sceneOverlays: Map<string, SceneOverlay> = new Map();
    private readonly viewportSubscribers: Set<() => void> = new Set();
    private readonly liveEffects: Map<string, LiveEffect> = new Map();
    // Live effects can't run in the worker (Konva animations), so they render on
    // a main-thread Konva stage composited above the worker's canvas. The map
    // still rasterises off-thread; only the (light) effect animation is local.
    private liveEffectStage?: Konva.Stage;
    private liveEffectLayer?: Konva.Layer;
    private liveEffectHost?: HTMLDivElement;
    private readonly pendingExports: Map<number, (bitmap: ImageBitmap) => void> = new Map();
    private exportSeq = 0;
    private destroyed = false;

    constructor(state: MapState, container?: HTMLDivElement, options: OffscreenBackendOptions = {}) {
        this.state = state;
        this.container = container;
        this.pipeline = new ScenePipeline(state.mapReader, state.settings);
        this.dpr = options.devicePixelRatio ?? (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1);
        this.transport = options.transport ?? options.createTransport?.();

        const width = container?.clientWidth ?? 1;
        const height = container?.clientHeight ?? 1;
        this.camera = new Camera(width, height);
        this.events = new TypedEventEmitter<RendererEventMap>(container);
        this.culling = new CullingManager(state.settings, () => {
            // Culling runs in the worker per camera frame; a mode change just
            // needs the fresh settings + a redraw.
            this.postSettings();
            this.postCamera();
        });

        if (this.transport) {
            const onMessage = (ev: {data: WorkerToMainMessage}) => this.handleWorkerMessage(ev.data);
            if (this.transport.addEventListener) this.transport.addEventListener("message", onMessage);
            else this.transport.onmessage = onMessage;
        }

        if (container && this.transport && supportsOffscreen()) {
            // The map canvas and any live-effect overlay stack absolutely inside
            // the container, so it must establish a positioning context.
            if (getComputedStyle(container).position === "static") {
                container.style.position = "relative";
            }
            const canvas = document.createElement("canvas");
            canvas.style.position = "absolute";
            canvas.style.inset = "0";
            canvas.style.width = "100%";
            canvas.style.height = "100%";
            canvas.style.display = "block";
            container.appendChild(canvas);
            container.style.backgroundColor = state.settings.backgroundColor;
            const offscreen = canvas.transferControlToOffscreen();
            this.transport.postMessage(
                {type: "init", canvas: offscreen, width, height, dpr: this.dpr, settings: state.settings},
                [offscreen],
            );

            this.interactionHandler = new InteractionHandler(container, this.camera, state, {
                clientToMapPoint: (cx, cy) => this.camera.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                pickAtPoint: (x, y) => this.hitTester.pick(x, y),
            }, this.events);
        }

        this.cameraChangeHandler = () => this.onCameraChange();
        this.camera.on("change", this.cameraChangeHandler);

        this.applyStyleTransforms();
        this.subscribeToState(state);

        // Seed the worker with the current camera so it paints the background
        // before the first scene arrives.
        this.postCamera();
    }

    get coordinateTransform(): CoordFn {
        return this._coordinateTransform;
    }

    // --- Messaging ---

    private post(message: MainToWorkerMessage, transfer?: Transferable[]): void {
        if (this.destroyed || !this.transport) return;
        this.transport.postMessage(message, transfer);
    }

    private postSettings(): void {
        this.post({type: "settings", settings: this.state.settings});
    }

    private postCamera(): void {
        this.post({
            type: "camera",
            camera: {scale: this.camera.getScale(), offsetX: this.camera.position.x, offsetY: this.camera.position.y},
            viewport: this.camera.getViewportBounds(),
            width: this.camera.width,
            height: this.camera.height,
        });
    }

    private postScene(): void {
        const result = this.lastResult;
        if (!result) {
            this.post({
                type: "scene",
                link: {shapes: [], bounds: []},
                room: {shapes: [], bounds: []},
                topLabel: [],
                transform: serializeTransform(this.currentStyle),
            });
            return;
        }
        const ctx = this.styleContext();
        this.post({
            type: "scene",
            link: this.styleLayer(result.sceneShapes.link, ctx),
            room: this.styleLayer(result.sceneShapes.room, ctx),
            topLabel: this.styleShapes(result.sceneShapes.topLabel, ctx),
            transform: serializeTransform(this.currentStyle),
        });
    }

    private postOverlays(): void {
        const ctx = this.styleContext();
        const out: Shape[] = [];
        for (const s of this.buildCurrentRoomOverlayShapes()) out.push(...this.styleOne(s, ctx, false));
        for (const s of buildBuiltInOverlayShapes(this.state)) out.push(...this.styleOne(s, ctx, false));
        for (const overlay of this.sceneOverlays.values()) {
            const rendered = overlay.render(this.state, this.camera.getViewportBounds());
            if (!rendered) continue;
            const shapes = Array.isArray(rendered) ? rendered : [rendered];
            for (const s of shapes) out.push(...this.styleOne(s, ctx, overlay.sceneSpace ?? false));
        }
        this.post({type: "overlays", shapes: out});
    }

    // --- Styling helpers ---

    private styleContext(): StyleContext {
        return {scale: this.camera.getScale(), roomSize: this.state.settings.roomSize};
    }

    private styleOne(shape: Shape, ctx: StyleContext, bypass: boolean): Shape[] {
        if (bypass || this.currentStyle === identityStyle) return [shape];
        return applyStyleToShapes([shape], this.currentStyle, ctx);
    }

    private styleShapes(shapes: Shape[], ctx: StyleContext): Shape[] {
        if (this.currentStyle === identityStyle) return shapes;
        return applyStyleToShapes(shapes, this.currentStyle, ctx);
    }

    /** Style a scene layer, carrying each shape's world-space cull bounds through. */
    private styleLayer(shapes: Shape[], ctx: StyleContext): LayerPayload {
        const outShapes: Shape[] = [];
        const outBounds: Array<Bounds | null> = [];
        for (const shape of shapes) {
            const b = this.boundsByShape.get(shape) ?? null;
            const styled = this.currentStyle === identityStyle ? [shape] : applyStyleToShapes([shape], this.currentStyle, ctx);
            for (const s of styled) {
                outShapes.push(s);
                outBounds.push(b);
            }
        }
        return {shapes: outShapes, bounds: outBounds};
    }

    // --- Scene build ---

    refresh(): void {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.lastResult = undefined;
            this.lastHitShapes = [];
            this.boundsByShape.clear();
            this.hitTester.clear();
            this.postSettings();
            this.postScene();
            this.postOverlays();
            this.postCamera();
            return;
        }

        const result = this.pipeline.buildScene(currentAreaInstance, plane, currentZIndex, this.state.lens);
        this.lastResult = result;
        this.lastHitShapes = result.hitShapes;
        this.boundsByShape = this.buildBoundsMap(result);
        this.hitTester.build(this.lastHitShapes, this.state.settings.roomSize, this._coordinateTransform, this.coordinateLayerOffset);

        if (this.container) this.container.style.backgroundColor = this.state.settings.backgroundColor;

        this.postSettings();
        this.postScene();
        this.postOverlays();
        this.postCamera();

        // Position marker handled inside postOverlays; nothing else needed.
        void positionRoomId;
    }

    private buildBoundsMap(result: SceneBuildResult): Map<Shape, Bounds> {
        const map = new Map<Shape, Bounds>();
        const half = this.state.settings.roomSize / 2;
        for (const {room, shape} of result.roomShapeRefs.values()) {
            map.set(shape, {x: room.x - half, y: room.y - half, width: this.state.settings.roomSize, height: this.state.settings.roomSize});
        }
        for (const {shape, bounds} of result.standaloneExitShapeRefs) map.set(shape, bounds);
        for (const {shape, bounds} of result.labelShapeRefs) map.set(shape, bounds);
        for (const {shape, bounds} of result.specialExitShapeRefs) map.set(shape, bounds);
        for (const {shape, bounds} of result.stubShapeRefs) map.set(shape, bounds);
        for (const {shape, bounds} of result.areaExitLabelShapeRefs) map.set(shape, bounds);
        return map;
    }

    /** Port of {@link KonvaRenderBackend.updateCurrentRoomOverlay} returning shapes. */
    private buildCurrentRoomOverlayShapes(): Shape[] {
        const state = this.state;
        const roomId = state.positionRoomId;
        if (roomId === undefined) return [];
        const room = state.mapReader.getRoom(roomId);
        if (!room) return [];
        if (room.area !== state.currentArea || room.z !== state.currentZIndex) return [];
        const settings = state.settings;
        if (!settings.highlightCurrentRoom) return [];

        const out: Shape[] = [];
        const exitRenderer = this.pipeline.exitRenderer;
        const lens = state.lens;
        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        if (state.currentAreaInstance && state.currentZIndex !== undefined) {
            const exits = state.currentAreaInstance
                .getLinkExits(state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            for (const exit of exits) {
                const data = exitRenderer.renderDataWithColor(exit, currentRoomColor, state.currentZIndex);
                if (data) out.push(this.pipeline.buildExitShape(data));
            }
        }
        for (const se of computeSpecialExits(room, settings, currentRoomColor)) out.push(specialExitToShape(se, room.id));
        for (const stub of computeStubs(room, settings, currentRoomColor)) out.push(stubToShape(stub));

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const other = state.mapReader.getRoom(id as number);
            if (other && other.area === state.currentArea && other.z === state.currentZIndex && lens.isVisible(other)) {
                roomsToRedraw.set(other.id, other);
            }
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayShape: GroupShape = layoutRoom(roomToRedraw, state.mapReader, settings, {
                strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
                flatPipeline: true,
            });
            overlayShape.children.push(...layoutInnerExits(roomToRedraw, state.mapReader, settings));
            out.push(overlayShape);
        });

        return out;
    }

    // --- Style transform (mirrors KonvaRenderBackend.applyStyleTransforms) ---

    setStyle(style: Style): void {
        this.currentStyle = style;
        this.lastHitShapes = [];
        this.hitTester.clear();
        this.applyStyleTransforms();
        this.refresh();
    }

    private applyStyleTransforms(): void {
        const style = this.currentStyle;
        const forward: CoordFn = style.worldToScene ? (x, y) => style.worldToScene!(x, y) : IDENTITY_TRANSFORM;
        const newInverse: CoordFn = style.sceneToWorld ? (x, y) => style.sceneToWorld!(x, y) : IDENTITY_TRANSFORM;
        const oldInverse = this.coordinateInverse;
        const layerOffset: LayerOffset | undefined = style.sceneLayerOffset ? (layer) => style.sceneLayerOffset!(layer) : undefined;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.coordinateLayerOffset = layerOffset;
        this.culling.setCoordinateTransform(forward);
        if (this.lastHitShapes.length > 0) {
            this.hitTester.build(this.lastHitShapes, this.state.settings.roomSize, forward, layerOffset);
        }

        // Keep the same map point centred when the projection changes.
        const scale = this.camera.getScale();
        const screenCX = this.camera.width / 2;
        const screenCY = this.camera.height / 2;
        const oldRX = (screenCX - this.camera.position.x) / scale;
        const oldRY = (screenCY - this.camera.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);
        this.camera.position = {x: screenCX - nr.x * scale, y: screenCY - nr.y * scale};
        // position assignment does not notify; the upcoming refresh posts camera.
    }

    // --- Camera ---

    private onCameraChange(): void {
        this.postCamera();
        const vpBounds = this.camera.getViewportBounds();
        this.events.emit("pan", vpBounds);
        for (const cb of this.viewportSubscribers) cb();
        if (this.liveEffectStage) {
            this.syncEffectStage();
            const scale = this.camera.getScale();
            for (const effect of this.liveEffects.values()) {
                effect.updateViewport(vpBounds, scale, this._coordinateTransform);
            }
        }
    }

    // --- State subscriptions ---

    private subscribeToState(state: MapState): void {
        state.events.on("area", () => this.refresh());
        state.events.on("position", ({roomId, center, areaChanged}) => this.onPositionChanged(roomId, center, areaChanged));
        state.events.on("center", ({roomId, instant}) => {
            const room = state.mapReader.getRoom(roomId);
            if (room) {
                const p = this._coordinateTransform(room.x, room.y);
                this.camera.panToMapPointAnimated(p.x, p.y, instant || this.state.settings.instantMapMove);
            }
        });
        state.events.on("highlight", () => this.postOverlays());
        state.events.on("path", () => this.postOverlays());
        state.events.on("clear", () => this.postOverlays());
        state.events.on("lens", () => this.refresh());
    }

    private onPositionChanged(roomId: number | undefined, center: boolean, instant: boolean): void {
        if (roomId !== undefined && center) {
            const room = this.state.mapReader.getRoom(roomId);
            if (room) {
                const p = this._coordinateTransform(room.x, room.y);
                this.camera.panToMapPointAnimated(p.x, p.y, instant || this.state.settings.instantMapMove);
            }
        }
        this.postOverlays();
    }

    // --- Background ---

    updateBackground(): void {
        if (this.container) this.container.style.backgroundColor = this.state.settings.backgroundColor;
        this.postSettings();
        this.postCamera();
    }

    // --- Scene overlays ---

    addSceneOverlay(id: string, overlay: SceneOverlay): void {
        const existing = this.sceneOverlays.get(id);
        if (existing) existing.detach?.();
        this.sceneOverlays.set(id, overlay);
        overlay.attach?.(this.createOverlayContext(id, overlay));
        this.postOverlays();
    }

    removeSceneOverlay(id: string): void {
        const overlay = this.sceneOverlays.get(id);
        if (!overlay) return;
        overlay.detach?.();
        this.sceneOverlays.delete(id);
        this.postOverlays();
    }

    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    private createOverlayContext(id: string, overlay: SceneOverlay): SceneOverlayContext {
        return {
            state: this.state,
            onViewportChange: (cb) => {
                this.viewportSubscribers.add(cb);
                return () => this.viewportSubscribers.delete(cb);
            },
            invalidate: () => {
                if (this.sceneOverlays.get(id) !== overlay) return;
                this.postOverlays();
            },
        };
    }

    // --- Live effects (main-thread Konva overlay above the worker canvas) ---

    private ensureEffectStage(): void {
        if (this.liveEffectStage || !this.container) return;
        const host = document.createElement("div");
        host.style.position = "absolute";
        host.style.inset = "0";
        host.style.pointerEvents = "none"; // never intercept interaction
        this.container.appendChild(host);
        const stage = new Konva.Stage({
            container: host,
            width: this.camera.width,
            height: this.camera.height,
            listening: false,
        });
        const layer = new Konva.Layer({listening: false});
        stage.add(layer);
        this.liveEffectHost = host;
        this.liveEffectStage = stage;
        this.liveEffectLayer = layer;
        this.syncEffectStage();
    }

    /** Mirror the camera transform onto the effect stage so effects align with the map. */
    private syncEffectStage(): void {
        const stage = this.liveEffectStage;
        if (!stage) return;
        if (stage.width() !== this.camera.width || stage.height() !== this.camera.height) {
            stage.width(this.camera.width);
            stage.height(this.camera.height);
        }
        const scale = this.camera.getScale();
        stage.scale({x: scale, y: scale});
        stage.position(this.camera.position);
        stage.batchDraw();
    }

    addLiveEffect(id: string, effect: LiveEffect): void {
        this.removeLiveEffect(id);
        this.ensureEffectStage();
        if (!this.liveEffectLayer) return; // headless / no container
        effect.attach(this.liveEffectLayer);
        this.liveEffects.set(id, effect);
        this.syncEffectStage();
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this._coordinateTransform);
    }

    removeLiveEffect(id: string): void {
        const effect = this.liveEffects.get(id);
        if (!effect) return;
        effect.destroy();
        this.liveEffects.delete(id);
        this.liveEffectLayer?.batchDraw();
    }

    // --- Drawn-geometry snapshots (synchronous, from the last main-thread build) ---

    getDrawnExits(): readonly DrawnExitEntry[] {
        return this.lastResult?.drawnExits ?? [];
    }

    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] {
        return this.lastResult?.drawnSpecialExits ?? [];
    }

    getDrawnStubs(): readonly DrawnStubEntry[] {
        return this.lastResult?.drawnStubs ?? [];
    }

    // --- Export ---

    /**
     * Not supported with the worker backend — the live canvas is owned by the
     * worker and cannot be read synchronously here. Use the headless
     * `CanvasExporter` / `PngBytesExporter` (they rebuild from state), or the
     * async {@link captureViewport} for a live snapshot.
     */
    exportCanvas(): ExportCanvas | undefined {
        return undefined;
    }

    /** Async live-viewport snapshot via a worker round-trip. */
    captureViewport(options?: {pixelRatio?: number}): Promise<ImageBitmap> {
        if (!this.transport) return Promise.reject(new Error("No worker transport"));
        const requestId = ++this.exportSeq;
        return new Promise<ImageBitmap>((resolve) => {
            this.pendingExports.set(requestId, resolve);
            this.post({type: "export", requestId, pixelRatio: options?.pixelRatio ?? this.dpr});
        });
    }

    private handleWorkerMessage(message: WorkerToMainMessage): void {
        if (message.type === "export") {
            const resolve = this.pendingExports.get(message.requestId);
            if (resolve) {
                this.pendingExports.delete(message.requestId);
                resolve(message.bitmap);
            }
        }
        // 'ready' is informational; the worker buffers state until init.
    }

    // --- Teardown ---

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.state.events.removeAllListeners();
        this.interactionHandler?.destroy();

        for (const effect of this.liveEffects.values()) effect.destroy();
        this.liveEffects.clear();
        this.liveEffectStage?.destroy();
        this.liveEffectStage = undefined;
        this.liveEffectLayer = undefined;
        this.liveEffectHost?.remove();
        this.liveEffectHost = undefined;

        for (const overlay of this.sceneOverlays.values()) overlay.detach?.();
        this.sceneOverlays.clear();
        this.viewportSubscribers.clear();
        this.pendingExports.clear();

        this.camera.cancelAnimation();
        if (this.cameraChangeHandler) {
            this.camera.off("change", this.cameraChangeHandler);
            this.cameraChangeHandler = undefined;
        }

        this.post({type: "destroy"});
        this.transport?.terminate?.();

        this.events.removeAllListeners();
    }
}
