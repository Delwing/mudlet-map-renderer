import MapReader from "../reader/MapReader";
import type Area from "../reader/Area";
import type {ViewportBounds, RendererEventMap, CullingMode} from "../types/Settings";
import {createSettings} from "../types/Settings";
import type {Settings} from "../types/Settings";
import {MapState} from "../MapState";
import type {CoordFn, Style, DrawingBackend, GroupNode, LayerNode} from "../backend/DrawingBackend";
import {identityStyle, IDENTITY_TRANSFORM} from "../backend/DrawingBackend";
import {CanvasBackend} from "../backend/CanvasBackend";
import {Camera} from "../Camera";
import {CullingManager} from "../CullingManager";
import type {TypedEventEmitter} from "../TypedEventEmitter";
import type {SceneOverlay} from "../overlay/SceneOverlay";
import type {Exporter, ExportContext, ExportCanvas} from "../export/Exporter";
import type {DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry, SceneBuildResult} from "../ScenePipeline";
import {ScenePipeline} from "../ScenePipeline";
import {computePositionMarker, computeHighlight, computePathOverlay} from "../scene/OverlayStyle";
import {renderPositionMarker, renderHighlight, renderPathOverlay} from "../scene/OverlayRenderer";

/**
 * Expanded backend interface. Backends are passive shape-drawers; MapRenderer
 * drives scene building, culling, and overlay rendering.
 */
export interface RenderingBackend {
    readonly gridLayer: LayerNode;
    readonly linkLayer: LayerNode;
    readonly roomLayer: LayerNode;
    readonly topLabelLayer: LayerNode;
    readonly overlayLayer: LayerNode;
    readonly positionLayer: LayerNode;

    readonly drawingBackend: DrawingBackend;
    readonly coordinateTransform: CoordFn;
    readonly events: TypedEventEmitter<RendererEventMap>;

    /** The camera this backend uses. Undefined means it uses renderer.camera. */
    readonly camera?: Camera;

    onCameraChanged(scale: number, position: { x: number; y: number }, viewportBounds: ViewportBounds): void;
    onPositionChanged(roomId: number | undefined, center: boolean, areaChanged: boolean): void;
    animatePanTo(renderX: number, renderY: number): void;
    setStyle(style: Style): void;
    updateBackground(): void;
    onSceneOverlayAdded(id: string, overlay: SceneOverlay): void;
    onSceneOverlayRemoved(id: string): void;

    toCanvas(options: {
        width: number; height: number; roomId?: number; padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): ExportCanvas | undefined;
    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined;

    getDrawnExits(): readonly DrawnExitEntry[];
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[];
    getDrawnStubs(): readonly DrawnStubEntry[];

    destroy(): void;
}

// ---------------------------------------------------------------------------
// Internal helper: forwards addNode/destroyChildren/batchDraw to N layers.
// Used to build the scene into multiple backends in a single pipeline pass.
// ---------------------------------------------------------------------------
class BroadcastLayerNode implements LayerNode {
    constructor(private readonly layers: LayerNode[]) {}
    addNode(node: GroupNode) { for (const l of this.layers) l.addNode(node); }
    destroyChildren()        { for (const l of this.layers) l.destroyChildren(); }
    batchDraw()              { for (const l of this.layers) l.batchDraw(); }
}

/**
 * Pipeline-orchestrator renderer core. Owns map state, camera, culling, style,
 * and scene overlays. Drives scene building, culling, and overlay rendering.
 * Backends are passive shape-drawers injected via _attachBackend.
 *
 * ```ts
 * // SVG-only — no Konva loaded
 * const renderer = new MapRenderer(mapReader, settings);
 * const svg = renderer.export(new SvgExporter());
 *
 * // Interactive — inject Konva backend separately
 * const renderer = new MapRenderer(mapReader, settings);
 * const konva = new KonvaLayerManager(container, renderer);
 *
 * // Two backends, same camera — simultaneous output
 * const svg = new SvgRenderingBackend(renderer, renderer.camera);
 * const output = svg.toSvg();
 * svg.destroy();
 * ```
 */
export class MapRenderer {
    readonly state: MapState;
    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly pipeline: ScenePipeline;

