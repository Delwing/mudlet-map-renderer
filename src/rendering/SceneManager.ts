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
import {clipSceneToViewport, buildCullingVisibilityMap} from "../export/clipSceneToViewport";
import type {Camera} from "../camera/Camera";
import type {CoordFn} from "../coord/CoordFn";
import {IDENTITY_TRANSFORM} from "../coord/CoordFn";
import type {SceneTransforms} from "../export/clipSceneToViewport";
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
        return this.lastBuildResult;
    }

    buildExitShape(data: ExitDrawData): GroupShape {
        return this.pipeline.buildExitShape(data);
    }

    reset(): void {
        this.lastBuildResult = undefined;
        this.standaloneExitShapeSet = new Set();
    }

    resetPipeline(mapReader: IMapReader): void {
        this.pipeline = new ScenePipeline(mapReader, this.settings);
        this.reset();
    }

    /**
     * Lightweight cull for the interactive render path.  Returns a
     * `Map<Shape, boolean>` where absent shapes are unmanaged pass-throughs
     * (always visible).  Avoids the 12 Sets + 2 filtered arrays produced by
     * the full {@link cull} path.
     */
    cullInteractive(coordinateTransform: CoordFn = IDENTITY_TRANSFORM): Map<Shape, boolean> {
        if (!this.lastBuildResult) return new Map();
        const viewport = this.camera.getCullingViewport(this.settings.cullingBounds);
        const transforms: SceneTransforms | undefined = coordinateTransform !== IDENTITY_TRANSFORM
            ? {forward: coordinateTransform as (x: number, y: number) => {x: number; y: number}}
            : undefined;
        return buildCullingVisibilityMap(this.lastBuildResult, viewport, this.settings, transforms);
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
