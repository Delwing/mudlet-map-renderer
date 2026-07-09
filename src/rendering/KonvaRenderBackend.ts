import Konva from "konva";
import type {IArea} from "../reader/Area";
import type {IPlane} from "../reader/Plane";
import type {RendererEventMap, ViewportBounds} from "../types/Settings";
import type {DrawnExitEntry, DrawnSpecialExitEntry, DrawnStubEntry} from "../ScenePipeline";
import type {MapState} from "../MapState";
import {Camera} from "../camera/Camera";
import {CullingManager} from "../CullingManager";
import {SceneManager} from "./SceneManager";
import {InteractionHandler} from "../InteractionHandler";
import {TypedEventEmitter} from "../TypedEventEmitter";
import {
    DrawCommandLayerNode,
    MaterializingLayerNode,
    RecordingGroupNode,
    RecordingLayerNode,
    type DrawEntry,
} from "../render/RecordingLayer";
import {shapeToRecording} from "../render/shapeToRecording";
import type {InteractiveBackend} from "./MapRenderer";
import type {CoordFn} from "../coord/CoordFn";
import {IDENTITY_TRANSFORM} from "../coord/CoordFn";
import {computeHighlight, computePositionMarker, computePathOverlay} from "../scene/OverlayStyle";
import {computeStubs} from "../scene/StubStyle";
import {computeSpecialExits} from "../scene/SpecialExitStyle";
import {layoutRoom} from "../scene/elements/RoomLayout";
import {computeNeighborSpill, spillPositionMap, ProjectedMapReader} from "../scene/NeighborProjector";
import type {NeighborSpill} from "../scene/NeighborProjector";
import type {IMapReader} from "../reader/MapReader";
import {isViewportDataSource} from "../reader/ViewportDataSource";
import {projectBounds} from "../render/CullIndex";
import {LodController, type RasterVisit} from "./lod/LodController";
import {computeLodMode, type LodMode} from "./lod/lodDecision";
import {withoutLinkExits} from "./lod/roomsOnlyArea";
import {hiddenAwareLens} from "../lens/hiddenAwareLens";
import {defaultExitTreatment} from "../lens/RoomLens";
import {hiddenRoomLayoutOptions} from "../scene/RoomFlags";
import {layoutInnerExits} from "../scene/elements/ExitLayout";
import {layoutGrid} from "../scene/elements/GridLayout";
import {specialExitToShape} from "../scene/elements/SpecialExitLayout";
import {stubToShape} from "../scene/elements/StubLayout";
import {
    highlightToShape, positionMarkerToShape, pathToShapes,
} from "../scene/elements/OverlayLayout";
import type {LiveEffect} from "../overlay/LiveEffect";
import type {SceneOverlay, SceneOverlayContext} from "../overlay/SceneOverlay";
import type {ExportCanvas} from "../export/Exporter";
import {HitTester} from "../hit/HitTester";
import type {LayerOffset} from "../hit/HitTester";
import type {GroupShape, Shape} from "../scene/Shape";
import type {Style, StyleContext} from "../style/Style";
import {identityStyle} from "../style/Style";
import {applyStyleToShapes} from "../style/applyStyle";

const currentRoomColor = 'rgb(120, 72, 0)';

/**
 * Fraction of the viewport added per side before pushing bounds to a
 * viewport-aware reader (see {@link KonvaRenderBackend.padViewport}). Shared
 * with the LOD decision so the "should this plane be vector at this zoom"
 * check accounts for the extra rooms the padding itself pulls in — without
 * this, the actual padded room count can exceed `lodRoomBudget` right at the
 * flip, since the raw decision only sizes the unpadded camera viewport.
 *
 * Deliberately generous (50% per side, not just enough to cover edge-room
 * popping): rebuild-on-pan only fires once the camera leaves this padded
 * region, and panning inside it is free (the existing viewport culling
 * already handles it) — so a bigger pad directly buys more pan distance
 * between rebuilds. This does NOT make an individual rebuild bigger at the
 * LOD flip: {@link VIEWPORT_PAD_AREA_FACTOR} shrinks the effective budget fed
 * into the flip decision by the same factor, so the flip point retreats to
 * compensate and the padded room count at the flip stays pinned near
 * `lodRoomBudget` regardless of how generous the padding is.
 */
const VIEWPORT_PAD_FRACTION = 0.5;
/** Worst-case area inflation from padding every side by {@link VIEWPORT_PAD_FRACTION}. */
const VIEWPORT_PAD_AREA_FACTOR = (1 + 2 * VIEWPORT_PAD_FRACTION) ** 2;

/**
 * Konva rendering engine. Owns the full rendering pipeline:
 * stage, layers, scene builder, culling, overlays.
 *
 * Camera is the source of truth for transform state.
 * This backend subscribes to the camera's `change` event and applies state to the Konva stage.
 *
 * Works identically in both modes:
 * - DOM container → stage attached to DOM, mouse/touch → camera
 * - No container → headless stage, same camera/culling, no input
 */
export class KonvaRenderBackend implements InteractiveBackend {
    readonly stage: Konva.Stage;
    /** Bottom-most layer: raster LOD overview underlay (see Settings.lodEnabled). */
    readonly lodLayer: Konva.Layer;
    readonly gridLayer: Konva.Layer;
    readonly linkLayer: Konva.Layer;
    readonly roomLayer: Konva.Layer;
    readonly topLabelLayer: Konva.Layer;
    readonly overlayLayer: Konva.Layer;
    readonly positionLayer: Konva.Layer;

    readonly camera: Camera;
    readonly culling: CullingManager;
    readonly events: TypedEventEmitter<RendererEventMap>;

    private readonly state: MapState;
    private readonly container?: HTMLDivElement;
    private readonly positionLayerNode: MaterializingLayerNode;
    private readonly overlayLayerNode: MaterializingLayerNode;
    private gridLayerNode!: RecordingLayerNode;
    private topLabelLayerNode!: RecordingLayerNode;
    /** Snapped grid bounds last rendered onto gridLayerNode. */
    private gridCachedBounds: {left: number; right: number; top: number; bottom: number} | null = null;
    private sceneManager: SceneManager;
    private currentStyle: Style = identityStyle;

