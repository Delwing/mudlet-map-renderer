import type {IArea} from "../reader/Area";
import type {IPlane} from "../reader/Plane";
import type {Settings} from "../types/Settings";
import {ScenePipeline} from "../ScenePipeline";
import type {
    SceneBuildResult,
    SceneShapesByLayer,
    AreaExitHitZone,
    DrawnExitEntry,
    DrawnSpecialExitEntry,
    DrawnStubEntry,
} from "../ScenePipeline";
import {clipSceneToViewport} from "../export/clipSceneToViewport";
import type {Camera} from "../camera/Camera";
import type {CoordFn} from "../coord/CoordFn";
import {IDENTITY_TRANSFORM} from "../coord/CoordFn";
import type {SceneTransforms} from "../export/clipSceneToViewport";
import {CullIndex, projectBounds, type CullIndexEntry} from "../render/CullIndex";
import type {GroupShape, Shape} from "../scene/Shape";
import type {IMapReader} from "../reader/MapReader";
import type {RoomLens} from "../lens/RoomLens";
import type {ExitDrawData} from "../ExitRenderer";
import type {NeighborSpill} from "../scene/NeighborProjector";

export interface CullStats {
    visibleRooms: number;
    totalRooms: number;
    visibleExits: number;
}

export interface CullOutput {
    shapes: SceneShapesByLayer;
    stats: CullStats;
}

const EMPTY_SCENE: SceneShapesByLayer = {grid: [], link: [], room: [], topLabel: []};

/**
 * Encapsulates the scene build + cull pipeline for the interactive renderer.
 *
 * Owns {@link ScenePipeline} and the last {@link SceneBuildResult}. Backends
 * call {@link rebuild} when the area/plane changes, then {@link cull} on each
 * viewport update to get the currently-visible shapes. Neither the pipeline
 * nor {@link clipSceneToViewport} need to be referenced outside this class.
 */
export class SceneManager {
    private pipeline: ScenePipeline;
    private lastBuildResult?: SceneBuildResult;
    private standaloneExitShapeSet: Set<Shape> = new Set();

    /** Spatial index over the current scene, built lazily and memoised per transform. */
    private cullIndex?: CullIndex;
    private cullIndexTransform?: CoordFn;

    constructor(
        private readonly camera: Camera,
        private readonly settings: Settings,
        mapReader: IMapReader,
    ) {
        this.pipeline = new ScenePipeline(mapReader, settings);
    }

    get exitRenderer() {
        return this.pipeline.exitRenderer;
    }

    get lastResult(): SceneBuildResult | undefined {
        return this.lastBuildResult;
    }

    get drawnExits(): readonly DrawnExitEntry[] {
        return this.lastBuildResult?.drawnExits ?? [];
    }

    get drawnSpecialExits(): readonly DrawnSpecialExitEntry[] {
        return this.lastBuildResult?.drawnSpecialExits ?? [];
    }

    get drawnStubs(): readonly DrawnStubEntry[] {
        return this.lastBuildResult?.drawnStubs ?? [];
    }

    get areaExitHitZones(): readonly AreaExitHitZone[] {
        return this.lastBuildResult?.areaExitHitZones ?? [];
    }

    get hitShapes(): readonly Shape[] {
        return this.lastBuildResult?.hitShapes ?? [];
    }

    rebuild(area: IArea, plane: IPlane, zIndex: number, lens?: RoomLens, spill?: NeighborSpill): SceneBuildResult {
        this.lastBuildResult = this.pipeline.buildScene(area, plane, zIndex, lens, spill);
        this.standaloneExitShapeSet = new Set(
            this.lastBuildResult.standaloneExitShapeRefs.map(r => r.shape),
        );
        this.cullIndex = undefined;
        this.cullIndexTransform = undefined;
        return this.lastBuildResult;
    }

    buildExitShape(data: ExitDrawData): GroupShape {
        return this.pipeline.buildExitShape(data);
    }

    reset(): void {
        this.lastBuildResult = undefined;
        this.standaloneExitShapeSet = new Set();
        this.cullIndex = undefined;
        this.cullIndexTransform = undefined;
    }

    resetPipeline(mapReader: IMapReader): void {
        this.pipeline = new ScenePipeline(mapReader, this.settings);
        this.reset();
    }