    private currentStyle: Style = identityStyle;
    private backends = new Set<RenderingBackend>();
    private primaryBackend?: RenderingBackend;
    private readonly sceneOverlays: Map<string, SceneOverlay> = new Map();
    private destroyed = false;

    // Overlay state owned by MapRenderer
    private positionMarker?: GroupNode;
    private highlightShapes: Map<number, GroupNode> = new Map();
    private pathShapes: GroupNode[] = [];
    private lastBuildResult?: SceneBuildResult;

    // Shared event subscription handles (set up when first backend attaches)
    private unsubCamera?: () => void;
    private boundAreaHandler?: () => void;
    private boundCenterHandler?: (detail: { roomId: number; instant: boolean }) => void;
    private boundPositionHandler?: (detail: { roomId: number | undefined; center: boolean; areaChanged: boolean }) => void;
    private boundHighlightHandler?: (detail: { roomId: number; color: string | undefined }) => void;
    private boundPathHandler?: () => void;
    private boundClearHandler?: () => void;

    get settings(): Settings {
        return this.state.settings;
    }

    get coordinateTransform(): CoordFn {
        return this.primaryBackend?.coordinateTransform ?? IDENTITY_TRANSFORM;
    }

    get events(): TypedEventEmitter<RendererEventMap> | undefined {
        return this.primaryBackend?.events;
    }

    constructor(mapReader: MapReader, settings?: Settings) {
        const resolvedSettings = settings ?? createSettings();
        this.state = new MapState(mapReader, resolvedSettings);
        this.camera = new Camera(1, 1);
        this.culling = new CullingManager(this.camera, resolvedSettings);
        this.pipeline = new ScenePipeline(mapReader, resolvedSettings, new CanvasBackend());
    }

    /**
     * Attach a rendering backend. Called by the backend itself during construction.
     * @internal
     */
    _attachBackend(backend: RenderingBackend): void {
        const isFirst = this.backends.size === 0;
        this.backends.add(backend);

        if (isFirst) {
            this.primaryBackend = backend;
            this.pipeline.setBackend(backend.drawingBackend);
            this.culling.setCoordinateTransform(backend.coordinateTransform);
            this.culling.setCamera(backend.camera ?? this.camera);
            this._setupSharedListeners();
        }

        // Forward already-registered scene overlays
        for (const [id, overlay] of this.sceneOverlays) {
            backend.onSceneOverlayAdded(id, overlay);
        }

        // Build scene for the newly attached backend
        if (this.state.currentArea !== undefined) {
            this._buildSceneForBackend(backend);
        }
    }