    readonly hitTester: HitTester = new HitTester();
    private lastHitShapes: Shape[] = [];

    // Shape → DrawEntry map rebuilt on each buildScene; used by applyClipping
    // to toggle DrawEntry.visible without knowing about CullEntry or Konva internals.
    private shapeToDrawEntry: Map<Shape, DrawEntry> = new Map();
    /**
     * Managed shapes visible after the last cull pass. applyClipping diffs the
     * fresh visible set against this and flips only the entries that changed,
     * so a pan touches O(shapes entering/leaving the viewport), not O(all).
     * Seeded with every managed shape on rebuild (all entries start visible) so
     * the first pass hides the off-screen ones.
     */
    private lastVisibleShapes: Set<Shape> = new Set();
    private sceneNode!: DrawCommandLayerNode;
    /** Lookup from a pipeline-emitted shape to its recording node; rebuilt per buildScene. */
    private shapeToGroup: Map<Shape, RecordingGroupNode> = new Map();

    private positionMarker?: RecordingGroupNode;
    private highlightShapes: Map<number, RecordingGroupNode> = new Map();
    private pathShapes: RecordingGroupNode[] = [];
    /**
     * Projected positions of the current build's spilled neighbouring-area
     * rooms (roomId → current-area-frame x/y). Empty when neighbour spill is
     * off or yields nothing. Drives {@link overlayReader} so highlights/paths
     * on spilled rooms land at their projected spots.
     */
    private spilledRoomPositions: Map<number, {x: number; y: number}> = new Map();
    private currentRoomOverlay: RecordingGroupNode[] = [];
    private interactionHandler?: InteractionHandler;
    private origSetSize?: (w: number, h: number) => void;
    private cameraChangeHandler?: () => void;
    private destroyed = false;
    private _coordinateTransform: CoordFn = IDENTITY_TRANSFORM;
    private coordinateInverse: CoordFn = IDENTITY_TRANSFORM;
    private coordinateLayerOffset: LayerOffset | undefined;

    get coordinateTransform(): CoordFn {
        return this._coordinateTransform;
    }
    private liveEffects: Map<string, LiveEffect> = new Map();
    private sceneOverlays: Map<string, SceneOverlay> = new Map();
    private sceneOverlayNodes: Map<string, RecordingGroupNode[]> = new Map();
    private viewportSubscribers: Set<() => void> = new Set();

    // --- LOD + viewport-aware reader state ---
    private readonly lodController: LodController;
    /** Current LOD tier for the displayed plane — see {@link computeLodMode}. */
    private lodMode: LodMode = "vector";
    /** Padded bounds last pushed into a ViewportDataSource reader (rebuild-on-pan hysteresis). */
    private lastAppliedViewport: ViewportBounds | null = null;
    /** Camera scale at the last applied viewport — see {@link onCameraViewportChanged}. */
    private lastAppliedScale: number | null = null;
    private refreshScheduled = false;

    constructor(state: MapState, container?: HTMLDivElement) {
        this.state = state;
        this.container = container;

        if (container) {
            this.stage = new Konva.Stage({
                container,
                width: container.clientWidth,
                height: container.clientHeight,
                draggable: false,
            });
            container.style.backgroundColor = state.settings.backgroundColor;
            this.camera = new Camera(container.clientWidth, container.clientHeight);
        } else {
            this.stage = new Konva.Stage({width: 1, height: 1});
            this.camera = new Camera(1, 1);
        }

        // LOD raster underlay sits below everything else; pixels it does not
        // paint stay transparent so the container background shows through.
        this.lodLayer = new Konva.Layer({listening: false});
        this.stage.add(this.lodLayer);
        this.gridLayer = new Konva.Layer({listening: false});
        this.stage.add(this.gridLayer);
        // linkLayer and roomLayer share one physical Konva.Layer to stay under
        // Konva's recommended layer count. Z-order between link exits and rooms
        // is preserved by insertion order within the shared RecordingLayerNode.
        const sceneLayer = new Konva.Layer({listening: false});
        this.linkLayer = sceneLayer;
        this.roomLayer = sceneLayer;
        this.stage.add(sceneLayer);
        this.positionLayer = new Konva.Layer({listening: false});
        this.stage.add(this.positionLayer);
        this.overlayLayer = new Konva.Layer({listening: false});
        this.stage.add(this.overlayLayer);
        this.topLabelLayer = new Konva.Layer({listening: false});
        this.stage.add(this.topLabelLayer);

        this.positionLayerNode = new MaterializingLayerNode(this.positionLayer);
        this.overlayLayerNode = new MaterializingLayerNode(this.overlayLayer);

        this.sceneNode = new DrawCommandLayerNode(sceneLayer, () => state.settings.coalesceRooms);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.sceneManager = new SceneManager(this.camera, state.settings, state.mapReader);
        this.lodController = new LodController(
            this.lodLayer, this.camera,
            envId => this.state.mapReader.getColorValue(envId),
            () => this.state.settings.roomSize,
        );

        this.events = new TypedEventEmitter<RendererEventMap>(container);

        // linkLayer and roomLayer share sceneNode; one batchDraw covers both.
        this.culling = new CullingManager(state.settings, () => this.applyClipping());

        // Camera drives the stage
        this.cameraChangeHandler = () => this.applyViewportToStage();
        this.camera.on('change', this.cameraChangeHandler);

        if (container) {
            // Sync stage size when camera resizes
            this.origSetSize = this.camera.setSize.bind(this.camera);
            const origSetSize = this.origSetSize;
            this.camera.setSize = (w: number, h: number) => {
                origSetSize(w, h);
                this.stage.width(w);
                this.stage.height(h);
            };

            this.interactionHandler = new InteractionHandler(container, this.camera, state, {
                clientToMapPoint: (cx, cy) => this.camera.clientToMapPoint(cx, cy, container.getBoundingClientRect()),
                pickAtPoint: (x, y) => this.hitTester.pick(x, y),
            }, this.events);
        }

        this.applyStyleTransforms();
        this.subscribeToState(state);
    }