    /**
     * Lightweight cull for the interactive render path. Returns the set of
     * currently-visible managed shapes (rooms, exits, labels, stubs…) by
     * querying the spatial {@link CullIndex} — O(visible cells), not O(all
     * shapes). Shapes outside this set that are *known to the index* should be
     * hidden; shapes the index has never heard of are unmanaged pass-throughs
     * (always visible) and the caller must leave them alone.
     *
     * When culling is disabled the full managed-shape set is returned, so the
     * caller's delta logic naturally reveals everything.
     */
    cullInteractive(coordinateTransform: CoordFn = IDENTITY_TRANSFORM): Set<Shape> {
        if (!this.lastBuildResult) return new Set();
        const index = this.ensureCullIndex(coordinateTransform);
        if (!this.settings.cullingEnabled) return new Set(index.getAllShapes());
        const viewport = this.camera.getCullingViewport(this.settings.cullingBounds);
        return index.queryVisible(viewport);
    }

    /**
     * Every shape the cull index can hide. Callers seed their "previously
     * visible" set with this after a rebuild (all entries start visible) so the
     * first cull pass hides the off-screen ones.
     */
    managedShapes(coordinateTransform: CoordFn = IDENTITY_TRANSFORM): Set<Shape> {
        if (!this.lastBuildResult) return new Set();
        return new Set(this.ensureCullIndex(coordinateTransform).getAllShapes());
    }

    /** Build (or reuse) the spatial index for the current scene + transform. */
    private ensureCullIndex(coordinateTransform: CoordFn): CullIndex {
        if (this.cullIndex && this.cullIndexTransform === coordinateTransform) {
            return this.cullIndex;
        }
        const index = new CullIndex();
        index.build(this.buildCullEntries(coordinateTransform));
        this.cullIndex = index;
        this.cullIndexTransform = coordinateTransform;
        return index;
    }

    /**
     * Project every cullable shape's world-space bounds into scene space and
     * collect them as index entries. Mirrors the bounds used by
     * `buildCullingVisibilityMap` exactly so the index and the export-path
     * predicate agree on which shapes a viewport contains.
     */
    private buildCullEntries(coordinateTransform: CoordFn): CullIndexEntry[] {
        const result = this.lastBuildResult!;
        const half = this.settings.roomSize / 2;
        const entries: CullIndexEntry[] = [];

        const add = (shape: Shape, minX: number, minY: number, maxX: number, maxY: number) => {
            const b = projectBounds(minX, minY, maxX, maxY, coordinateTransform);
            entries.push({shape, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY});
        };

        for (const {room, shape} of result.roomShapeRefs.values()) {
            add(shape, room.x - half, room.y - half, room.x + half, room.y + half);
        }
        for (const {shape, bounds: b} of result.standaloneExitShapeRefs) {
            add(shape, b.x, b.y, b.x + b.width, b.y + b.height);
        }
        for (const {shape, bounds: b} of result.labelShapeRefs) {
            add(shape, b.x, b.y, b.x + b.width, b.y + b.height);
        }
        for (const {shape, bounds: b} of result.specialExitShapeRefs) {
            add(shape, b.x, b.y, b.x + b.width, b.y + b.height);
        }
        for (const {shape, bounds: b} of result.stubShapeRefs) {
            add(shape, b.x, b.y, b.x + b.width, b.y + b.height);
        }
        for (const {shape, bounds: b} of result.areaExitLabelShapeRefs) {
            add(shape, b.x, b.y, b.x + b.width, b.y + b.height);
        }

        return entries;
    }

    cull(coordinateTransform: CoordFn = IDENTITY_TRANSFORM): CullOutput {
        if (!this.lastBuildResult) {
            return {shapes: EMPTY_SCENE, stats: {visibleRooms: 0, totalRooms: 0, visibleExits: 0}};
        }

        const viewport = this.camera.getCullingViewport(this.settings.cullingBounds);
        const transforms: SceneTransforms | undefined = coordinateTransform !== IDENTITY_TRANSFORM
            ? {forward: coordinateTransform as (x: number, y: number) => {x: number; y: number}}
            : undefined;
        const shapes = clipSceneToViewport(this.lastBuildResult, viewport, this.settings, transforms);

        return {
            shapes,
            stats: {
                visibleRooms: shapes.room.length,
                totalRooms: this.lastBuildResult.roomShapeRefs.size,
                visibleExits: shapes.link.filter(s => this.standaloneExitShapeSet.has(s)).length,
            },
        };
    }
}