    /** @internal */
    _detachBackend(backend: RenderingBackend): void {
        this.backends.delete(backend);

        if (backend === this.primaryBackend) {
            // Pick a new primary from remaining backends, or tear down
            this.primaryBackend = this.backends.values().next().value as RenderingBackend | undefined;
            if (this.primaryBackend) {
                this.pipeline.setBackend(this.primaryBackend.drawingBackend);
                this.culling.setCoordinateTransform(this.primaryBackend.coordinateTransform);
                this.culling.setCamera(this.primaryBackend.camera ?? this.camera);
            } else {
                this._teardownSharedListeners();
                this.pipeline.setBackend(new CanvasBackend());
                this.culling.setRedrawCallback(() => {});
            }
        }

        // Destroy any overlay shapes that belong to this backend
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }
        for (const shape of this.highlightShapes.values()) shape.destroy();
        this.highlightShapes.clear();
        for (const shape of this.pathShapes) shape.destroy();
        this.pathShapes = [];
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const b of this.backends) b.destroy();
        this.sceneOverlays.clear();
    }

    // --- Shared listener setup/teardown ---

    private _setupSharedListeners(): void {
        this.unsubCamera = this.camera.addChangeListener(() => {
            const scale = this.camera.getScale();
            const position = this.camera.position;
            const viewportBounds = this.camera.getViewportBounds();
            this.culling.updateCulling();

            for (const b of this.backends) {
                const bCam = b.camera ?? this.camera;
                if (bCam === this.camera) {
                    // Same camera: re-render grid with this backend's drawing backend
                    this.pipeline.setBackend(b.drawingBackend);
                    this.pipeline.gridRenderer.render(b.gridLayer, viewportBounds);
                }
                b.onCameraChanged(scale, position, viewportBounds);
            }
            // Restore primary backend in pipeline
            if (this.primaryBackend) this.pipeline.setBackend(this.primaryBackend.drawingBackend);
        });

        this.culling.setRedrawCallback((roomDirty, linkDirty) => {
            if (roomDirty || linkDirty) {
                for (const b of this.backends) b.linkLayer.batchDraw();
            }
        });

        this.boundAreaHandler = () => this._buildScene();
        this.state.events.on('area', this.boundAreaHandler);

        this.boundCenterHandler = ({roomId, instant}) => {
            const room = this.state.mapReader.getRoom(roomId);
            if (!room) return;
            const transform = this.primaryBackend?.coordinateTransform ?? IDENTITY_TRANSFORM;
            const p = transform(room.x, room.y);
            if (instant || this.state.settings.instantMapMove) {
                this.camera.panToMapPoint(p.x, p.y);
            } else {
                this.primaryBackend?.animatePanTo(p.x, p.y);
            }
        };
        this.state.events.on('center', this.boundCenterHandler);

        this.boundPositionHandler = ({roomId, center, areaChanged}) => {
            this._syncPosition(roomId, center, areaChanged);
        };
        this.state.events.on('position', this.boundPositionHandler);

        this.boundHighlightHandler = ({roomId, color}) => {
            this._syncHighlight(roomId, color);
        };
        this.state.events.on('highlight', this.boundHighlightHandler);

        this.boundPathHandler = () => this._syncPaths();
        this.state.events.on('path', this.boundPathHandler);

        this.boundClearHandler = () => this._syncHighlights();
        this.state.events.on('clear', this.boundClearHandler);
    }

    private _teardownSharedListeners(): void {
        this.unsubCamera?.();
        this.unsubCamera = undefined;

        if (this.boundAreaHandler) {
            this.state.events.off('area', this.boundAreaHandler);
            this.boundAreaHandler = undefined;
        }
        if (this.boundCenterHandler) {
            this.state.events.off('center', this.boundCenterHandler);
            this.boundCenterHandler = undefined;
        }
        if (this.boundPositionHandler) {
            this.state.events.off('position', this.boundPositionHandler);
            this.boundPositionHandler = undefined;
        }
        if (this.boundHighlightHandler) {
            this.state.events.off('highlight', this.boundHighlightHandler);
            this.boundHighlightHandler = undefined;
        }
        if (this.boundPathHandler) {
            this.state.events.off('path', this.boundPathHandler);
            this.boundPathHandler = undefined;
        }
        if (this.boundClearHandler) {
            this.state.events.off('clear', this.boundClearHandler);
            this.boundClearHandler = undefined;
        }
    }

    // --- Internal: scene lifecycle ---

    private _buildScene(): void {
        if (this.backends.size === 0) return;

        const {currentAreaInstance, currentZIndex} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) {
            this.culling.clear();
            return;
        }

        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.culling.clear();
            return;
        }

        // Partition backends by camera: those sharing renderer.camera can be built
        // in a single pipeline pass (BroadcastLayerNode shares the DrawCommand[]);
        // others need a separate pass with their own camera/backend.
        const sharedBackends: RenderingBackend[] = [];
        const separateBackends: RenderingBackend[] = [];
        for (const b of this.backends) {
            if (!b.camera || b.camera === this.camera) sharedBackends.push(b);
            else separateBackends.push(b);
        }

        // --- Shared-camera group (one build, shared DrawCommand[]) ---
        let primaryResult: SceneBuildResult | undefined;
        if (sharedBackends.length > 0) {
            this.pipeline.setBackend(this.primaryBackend!.drawingBackend);
            const layers = {
                gridLayer:     new BroadcastLayerNode(sharedBackends.map(b => b.gridLayer)),
                linkLayer:     new BroadcastLayerNode(sharedBackends.map(b => b.linkLayer)),
                roomLayer:     new BroadcastLayerNode(sharedBackends.map(b => b.roomLayer)),
                topLabelLayer: new BroadcastLayerNode(sharedBackends.map(b => b.topLabelLayer)),
            };
            primaryResult = this.pipeline.buildScene(currentAreaInstance, plane, currentZIndex, layers);
            this.lastBuildResult = primaryResult;
        }

        // --- Different-camera group (separate build per backend) ---
        for (const b of separateBackends) {
            this.pipeline.setBackend(b.drawingBackend);
            const result = this.pipeline.buildScene(
                currentAreaInstance, plane, currentZIndex,
                { gridLayer: b.gridLayer, linkLayer: b.linkLayer, roomLayer: b.roomLayer, topLabelLayer: b.topLabelLayer },
            );
            // Notify the backend of its build result if it supports it
            if ('_setLastBuildResult' in b && typeof (b as any)._setLastBuildResult === 'function') {
                (b as any)._setLastBuildResult(result);
            }
        }

        // Restore primary backend in pipeline
        if (this.primaryBackend) this.pipeline.setBackend(this.primaryBackend.drawingBackend);

        // Update culling from primary result
        if (primaryResult) {
            this.culling.clear();
            this.culling.computeBucketSize();
            for (const [, entry] of primaryResult.roomNodes) {
                this.culling.roomNodes.set(entry.room.id, entry);
                this.culling.addRoomToSpatialIndex(entry);
            }
            for (const entry of primaryResult.standaloneExitNodes) {
                this.culling.standaloneExitNodes.push(entry);
                this.culling.addStandaloneExitToSpatialIndex(entry);
            }
            this.culling.setExitBoundsRoomSize();
            this.culling.updateCulling();
        }

        const scale = this.camera.getScale();
        const position = this.camera.position;
        const vpBounds = this.camera.getViewportBounds();

        // Render grid + notify for all backends
        for (const b of this.backends) {
            const bCam = b.camera ?? this.camera;
            const bVp = bCam.getViewportBounds();
            this.pipeline.setBackend(b.drawingBackend);
            this.pipeline.gridRenderer.render(b.gridLayer, bVp);
            b.onCameraChanged(scale, position, bCam === this.camera ? vpBounds : bVp);
        }
        if (this.primaryBackend) this.pipeline.setBackend(this.primaryBackend.drawingBackend);

        // Re-sync overlays
        this._syncHighlights();
        this._syncPaths();

        if (this.state.positionRoomId !== undefined) {
            this._syncPosition(this.state.positionRoomId, false, false);
        }

        // Re-forward scene overlays to all backends
        for (const b of this.backends) {
            for (const [id, overlay] of this.sceneOverlays) {
                b.onSceneOverlayAdded(id, overlay);
            }
        }
    }

    /** Build the scene for a single backend (used on initial attach). */
    private _buildSceneForBackend(backend: RenderingBackend): void {
        const {currentAreaInstance, currentZIndex} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) return;

        this.pipeline.setBackend(backend.drawingBackend);
        const result = this.pipeline.buildScene(
            currentAreaInstance, plane, currentZIndex,
            {
                gridLayer: backend.gridLayer,
                linkLayer: backend.linkLayer,
                roomLayer: backend.roomLayer,
                topLabelLayer: backend.topLabelLayer,
            },
        );

        if ('_setLastBuildResult' in backend && typeof (backend as any)._setLastBuildResult === 'function') {
            (backend as any)._setLastBuildResult(result);
        }

        // Only update culling for the primary backend
        if (backend === this.primaryBackend) {
            this.lastBuildResult = result;
            this.culling.clear();
            this.culling.computeBucketSize();
            for (const [, entry] of result.roomNodes) {
                this.culling.roomNodes.set(entry.room.id, entry);
                this.culling.addRoomToSpatialIndex(entry);
            }
            for (const entry of result.standaloneExitNodes) {
                this.culling.standaloneExitNodes.push(entry);
                this.culling.addStandaloneExitToSpatialIndex(entry);
            }
            this.culling.setExitBoundsRoomSize();
            this.culling.updateCulling();
        }

        const bCam = backend.camera ?? this.camera;
        const bVp = bCam.getViewportBounds();
        this.pipeline.gridRenderer.render(backend.gridLayer, bVp);
        backend.onCameraChanged(bCam.getScale(), bCam.position, bVp);

        // Restore primary backend
        if (this.primaryBackend && backend !== this.primaryBackend) {
            this.pipeline.setBackend(this.primaryBackend.drawingBackend);
        }

        // Sync overlays for this backend
        this._syncHighlightsForBackend(backend);
        this._syncPathsForBackend(backend);
        if (this.state.positionRoomId !== undefined) {
            this._syncPositionForBackend(this.state.positionRoomId, backend);
        }
    }

    private _syncPosition(roomId: number | undefined, center: boolean, areaChanged: boolean): void {
        for (const backend of this.backends) {
            backend.onPositionChanged(roomId, center, areaChanged);
        }

        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }

        if (roomId !== undefined) {
            const room = this.state.mapReader.getRoom(roomId);
            if (room && this.primaryBackend) {
                const data = computePositionMarker(room, this.state.settings);
                this.positionMarker = renderPositionMarker(this.primaryBackend.drawingBackend, data);
                this.primaryBackend.positionLayer.addNode(this.positionMarker);
                this.primaryBackend.positionLayer.batchDraw();
            }
        }
    }

    private _syncPositionForBackend(roomId: number, backend: RenderingBackend): void {
        if (backend !== this.primaryBackend) return;
        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;
        const data = computePositionMarker(room, this.state.settings);
        if (this.positionMarker) { this.positionMarker.destroy(); }
        this.positionMarker = renderPositionMarker(backend.drawingBackend, data);
        backend.positionLayer.addNode(this.positionMarker);
        backend.positionLayer.batchDraw();
    }

    private _syncHighlight(roomId: number, color: string | undefined): void {
        const backend = this.primaryBackend;
        if (!backend) return;

        const existing = this.highlightShapes.get(roomId);
        if (existing) { existing.destroy(); this.highlightShapes.delete(roomId); }

        if (color !== undefined) {
            const room = this.state.mapReader.getRoom(roomId);
            if (room && room.area === this.state.currentArea && room.z === this.state.currentZIndex) {
                const data = computeHighlight(room, color, this.state.settings);
                const shape = renderHighlight(backend.drawingBackend, data);
                backend.overlayLayer.addNode(shape);
                this.highlightShapes.set(roomId, shape);
            }
        }
        backend.overlayLayer.batchDraw();
    }

    private _syncHighlights(): void {
        const backend = this.primaryBackend;
        if (!backend) return;

        for (const shape of this.highlightShapes.values()) shape.destroy();
        this.highlightShapes.clear();

        for (const [roomId, entry] of this.state.highlights) {
            if (entry.area !== this.state.currentArea || entry.z !== this.state.currentZIndex) continue;
            const room = this.state.mapReader.getRoom(roomId);
            if (!room) continue;
            const data = computeHighlight(room, entry.color, this.state.settings);
            const shape = renderHighlight(backend.drawingBackend, data);
            backend.overlayLayer.addNode(shape);
            this.highlightShapes.set(roomId, shape);
        }
        backend.overlayLayer.batchDraw();
    }

    private _syncHighlightsForBackend(backend: RenderingBackend): void {
        if (backend !== this.primaryBackend) return;
        this._syncHighlights();
    }

    private _syncPaths(): void {
        const backend = this.primaryBackend;
        if (!backend) return;

        for (const shape of this.pathShapes) shape.destroy();
        this.pathShapes = [];

        const {currentArea, currentZIndex} = this.state;
        if (currentArea === undefined || currentZIndex === undefined) {
            backend.overlayLayer.batchDraw();
            return;
        }

        for (const path of this.state.paths) {
            const data = computePathOverlay(
                this.state.mapReader, this.state.settings,
                path.locations, path.color, currentArea, currentZIndex,
            );
            const group = renderPathOverlay(backend.drawingBackend, data);
            backend.overlayLayer.addNode(group);
            this.pathShapes.push(group);
        }
        backend.overlayLayer.batchDraw();
    }

    private _syncPathsForBackend(backend: RenderingBackend): void {
        if (backend !== this.primaryBackend) return;
        this._syncPaths();
    }

    // --- State mutations ---

    drawArea(id: number, zIndex: number) { this.state.setArea(id, zIndex); }
    getCurrentArea(): Area | undefined { return this.state.currentAreaInstance; }
    setPosition(roomId: number, center = true) { this.state.setPosition(roomId, center); }
    updatePositionMarker(roomId: number) { this.state.updatePositionMarker(roomId); }
    clearPosition() { this.state.clearPosition(); }
    centerOn(roomId: number, instant?: boolean) { this.state.setCenterRoom(roomId, instant); }
    renderHighlight(roomId: number, color: string) { this.state.addHighlight(roomId, color); }
    removeHighlight(roomId: number) { this.state.removeHighlight(roomId); }
    hasHighlight(roomId: number): boolean { return this.state.hasHighlight(roomId); }
    clearHighlights() { this.state.clearHighlights(); }
    renderPath(locations: number[], color?: string) { this.state.addPath(locations, color); }
    clearPaths() { this.state.clearPaths(); }
    refreshCurrentRoomOverlay() { this.state.refreshPosition(); }

    // --- Style ---

    setStyle(style: Style) {
        this.currentStyle = style;
        this.primaryBackend?.setStyle(style);
        if (this.primaryBackend) {
            this.pipeline.setBackend(this.primaryBackend.drawingBackend);
            this.culling.setCoordinateTransform(this.primaryBackend.coordinateTransform);
            this._buildScene();
        }
    }

    clearStyle() { this.setStyle(identityStyle); }
    getStyle(): Style { return this.currentStyle; }

    updateBackground() {
        for (const b of this.backends) b.updateBackground();
    }

    refresh() { this._buildScene(); }

    // --- Scene overlays ---

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) {
            for (const b of this.backends) b.onSceneOverlayRemoved(id);
        }
        this.sceneOverlays.set(id, overlay);
        for (const b of this.backends) b.onSceneOverlayAdded(id, overlay);
    }

    removeSceneOverlay(id: string) {
        if (!this.sceneOverlays.has(id)) return;
        this.sceneOverlays.delete(id);
        for (const b of this.backends) b.onSceneOverlayRemoved(id);
    }

    getSceneOverlays(): Iterable<SceneOverlay> {
        return this.sceneOverlays.values();
    }

    // --- Hit-testing ---

    findRoomAtMap(mapX: number, mapY: number): MapData.Room | null {
        return this.culling.findRoomAtMapPoint(mapX, mapY);
    }

    findRoomAtScreen(screenX: number, screenY: number, containerOffset?: { left: number; top: number }): MapData.Room | null {
        const p = this.camera.clientToMapPoint(screenX, screenY, containerOffset);
        if (!p) return null;
        return this.culling.findRoomAtMapPoint(p.x, p.y);
    }

    // --- Drawn geometry (from last build result) ---

    getDrawnExits(): readonly DrawnExitEntry[] { return this.lastBuildResult?.drawnExits ?? []; }
    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] { return this.lastBuildResult?.drawnSpecialExits ?? []; }
    getDrawnStubs(): readonly DrawnStubEntry[] { return this.lastBuildResult?.drawnStubs ?? []; }

    // --- Export ---

    export<T>(exporter: Exporter<T>): T {
        const context: ExportContext = {
            state: this.state,
            renderer: this,
            pipeline: this.pipeline,
            style: this.currentStyle,
            sceneOverlays: this.sceneOverlays.values(),
        };
        return exporter.render(context);
    }

    toCanvas(options: {
        width: number; height: number; roomId?: number; padding?: number;
        overlays?: {
            position?: { roomId: number };
            highlights?: Array<{ roomId: number; color: string }>;
            paths?: Array<{ locations: number[]; color: string }>;
        };
    }): ExportCanvas | undefined {
        return this.primaryBackend?.toCanvas(options);
    }

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
        return this.primaryBackend?.exportCanvas(options);
    }

    // --- Viewport & events ---

    on<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.primaryBackend?.events.on(event, handler);
    }

    off<K extends keyof RendererEventMap>(event: K, handler: (detail: RendererEventMap[K]) => void): void {
        this.primaryBackend?.events.off(event, handler);
    }

    setZoom(zoom: number): boolean { return this.camera.setZoom(zoom); }
    zoomToCenter(zoom: number): boolean { return this.camera.zoomToCenter(zoom); }
    getZoom(): number { return this.camera.zoom; }
    getViewportBounds(): ViewportBounds { return this.camera.getViewportBounds(); }

    getAreaBounds(): ViewportBounds | null {
        if (!this.state.currentAreaInstance || this.state.currentZIndex === undefined) return null;
        const plane = this.state.currentAreaInstance.getPlane(this.state.currentZIndex);
        if (!plane) return null;
        const b = this.state.getEffectiveBounds(this.state.currentAreaInstance, plane);
        const hasAreaName = this.state.settings.areaName && this.state.currentAreaInstance.getAreaName();
        const raw: ViewportBounds = {
            minX: hasAreaName ? b.minX - 4 : b.minX, maxX: b.maxX,
            minY: hasAreaName ? b.minY - 7 : b.minY, maxY: b.maxY,
        };
        const fn = this.coordinateTransform;
        const c1 = fn(raw.minX, raw.minY);
        const c2 = fn(raw.maxX, raw.minY);
        const c3 = fn(raw.maxX, raw.maxY);
        const c4 = fn(raw.minX, raw.maxY);
        return {
            minX: Math.min(c1.x, c2.x, c3.x, c4.x), maxX: Math.max(c1.x, c2.x, c3.x, c4.x),
            minY: Math.min(c1.y, c2.y, c3.y, c4.y), maxY: Math.max(c1.y, c2.y, c3.y, c4.y),
        };
    }

    fitArea(insets?: { top?: number; right?: number; bottom?: number; left?: number }) {
        const bounds = this.getAreaBounds();
        if (!bounds) return;
        this.camera.fitToMapBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, insets);
    }

    get centerOnResize(): boolean { return this.camera.centerOnResize; }
    set centerOnResize(value: boolean) { this.camera.centerOnResize = value; }
    get minZoom(): number { return this.camera.minZoom; }
    set minZoom(value: number) { this.camera.minZoom = value; }

    setCullingMode(mode: CullingMode) {
        this.state.settings.cullingMode = mode;
        this.state.settings.cullingEnabled = mode !== "none";
        this.culling.scheduleCulling();
    }

    getCullingMode(): CullingMode { return this.state.settings.cullingMode; }
}