    setStyle(style: Style) {
        this.currentStyle = style;
        this.sceneNode = new DrawCommandLayerNode(this.linkLayer, () => this.state.settings.coalesceRooms);
        this.gridLayerNode = new RecordingLayerNode(this.gridLayer);
        this.topLabelLayerNode = new RecordingLayerNode(this.topLabelLayer);
        this.gridCachedBounds = null;
        this.sceneManager.resetPipeline(this.state.mapReader);

        // Drop scene state pinned to the now-destroyed sceneNode/layers.
        this.shapeToDrawEntry = new Map();
        this.shapeToGroup.clear();
        this.lastHitShapes = [];
        this.hitTester.clear();

        this.applyStyleTransforms();
        this.refresh();
    }

    /** Pull forward/inverse coord transforms from the active shape Style. */
    private applyStyleTransforms() {
        // Capture the style pointer locally: the arrows below outlive setStyle
        // calls (held by TerrainOverlay via updateViewport, by `oldInverse`
        // below, etc.), so they must not dereference `this.currentStyle` at
        // invocation time — that would resolve against whatever style was
        // installed *later*, which may not implement worldToScene/sceneToWorld.
        const style = this.currentStyle;
        const forward: CoordFn = style.worldToScene
            ? (x, y) => style.worldToScene!(x, y)
            : IDENTITY_TRANSFORM;
        const newInverse: CoordFn = style.sceneToWorld
            ? (x, y) => style.sceneToWorld!(x, y)
            : IDENTITY_TRANSFORM;
        const oldInverse = this.coordinateInverse;
        const layerOffset: LayerOffset | undefined = style.sceneLayerOffset
            ? (layer) => style.sceneLayerOffset!(layer)
            : undefined;

        this._coordinateTransform = forward;
        this.coordinateInverse = newInverse;
        this.coordinateLayerOffset = layerOffset;
        this.culling.setCoordinateTransform(forward);
        this.gridCachedBounds = null;
        if (this.lastHitShapes.length > 0) {
            if (this.hitTestBudgetExceeded()) {
                this.hitTester.clear();
            } else {
                this.hitTester.build(this.lastHitShapes, this.state.settings.roomSize, forward, layerOffset);
            }
        }

        // Reposition camera so the same map point stays at screen center
        const scale = this.camera.getScale();
        const screenCX = this.camera.width / 2;
        const screenCY = this.camera.height / 2;
        const oldRX = (screenCX - this.camera.position.x) / scale;
        const oldRY = (screenCY - this.camera.position.y) / scale;
        const map = oldInverse(oldRX, oldRY);
        const nr = forward(map.x, map.y);

        this.camera.position = {
            x: screenCX - nr.x * scale,
            y: screenCY - nr.y * scale,
        };
        this.applyViewportToStage();
    }

    private styleContext(): StyleContext {
        return {
            scale: this.camera.getScale(),
            roomSize: this.state.settings.roomSize,
        };
    }

    private mapPoint(x: number, y: number): { x: number; y: number } {
        return this._coordinateTransform(x, y);
    }

    get exitRenderer() {
        return this.sceneManager.exitRenderer;
    }

    getDrawnExits(): readonly DrawnExitEntry[] {
        return this.sceneManager.drawnExits;
    }

    getDrawnSpecialExits(): readonly DrawnSpecialExitEntry[] {
        return this.sceneManager.drawnSpecialExits;
    }

    getDrawnStubs(): readonly DrawnStubEntry[] {
        return this.sceneManager.drawnStubs;
    }


    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        // Remove all MapState event subscriptions
        this.state.events.removeAllListeners();

        // Destroy interaction handler (removes DOM listeners)
        this.interactionHandler?.destroy();

        // Stop overlay plugins
        for (const plugin of this.liveEffects.values()) plugin.destroy();
        this.liveEffects.clear();

        // Detach scene overlays so they can unsubscribe from events
        for (const overlay of this.sceneOverlays.values()) overlay.detach?.();
        this.sceneOverlays.clear();
        for (const nodes of this.sceneOverlayNodes.values()) {
            for (const node of nodes) node.destroy();
        }
        this.sceneOverlayNodes.clear();
        this.viewportSubscribers.clear();

        // Cancel any running camera animation
        this.camera.cancelAnimation();

        this.lodController.destroy();

        // Restore monkey-patched setSize
        if (this.origSetSize) {
            this.camera.setSize = this.origSetSize;
        }

        // Disconnect camera from stage
        if (this.cameraChangeHandler) {
            this.camera.off('change', this.cameraChangeHandler);
            this.cameraChangeHandler = undefined;
        }

        // Destroy all Konva nodes and the stage
        this.clearOverlayShapes();
        this.clearCurrentRoomOverlay();
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }
        this.stage.destroy();

        // Clear renderer events
        this.events.removeAllListeners();
    }

    updateBackground() {
        if (this.container) {
            this.container.style.backgroundColor = this.state.settings.backgroundColor;
        }
    }

    exportCanvas(options?: { pixelRatio?: number }): ExportCanvas | undefined {
        if (this.state.currentArea === undefined || this.state.currentZIndex === undefined) return;
        const stageCanvas = this.stage.toCanvas({ pixelRatio: options?.pixelRatio ?? 1 });
        const composite = document.createElement('canvas');
        composite.width = stageCanvas.width;
        composite.height = stageCanvas.height;
        const ctx = composite.getContext('2d')!;
        ctx.fillStyle = this.state.settings.backgroundColor;
        ctx.fillRect(0, 0, composite.width, composite.height);
        ctx.drawImage(stageCanvas, 0, 0);
        return composite;
    }

    // --- Camera → Stage (one-way, called from the camera's change event) ---

    private applyViewportToStage() {
        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});
        this.stage.position(this.camera.position);
        this.stage.batchDraw();
        const vpBounds = this.camera.getViewportBounds();
        this.refreshGrid(vpBounds);
        this.culling.scheduleCulling();
        this.onCameraViewportChanged(vpBounds);
        this.events.emit('pan', vpBounds);
        for (const cb of this.viewportSubscribers) cb();
        for (const plugin of this.liveEffects.values()) {
            plugin.updateViewport(vpBounds, scale, this.coordinateTransform);
        }
    }

    /**
     * Camera-move follow-up for LOD and viewport-aware readers. A scene
     * rebuild (RAF-coalesced) is scheduled when:
     *  - the LOD mode decision flipped (zoom crossed the raster threshold), or
     *  - a {@link ViewportDataSource} reader's camera left the padded viewport
     *    applied on the last build (rebuild-on-pan with hysteresis — panning
     *    inside the padding is covered by the existing culling), or
     *  - the zoom has drifted materially (±20%) from the scale the padded
     *    viewport was computed at. The generous (50%-per-side) padding means a
     *    pure zoom-IN can leave the camera viewport spatially inside the old
     *    padded region indefinitely — without this check the reader would
     *    keep reporting the stale, much-too-wide room count (visibleEstimate,
     *    the vector/hit-test budget decisions) forever while zooming in,
     *    instead of narrowing to reflect what's actually worth materialising
     *    at the new zoom.
     * In raster mode the underlay repaints itself independently (also
     * coalesced, and only when the painted region no longer covers the view).
     */
    private onCameraViewportChanged(vpBounds: ViewportBounds): void {
        const {currentAreaInstance, currentZIndex} = this.state;
        if (currentAreaInstance && currentZIndex !== undefined && this.hasRealViewport()) {
            let needRefresh =
                this.state.settings.lodEnabled && this.computeLodMode() !== this.lodMode;
            if (!needRefresh && isViewportDataSource(this.state.mapReader)) {
                const a = this.lastAppliedViewport;
                const s = this.lastAppliedScale;
                const scale = this.camera.getScale();
                needRefresh = !a || s === null ||
                    vpBounds.minX < a.minX || vpBounds.maxX > a.maxX ||
                    vpBounds.minY < a.minY || vpBounds.maxY > a.maxY ||
                    scale > s * 1.2 || scale < s / 1.2;
            }
            if (needRefresh) this.scheduleRefresh();
        }
        this.lodController.onViewportChange();
    }

    private scheduleRefresh(): void {
        if (this.refreshScheduled) return;
        this.refreshScheduled = true;
        const run = () => {
            this.refreshScheduled = false;
            if (!this.destroyed) this.refresh();
        };
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(run);
        else queueMicrotask(run);
    }

    // --- State event handlers ---

    refresh() {
        const {currentAreaInstance, currentZIndex, positionRoomId} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) {
            this.shapeToDrawEntry = new Map();
            this.sceneManager.reset();
            this.hitTester.clear();
            this.lastHitShapes = [];
            this.gridLayer.destroyChildren();
            this.linkLayer.destroyChildren();
            this.positionLayer.destroyChildren();
            this.positionMarker = undefined;
            this.clearOverlayShapes();
            this.currentRoomOverlay = [];
            this.lodController.clear();
            this.lodMode = "vector";
            this.stage.batchDraw();
            return;
        }
        this.updateBackground();

        // Viewport-aware readers get the padded camera bounds pushed BEFORE the
        // build, so a plane never materialises more than the padded viewport.
        // `padded` is in SCENE space (camera.getViewportBounds()); readers like
        // SkeletonMapReader store raw WORLD-space room columns, so under a
        // warped style (e.g. Isometric) the bounds must go through the
        // inverse transform first — otherwise a scene-space window gets
        // interpreted as a world-space one and, once zoomed in enough that the
        // discrepancy no longer accidentally overlaps real rooms, the plane
        // materialises nothing. Same corner-projection trick as CullIndex uses
        // for the forward direction, just inverted.
        const reader = this.state.mapReader;
        if (isViewportDataSource(reader) && this.hasRealViewport()) {
            const padded = this.padViewport(this.camera.getViewportBounds());
            const worldBounds = projectBounds(padded.minX, padded.minY, padded.maxX, padded.maxY, this.coordinateInverse);
            reader.setViewport(worldBounds);
            this.lastAppliedViewport = padded;
            this.lastAppliedScale = this.camera.getScale();
        }

        const mode = this.computeLodMode();
        this.lodMode = mode;
        if (mode === "raster") {
            // Raster overview: the underlay paints every room as pixels; the
            // vector scene is cleared instead of built. Position marker,
            // highlights, paths and scene overlays still render below.
            this.clearVectorScene();
            this.lodController.setSource(this.rasterVisit(currentAreaInstance, plane, currentZIndex));
        } else {
            this.lodController.clear();
            // "roomsOnly" swaps in an area that reports no link exits, so the
            // pipeline skips exit pairing and exit-shape building entirely —
            // rooms still build as full vector shapes.
            const areaForBuild = mode === "roomsOnly" ? withoutLinkExits(currentAreaInstance) : currentAreaInstance;
            this.buildScene(areaForBuild, plane, currentZIndex);
            this.onSceneBuilt();
        }
        this.syncHighlights();
        this.syncPaths();
        if (positionRoomId !== undefined) {
            this.onPositionChanged(positionRoomId, false, false);
        }
        for (const [id, overlay] of this.sceneOverlays) {
            this.renderSceneOverlay(id, overlay);
        }
        this.emitLodEvent(mode, currentAreaInstance, plane, currentZIndex);
    }

    // --- LOD helpers ---

    /**
     * Viewport clamping and LOD only engage once the camera has a real size.
     * Container-backed stages always do; a headless backend starts at 1×1
     * (a meaningless viewport that must not clamp exports) until the caller
     * opts in via `camera.setSize(w, h)`.
     */
    private hasRealViewport(): boolean {
        return this.camera.width > 1 || this.camera.height > 1;
    }

    /**
     * Pad viewport bounds by 6% + 1 map unit per side: rooms are selected by
     * centre, so a room just off-screen can still have half its body in view —
     * the margin keeps edge rooms from popping and lets the regular culling
     * reveal margin rooms between rebuilds (rebuild-on-pan hysteresis).
     */
    private padViewport(vp: ViewportBounds): ViewportBounds {
        const padX = (vp.maxX - vp.minX) * VIEWPORT_PAD_FRACTION + 1;
        const padY = (vp.maxY - vp.minY) * VIEWPORT_PAD_FRACTION + 1;
        return {minX: vp.minX - padX, maxX: vp.maxX + padX, minY: vp.minY - padY, maxY: vp.maxY + padY};
    }

    private planeRoomCount(area: IArea, plane: IPlane, zIndex: number): number {
        const reader = this.state.mapReader;
        return isViewportDataSource(reader)
            ? reader.getPlaneRoomCount(area.getAreaId(), zIndex)
            : plane.getRooms().length;
    }

    private computeLodMode(): LodMode {
        const settings = this.state.settings;
        if (!settings.lodEnabled || !this.hasRealViewport()) return "vector";
        const {currentAreaInstance, currentZIndex} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return "vector";
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) return "vector";
        // The vector scene actually materialises the PADDED viewport
        // (padViewport), not the raw camera one — shrink both effective
        // budgets by the same overscan factor so each flip accounts for it
        // instead of silently drawing ~25% more rooms than configured.
        return computeLodMode({
            planeRoomCount: this.planeRoomCount(currentAreaInstance, plane, currentZIndex),
            scale: this.camera.getScale(),
            stageWidth: this.camera.width,
            stageHeight: this.camera.height,
            roomBudget: settings.lodRoomBudget / VIEWPORT_PAD_AREA_FACTOR,
            exitBudget: settings.lodExitBudget / VIEWPORT_PAD_AREA_FACTOR,
        });
    }

    /** Room source for the raster painter (never materialises rooms for viewport-aware readers). */
    private rasterVisit(area: IArea, plane: IPlane, zIndex: number): RasterVisit {
        const reader = this.state.mapReader;
        if (isViewportDataSource(reader)) {
            const areaId = area.getAreaId();
            return (b, fn) => reader.forEachInBounds(areaId, zIndex, b, fn);
        }
        return (b, fn) => {
            for (const r of plane.getRooms()) {
                if (r.x >= b.minX && r.x <= b.maxX && r.y >= b.minY && r.y <= b.maxY) {
                    fn(r.x, r.y, r.env);
                }
            }
        };
    }

    /** Tear down the vector scene (raster mode replaces it entirely). */
    private clearVectorScene(): void {
        this.shapeToDrawEntry = new Map();
        this.shapeToGroup.clear();
        this.sceneManager.reset();
        this.hitTester.clear();
        this.lastHitShapes = [];
        this.lastVisibleShapes = new Set();
        this.spilledRoomPositions = new Map();
        this.sceneNode.destroyChildren();
        this.topLabelLayerNode.destroyChildren();
        this.stage.batchDraw();
    }

    /**
     * Above `settings.lodHitTestBudget` rooms in the current plane build, skip
     * rebuilding the hit index instead of paying for it on every rebuild — the
     * vector scene still renders at full detail, but clicks/hover stop
     * resolving to a room until the density drops back under the budget.
     * Counted in rooms (same unit as `lodRoomBudget`), not raw hittable-shape
     * count, so the two settings are directly comparable.
     */
    private hitTestBudgetExceeded(): boolean {
        if (!this.state.settings.lodEnabled) return false;
        const {currentAreaInstance, currentZIndex} = this.state;
        if (!currentAreaInstance || currentZIndex === undefined) return false;
        const plane = currentAreaInstance.getPlane(currentZIndex);
        if (!plane) return false;
        return plane.getRooms().length > this.state.settings.lodHitTestBudget;
    }

    private emitLodEvent(mode: LodMode, area: IArea, plane: IPlane, zIndex: number): void {
        if (!this.state.settings.lodEnabled) return;
        const reader = this.state.mapReader;
        const planeRoomCount = this.planeRoomCount(area, plane, zIndex);
        const bounds = this.lastAppliedViewport ?? this.camera.getViewportBounds();
        const visibleEstimate = isViewportDataSource(reader)
            ? reader.estimateVisibleCount(area.getAreaId(), zIndex, bounds)
            : planeRoomCount;
        const hitTestActive = mode === "raster" ? false : !this.hitTestBudgetExceeded();
        this.events.emit('lod', {mode, planeRoomCount, visibleEstimate, hitTestActive});
    }

    addLiveEffect(id: string, effect: LiveEffect) {
        this.removeLiveEffect(id);
        effect.attach(this.overlayLayer);
        this.liveEffects.set(id, effect);
        effect.updateViewport(this.camera.getViewportBounds(), this.camera.getScale(), this.coordinateTransform);
    }

    removeLiveEffect(id: string) {
        const existing = this.liveEffects.get(id);
        if (existing) {
            existing.destroy();
            this.liveEffects.delete(id);
        }
    }

    addSceneOverlay(id: string, overlay: SceneOverlay) {
        const existing = this.sceneOverlays.get(id);
        if (existing) {
            existing.detach?.();
            this.clearSceneOverlayNodes(id);
        }
        this.sceneOverlays.set(id, overlay);
        overlay.attach?.(this.createOverlayContext(id, overlay));
        this.renderSceneOverlay(id, overlay);
    }

    removeSceneOverlay(id: string) {
        const overlay = this.sceneOverlays.get(id);
        if (!overlay) return;
        overlay.detach?.();
        this.sceneOverlays.delete(id);
        this.clearSceneOverlayNodes(id);
        this.overlayLayer.batchDraw();
    }

    /** Iterable of scene overlays — used by exporters to apply them over static outputs. */
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
                // Skip if the overlay was removed/replaced since attach.
                if (this.sceneOverlays.get(id) !== overlay) return;
                this.renderSceneOverlay(id, overlay);
            },
        };
    }

    private renderSceneOverlay(id: string, overlay: SceneOverlay) {
        this.clearSceneOverlayNodes(id);
        const bounds = this.camera.getViewportBounds();
        const out = overlay.render(this.state, bounds);
        if (out) {
            const shapes = Array.isArray(out) ? out : [out];
            const stored: RecordingGroupNode[] = [];
            for (const shape of shapes) {
                const node = this.addStyledShape(shape, this.overlayLayerNode, overlay.sceneSpace);
                if (node) stored.push(node);
            }
            this.sceneOverlayNodes.set(id, stored);
        }
        this.overlayLayer.batchDraw();
    }

    private clearSceneOverlayNodes(id: string) {
        const nodes = this.sceneOverlayNodes.get(id);
        if (!nodes) return;
        for (const node of nodes) node.destroy();
        this.sceneOverlayNodes.delete(id);
    }

    private subscribeToState(state: MapState) {
        state.events.on('area', () => {
            this.refresh();
        });

        state.events.on('position', ({roomId, center, areaChanged}) => {
            this.onPositionChanged(roomId, center, areaChanged);
            // Neighbour spill is anchored to the player position, so it must be
            // rebuilt on every move when enabled. This also covers area changes:
            // the 'area' event fires (and refreshes) *before* MapState updates
            // positionRoomId, so that refresh sees the old room — we rebuild here
            // once the new position is current. (A within-area move gets no
            // 'area' event, so this is its only rebuild.)
            if (this.state.settings.neighborSpill && roomId !== undefined) {
                this.refresh();
            }
        });

        state.events.on('center', ({roomId, instant}) => {
            const room = state.mapReader.getRoom(roomId);
            if (room) {
                const p = this.mapPoint(room.x, room.y);
                this.camera.panToMapPointAnimated(p.x, p.y,
                    instant || this.state.settings.instantMapMove);
            }
        });

        state.events.on('highlight', ({roomId, colors}) => {
            this.syncHighlight(roomId, colors);
        });

        state.events.on('path', () => {
            this.syncPaths();
        });

        state.events.on('clear', () => {
            this.syncHighlights();
        });

        state.events.on('lens', () => {
            this.refresh();
        });
    }

    // --- Scene lifecycle ---

    private buildScene(area: IArea, plane: IPlane, zIndex: number): void {
        this.positionLayer.destroyChildren();
        this.positionMarker = undefined;
        this.clearOverlayShapes();
        this.currentRoomOverlay = [];

        // Reset the scene-driving layer nodes; sceneManager.rebuild only
        // produces shapes now, so this renderer is responsible for walking
        // them onto the Konva layers as RecordingGroupNodes.
        this.sceneNode.destroyChildren();
        this.gridLayerNode.destroyChildren();
        this.gridCachedBounds = null;
        this.topLabelLayerNode.destroyChildren();

        const spill = this.computeNeighborSpill(area, zIndex);
        this.spilledRoomPositions = spill ? spillPositionMap(spill) : new Map();
        const result = this.sceneManager.rebuild(area, plane, zIndex, this.state.lens, spill);

        // Track ORIGINAL shape (pre-style) → recording node so onSceneBuilt
        // can find each room/exit's DrawEntry inside `sceneNode` for culling.
        // When style.transform fans a shape into multiple, we record the first
        // resulting node against the original — cull toggles that one.
        this.shapeToGroup = new Map();

        // Seed the grid for the first paint; subsequent updates are driven by
        // refreshGrid() on every camera change.
        this.refreshGrid(this.camera.getViewportBounds());

        for (const shape of result.sceneShapes.link) {
            const node = this.addStyledShape(shape, this.sceneNode);
            if (node) this.shapeToGroup.set(shape, node);
        }
        for (const shape of result.sceneShapes.room) {
            const node = this.addStyledShape(shape, this.sceneNode);
            if (node) this.shapeToGroup.set(shape, node);
        }
        for (const shape of result.sceneShapes.topLabel) {
            this.addStyledShape(shape, this.topLabelLayerNode);
        }
    }

    /**
     * Compute neighbouring-area spill for the current build, or `undefined` when
     * the feature is off / the player isn't on this area+plane. Driven by the
     * live player position so it updates as the player nears a boundary.
     */
    private computeNeighborSpill(area: IArea, zIndex: number): NeighborSpill | undefined {
        const settings = this.state.settings;
        if (!settings.neighborSpill) return undefined;
        const playerRoomId = this.state.positionRoomId;
        if (playerRoomId === undefined) return undefined;
        const room = this.state.mapReader.getRoom(playerRoomId);
        if (!room || room.area !== area.getAreaId() || room.z !== zIndex) return undefined;
        const lens = this.state.lens;
        return computeNeighborSpill(
            this.state.mapReader,
            area.getAreaId(),
            zIndex,
            playerRoomId,
            settings.neighborSpillDistance,
            (room) => lens.isVisible(room),
        );
    }

    /**
     * The map reader the overlay code (highlights, paths) should use. When
     * neighbour spill produced rooms, this is a {@link ProjectedMapReader} that
     * makes those spilled rooms look like current-area rooms at their projected
     * positions; otherwise it's the plain reader.
     */
    private overlayReader(): IMapReader {
        if (this.spilledRoomPositions.size === 0
            || this.state.currentArea === undefined
            || this.state.currentZIndex === undefined) {
            return this.state.mapReader;
        }
        return new ProjectedMapReader(
            this.state.mapReader,
            this.state.currentArea,
            this.state.currentZIndex,
            this.spilledRoomPositions,
        );
    }

    /**
     * Run the active {@link Style} over `shape`, walk the (possibly multi-shape)
     * result into a single {@link RecordingGroupNode}, and add it to `layerNode`.
     *
     * Styles like Isometric expand one input shape into several (cube top + side
     * faces + edges); wrapping the whole expansion into one node keeps a 1:1
     * relationship between input shape and tracked handle, so callers that cache
     * the return value (position marker, scene overlays, highlights, current-room
     * overlay, paths) can destroy the entire expansion through that one handle.
     *
     * `bypassStyle` skips the Style transform entirely — used for overlays whose
     * geometry is already in rendered space (e.g. hit-area debug visualisation).
     */
    private addStyledShape(
        shape: Shape,
        layerNode: {addNode(node: RecordingGroupNode): void},
        bypassStyle = false,
    ): RecordingGroupNode | undefined {
        const styled = bypassStyle || this.currentStyle === identityStyle
            ? [shape]
            : applyStyleToShapes([shape], this.currentStyle, this.styleContext());
        if (styled.length === 0) return undefined;

        let groupShape: GroupShape;
        if (styled.length === 1 && styled[0].type === "group") {
            groupShape = styled[0];
        } else {
            groupShape = {
                type: "group",
                x: 0, y: 0,
                children: styled,
                layer: shape.layer,
                noScale: shape.noScale,
            };
        }
        const node = shapeToRecording(groupShape);
        layerNode.addNode(node);
        return node;
    }

    /**
     * Recompute and re-publish the grid lines for the given viewport.
     * Cached against snapped grid bounds so per-frame redraws are cheap when
     * the viewport hasn't crossed a grid step.
     */
    private refreshGrid(bounds: ViewportBounds): void {
        const settings = this.state.settings;
        if (!settings.gridEnabled) {
            if (this.gridCachedBounds !== null) {
                this.gridLayerNode.destroyChildren();
                this.gridLayerNode.batchDraw();
                this.gridCachedBounds = null;
            }
            return;
        }

        const inv = this.coordinateInverse;
        const c1 = inv(bounds.minX, bounds.minY);
        const c2 = inv(bounds.maxX, bounds.minY);
        const c3 = inv(bounds.maxX, bounds.maxY);
        const c4 = inv(bounds.minX, bounds.maxY);
        const cartMinX = Math.min(c1.x, c2.x, c3.x, c4.x);
        const cartMaxX = Math.max(c1.x, c2.x, c3.x, c4.x);
        const cartMinY = Math.min(c1.y, c2.y, c3.y, c4.y);
        const cartMaxY = Math.max(c1.y, c2.y, c3.y, c4.y);
        const buffer = settings.gridSize * 2;
        const left = Math.floor((cartMinX - buffer) / settings.gridSize) * settings.gridSize;
        const right = Math.ceil((cartMaxX + buffer) / settings.gridSize) * settings.gridSize;
        const top = Math.floor((cartMinY - buffer) / settings.gridSize) * settings.gridSize;
        const bottom = Math.ceil((cartMaxY + buffer) / settings.gridSize) * settings.gridSize;

        const cached = this.gridCachedBounds;
        if (cached && cached.left === left && cached.right === right && cached.top === top && cached.bottom === bottom) {
            return;
        }

        this.gridLayerNode.destroyChildren();
        const lines = layoutGrid(bounds, settings, {inverseTransform: this.coordinateInverse});
        for (const line of lines) {
            this.addStyledShape(line, this.gridLayerNode);
        }
        this.gridCachedBounds = {left, right, top, bottom};
        this.gridLayerNode.batchDraw();
    }

    private onSceneBuilt() {
        this.lastHitShapes = this.sceneManager.hitShapes as Shape[];
        if (this.hitTestBudgetExceeded()) {
            this.hitTester.clear();
        } else {
            this.hitTester.build(this.lastHitShapes, this.state.settings.roomSize, this._coordinateTransform, this.coordinateLayerOffset);
        }

        const scale = this.camera.getScale();
        this.stage.scale({x: scale, y: scale});

        // Build shape → DrawEntry map for all scene shapes (link + room layers).
        // TopLabel shapes live on a separate RecordingLayerNode and are always visible.
        this.shapeToDrawEntry = new Map();
        for (const [shape, node] of this.shapeToGroup) {
            const drawEntry = this.sceneNode.getEntry(node);
            if (drawEntry) this.shapeToDrawEntry.set(shape, drawEntry);
        }
        // All freshly-built entries start visible; treat the whole managed set
        // as "previously visible" so the first cull hides the off-screen ones.
        this.lastVisibleShapes = this.sceneManager.managedShapes(this._coordinateTransform);
        this.applyClipping();
        this.stage.batchDraw();
    }

    private applyClipping(): void {
        if (!this.sceneManager.lastResult) return;

        const visible = this.sceneManager.cullInteractive(this._coordinateTransform);
        const prev = this.lastVisibleShapes;
        let changed = false;

        // Hide shapes that left the viewport since last pass.
        for (const shape of prev) {
            if (visible.has(shape)) continue;
            const entry = this.shapeToDrawEntry.get(shape);
            if (entry && entry.visible) {
                entry.visible = false;
                changed = true;
            }
        }
        // Reveal shapes that entered the viewport since last pass.
        for (const shape of visible) {
            if (prev.has(shape)) continue;
            const entry = this.shapeToDrawEntry.get(shape);
            if (entry && !entry.visible) {
                entry.visible = true;
                changed = true;
            }
        }

        this.lastVisibleShapes = visible;
        if (changed) this.sceneNode.batchDraw();
    }

    // --- Position & overlay ---

    private onPositionChanged(roomId: number | undefined, center: boolean, instant: boolean) {
        if (roomId === undefined) {
            if (this.positionMarker) {
                this.positionMarker.destroy();
                this.positionMarker = undefined;
            }
            this.positionLayerNode.batchDraw();
            this.clearCurrentRoomOverlay();
            this.overlayLayerNode.batchDraw();
            return;
        }

        const room = this.state.mapReader.getRoom(roomId);
        if (!room) return;

        if (center) {
            const p = this.mapPoint(room.x, room.y);
            this.camera.panToMapPointAnimated(p.x, p.y,
                instant || this.state.settings.instantMapMove);
        }

        this.updateCurrentRoomOverlay(room);
        this.applyPositionMarker(room);
    }

    private applyPositionMarker(room: MapData.Room) {
        if (this.positionMarker) {
            this.positionMarker.destroy();
            this.positionMarker = undefined;
        }
        // Mirrors the contract in MapState.getOverlaysForArea: the position
        // marker is only visible when the player room is on the displayed area/z.
        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            this.positionLayerNode.batchDraw();
            return;
        }
        const data = computePositionMarker(room, this.state.settings);
        this.positionMarker = this.addStyledShape(positionMarkerToShape(data), this.positionLayerNode);
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.positionLayerNode.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) {
            this.positionLayerNode.batchDraw();
            return;
        }

        const settings = this.state.settings;

        // Raster LOD overview: the vector scene is suppressed, so skip the
        // exit/neighbour enrichment too (on a viewport-aware reader zoomed far
        // out it could materialise the entire plane). The marker still shows.
        // ("roomsOnly" only drops the BULK scene's exit lines — this overlay
        // looks up just the current room's own exits via the real (unwrapped)
        // area, so it stays cheap and stays enabled in that tier.)
        if (this.lodMode === "raster") {
            if (this.positionMarker) this.positionMarker.moveToTop();
            this.positionLayerNode.batchDraw();
            return;
        }

        if (!settings.highlightCurrentRoom) {
            if (this.positionMarker) this.positionMarker.moveToTop();
            this.positionLayerNode.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        const preRoomShapes: Shape[] = [];
        const exitRenderer = this.sceneManager.exitRenderer;
        // Respect the active lens (exploration + hidden rooms) so the overlay
        // never highlights exits/neighbours the main scene drops.
        const lens = hiddenAwareLens(this.state.lens, settings.hiddenRooms === "hide");

        // Link exits for this room → rendered as ExitDrawData through DrawingBackend
        if (this.state.currentAreaInstance && this.state.currentZIndex !== undefined) {
            const exits = this.state.currentAreaInstance
                .getLinkExits(this.state.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const roomA = this.state.mapReader.getRoom(exit.a);
                const roomB = this.state.mapReader.getRoom(exit.b);
                if (!roomA || !roomB) return;
                const treatment = lens.getExitTreatment
                    ? lens.getExitTreatment(exit, roomA, roomB)
                    : defaultExitTreatment(lens, exit, roomA, roomB);
                if (treatment !== "full") return; // skip hidden/partially-visible exits
                const data = exitRenderer.renderDataWithColor(exit, currentRoomColor, this.state.currentZIndex!);
                if (data) {
                    // Match the main pass: a crossing into a spilled neighbour room
                    // is shown as a plain connector, so suppress its cross-area arrow.
                    if (data.targetRoomId !== undefined && this.spilledRoomPositions.has(data.targetRoomId)) return;
                    preRoomShapes.push(this.sceneManager.buildExitShape(data));
                }
            });
        }

        // Special exits
        for (const se of computeSpecialExits(room, settings, currentRoomColor)) {
            preRoomShapes.push(specialExitToShape(se, room.id));
        }

        // Stubs
        for (const stub of computeStubs(room, settings, currentRoomColor)) {
            preRoomShapes.push(stubToShape(stub));
        }

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.state.mapReader.getRoom(id);
            if (
                otherRoom &&
                otherRoom.area === this.state.currentArea &&
                otherRoom.z === this.state.currentZIndex &&
                lens.isVisible(otherRoom)
            ) {
                roomsToRedraw.set(id, otherRoom);
            }
        });

        preRoomShapes.forEach(shape => {
            const node = this.addStyledShape(shape, this.positionLayerNode);
            if (node) this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayShape = layoutRoom(
                roomToRedraw,
                this.state.mapReader,
                settings,
                {
                    strokeOverride: isCurrent ? currentRoomColor : settings.lineColor,
                    flatPipeline: true,
                    // Keep a redrawn hidden room looking hidden (dashed/faded),
                    // matching the main scene instead of overpainting it solid.
                    ...hiddenRoomLayoutOptions(roomToRedraw, settings.hiddenRooms),
                },
            );
            overlayShape.children.push(...layoutInnerExits(roomToRedraw, this.state.mapReader, settings));
            const node = this.addStyledShape(overlayShape, this.positionLayerNode);
            if (node) this.currentRoomOverlay.push(node);
        });

        if (this.positionMarker) {
            this.positionMarker.moveToTop();
        }

        this.positionLayerNode.batchDraw();
    }

    // --- Highlight & path sync ---

    syncHighlight(roomId: number, colors: string[] | undefined) {
        const existing = this.highlightShapes.get(roomId);
        if (existing) {
            existing.destroy();
            this.highlightShapes.delete(roomId);
        }
        if (colors !== undefined) {
            // overlayReader makes spilled neighbour rooms report the current
            // area at their projected coords, so the visibility check below
            // passes for them and the highlight lands across the boundary.
            const room = this.overlayReader().getRoom(roomId);
            if (room && room.area === this.state.currentArea && room.z === this.state.currentZIndex) {
                const data = computeHighlight(room, colors, this.state.settings);
                const node = this.addStyledShape(highlightToShape(data), this.overlayLayerNode);
                if (node) this.highlightShapes.set(roomId, node);
            }
        }
        this.overlayLayerNode.batchDraw();
    }

    syncHighlights() {
        for (const node of this.highlightShapes.values()) node.destroy();
        this.highlightShapes.clear();

        const reader = this.overlayReader();
        for (const [roomId] of this.state.highlights) {
            // Resolve through overlayReader so spilled rooms are placed at their
            // projected coords; gate on the resolved room's area/z (spilled
            // rooms report the current area, current-area rooms pass as before).
            const room = reader.getRoom(roomId);
            if (!room || room.area !== this.state.currentArea || room.z !== this.state.currentZIndex) continue;
            const entry = this.state.highlights.get(roomId)!;
            const data = computeHighlight(room, entry.colors, this.state.settings);
            const node = this.addStyledShape(highlightToShape(data), this.overlayLayerNode);
            if (node) this.highlightShapes.set(roomId, node);
        }
        this.overlayLayerNode.batchDraw();
    }

    syncPaths() {
        this.clearPathShapes();
        const {currentArea, currentZIndex} = this.state;
        if (currentArea === undefined || currentZIndex === undefined) return;

        const reader = this.overlayReader();
        for (const path of this.state.paths) {
            const data = computePathOverlay(
                reader, this.state.settings,
                path.locations, path.color,
                currentArea, currentZIndex,
            );
            for (const s of pathToShapes(data)) {
                const node = this.addStyledShape(s, this.overlayLayerNode);
                if (node) this.pathShapes.push(node);
            }
        }
        this.overlayLayerNode.batchDraw();
    }

    // --- Private helpers ---

    private clearOverlayShapes() {
        for (const node of this.highlightShapes.values()) node.destroy();
        this.highlightShapes.clear();
        this.clearPathShapes();
    }

    private clearPathShapes() {
        for (const shape of this.pathShapes) {
            shape.destroy();
        }
        this.pathShapes = [];
    }
}
