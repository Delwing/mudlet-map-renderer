# Refactor: Unified Renderer Architecture

## Motivation

The current codebase has two separate top-level rendering paths:

1. **Interactive** — `KonvaRenderBackend` owns `Viewport`, `CullingManager`, `ScenePipeline`,
   and all overlay logic.
2. **SVG export** — `SvgExporter` creates its own `ScenePipeline` + `SvgBackend`, manually
   re-applies styles, iterates overlays by hand, and has no access to the spatial index, so it
   creates nodes for every room in an area even when exporting a small region.

These paths share `ScenePipeline` and `DrawingBackend` at the bottom but duplicate everything
above them. The goal of this refactor is a single unified path where `DrawingBackend` is the
sole swappable seam (Konva canvas, SVG string, or headless Canvas), and interaction/animation
is an optional layer bolted on top.

---

## Target Architecture (summary)

```
MapRenderer (owns everything)
  ├── camera: Camera               zoom · pan · bounds — always present, public
  ├── culling: CullingManager      spatial index — always present, shared by all paths
  ├── pipeline: ScenePipeline      single scene builder — always present
  ├── activeBackend: DrawingBackend  style(baseBackend) — swappable output target
  └── interaction?: InteractionHandler   only when a DOM container is provided
```

- **`KonvaRenderBackend`** dissolves into a thin `KonvaLayerManager` (creates Stage + layers,
  wires `batchDraw`).
- **`SvgExporter` / `SvgRenderBackend`** disappear — SVG output is just swapping
  `activeBackend` to `SvgBackend` and running the shared pipeline.
- **`InteractiveBackend`** interface is removed entirely.
- **`Camera`** (renamed from `Viewport`) is public on `MapRenderer`; animation moves to
  `InteractionHandler`.
- **`CullingManager`** is shared — Konva path uses it for visibility toggling, SVG/headless
  path uses `queryRoomsInBounds()` to pre-filter rooms before creating any nodes.

---

## Dependency graph

```
Step 1 (Camera rename + drop animation)
├── Step 2 (DrawingBackend: coordinateTransform + requestRedraw)
└── Step 3 (animation → InteractionHandler)
    └── Step 4 (lift Camera to MapRenderer)
        └── Step 5 (lift CullingManager to MapRenderer)
            ├── Step 6 (findRoomAt on MapRenderer)──────────────────────┐
            └── Step 7 (ScenePipeline pre-filtering)────────────────────┤
                                                                         ↓
                                                                  Step 8 (unified path)
                                                                         ↓
                                                                  Step 9 (SceneOverlay + LiveEffect)
                                                                         ↓
                                                                  Step 10 (cleanup)
```

Steps 1–7 are safe and incremental — the existing public API stays intact throughout. Step 8 is
the breaking change. Steps 9–10 are cleanup.

---

## Step 1 — Rename `Viewport` → `Camera`, drop animation

**Files:** `src/Viewport.ts` → `src/Camera.ts`, `src/rendering/KonvaRenderBackend.ts`,
`src/InteractionHandler.ts`, `src/rendering/MapRenderer.ts`, `src/index.ts`,
`src/HeadlessRenderer.ts`, `src/Renderer.ts`

### What to do

1. Copy `src/Viewport.ts` to `src/Camera.ts`. Rename the class from `Viewport` to `Camera`.
2. Remove the following from `Camera`:
   - `private animationId?: number`
   - `private animate(durationMs, update)` method
   - `cancelAnimation()` public method
   - `isAnimating()` public method
   - `panToMapPointAnimated(x, y, instant)` public method
   - The top-level `easeInOut(t)` function
3. Remove the `this.cancelAnimation()` calls inside `startDrag()` (line 237) — drag no longer
   needs to interrupt animation because animation lives elsewhere after Step 3.
4. Delete `src/Viewport.ts`.
5. In `src/rendering/KonvaRenderBackend.ts` replace the two `panToMapPointAnimated` calls
   (lines ~537 and ~612) with `panToMapPoint` — animation is restored in Step 3:
   ```ts
   // Before:
   this.viewport.panToMapPointAnimated(p.x, p.y, instant || this.state.settings.instantMapMove);
   // After (temporary — Step 3 restores animation):
   this.camera.panToMapPoint(p.x, p.y);
   ```
6. Rename every import of `Viewport` to `Camera` across the codebase.
7. In `src/index.ts` export `Camera` instead of `Viewport`.

### Verify
- `yarn test` passes.
- `yarn build` produces no type errors.

---

## Step 2 — Extend `DrawingBackend` with `coordinateTransform` and `requestRedraw`

**Files:** `src/backend/DrawingBackend.ts`, `src/backend/KonvaBackend.ts`,
`src/backend/SvgBackend.ts`, `src/backend/CanvasBackend.ts`, all decorator backends in
`src/style/` (IsometricBackend, SketchyBackend, ParchmentBackend, BlueprintBackend,
NeonBackend), `src/backend/DrawingBackend.ts` (`BaseStyle`)

### What to do

`DrawingBackend` already has `getTransform(): CoordFn` and `getInverseTransform(): CoordFn`.
This step adds a redraw trigger so `LiveEffect`s can request repaints without reaching into
Konva layers directly.

1. Add to the `DrawingBackend` interface in `src/backend/DrawingBackend.ts`:
   ```ts
   /**
    * Request a repaint of the rendered output. Konva backends call layer.batchDraw();
    * static backends (SVG, headless Canvas) are no-ops.
    */
   requestRedraw(): void;
   ```
2. Implement in `KonvaBackend` (`src/backend/KonvaBackend.ts`):
   ```ts
   requestRedraw(): void {
       this.layer.batchDraw();
   }
   ```
   `KonvaBackend` will need a reference to its layer — check how it currently gets one and
   expose it the same way.
3. Implement as no-op in `SvgBackend` and `CanvasBackend`:
   ```ts
   requestRedraw(): void {}
   ```
4. Add a forwarding default in `BaseStyle` in `src/backend/DrawingBackend.ts`:
   ```ts
   requestRedraw(): void {
       this.inner.requestRedraw();
   }
   ```
   This means all decorator backends (Sketchy, Parchment, etc.) get it for free.

### Verify
- `yarn build` produces no type errors (all `DrawingBackend` implementors satisfy the interface).
- `yarn test` passes.

---

## Step 3 — Move animation to `InteractionHandler`

**Files:** `src/InteractionHandler.ts`, `src/rendering/KonvaRenderBackend.ts`

### What to do

Animation was removed from `Camera` in Step 1. Restore it here in `InteractionHandler`, which
already has access to a `Camera` reference and to `requestAnimationFrame`.

1. Add a private `animationId?: number` field to `InteractionHandler`.
2. Add an `easeInOut(t: number): number` private helper (copy from old `Viewport.ts`).
3. Add a public method:
   ```ts
   animatePanTo(x: number, y: number, durationMs = 200): void {
       this.cancelAnimation();
       const startPos = { ...this.viewport.position };
       const scale = this.viewport.getScale();
       const targetPos = {
           x: this.viewport.width / 2 - x * scale,
           y: this.viewport.height / 2 - y * scale,
       };
       // ... RAF loop driving this.viewport.position + this.viewport.onChange
   }

   cancelAnimation(): void { /* cancel pending RAF */ }
   ```
   Note: `InteractionHandler` already holds `this.viewport` — after Step 1 that becomes
   `this.camera` (same object, just renamed).
4. Add `cancelAnimation()` call to `startDrag` handling in `InteractionHandler` so drag
   interrupts a running pan animation.
5. In `KonvaRenderBackend`, update the two `panToMapPoint` call sites from Step 1 back to
   animated pans:
   ```ts
   // 'center' event handler and onPositionChanged:
   if (instant || this.state.settings.instantMapMove) {
       this.camera.panToMapPoint(p.x, p.y);
   } else {
       this.interactionHandler?.animatePanTo(p.x, p.y);
   }
   ```

### Verify
- `yarn demo:dev` — panning to a room animates smoothly.
- `yarn test` passes.

---

## Step 4 — Lift `Camera` to `MapRenderer`

**Files:** `src/rendering/MapRenderer.ts`, `src/rendering/KonvaRenderBackend.ts`,
`src/InteractionHandler.ts`

### What to do

`Camera` moves from being created inside `KonvaRenderBackend` to being created by
`MapRenderer` and injected into the backend.

1. In `MapRenderer`:
   ```ts
   import { Camera } from '../Camera';

   export class MapRenderer {
       readonly state: MapState;
       readonly camera: Camera;        // NEW — public
       readonly backend: InteractiveBackend;
       // ...

       constructor(mapReader, settings?, container?, backendFactory?) {
           const resolvedSettings = settings ?? createSettings();
           this.state = new MapState(mapReader, resolvedSettings);
           this.camera = new Camera(
               container?.clientWidth ?? 1,
               container?.clientHeight ?? 1,
           );
           this.backend = backendFactory
               ? backendFactory(this.state, this.camera)
               : new KonvaRenderBackend(this.state, this.camera, container);
       }
   }
   ```
2. Update `KonvaRenderBackend` constructor signature to accept `Camera` as a parameter instead
   of creating its own:
   ```ts
   constructor(state: MapState, camera: Camera, container?: HTMLDivElement)
   ```
   Remove the `new Camera(...)` / `new Viewport(...)` call from inside `KonvaRenderBackend`.
3. Remove `viewport: Viewport` from the `InteractiveBackend` interface in
   `src/rendering/MapRenderer.ts`.
4. Update all `MapRenderer` proxy methods to use `this.camera` instead of
   `this.backend.viewport`:
   - `setZoom` → `this.camera.setZoom`
   - `zoomToCenter` → `this.camera.zoomToCenter`
   - `getZoom` → `this.camera.zoom`
   - `getViewportBounds` → `this.camera.getViewportBounds()`
   - `fitArea` → `this.camera.fitToMapBounds(...)`
   - `centerOnResize` getter/setter → `this.camera.centerOnResize`
   - `minZoom` getter/setter → `this.camera.minZoom`
5. Update `backendFactory` type signature:
   ```ts
   backendFactory?: (state: MapState, camera: Camera) => InteractiveBackend
   ```

### Verify
- `yarn test` passes.
- `yarn demo:dev` — zoom, pan, fit-area all work.

---

## Step 5 — Lift `CullingManager` to `MapRenderer`

**Files:** `src/rendering/MapRenderer.ts`, `src/rendering/KonvaRenderBackend.ts`,
`src/CullingManager.ts`

### What to do

1. Add `queryRoomsInBounds(bounds: ViewportBounds): Iterable<MapData.Room>` to
   `CullingManager`. Implementation: use `collectRoomCandidates` (already private — make it
   package-accessible or just inline here) to find candidate entries, then filter by exact
   bounds check and return `entry.room` for each match:
   ```ts
   queryRoomsInBounds(bounds: ViewportBounds): MapData.Room[] {
       const { minX, minY, maxX, maxY } = bounds;
       const candidates = this.collectRoomCandidates(minX, minY, maxX, maxY);
       const halfSize = this.settings.roomSize / 2;
       const result: MapData.Room[] = [];
       candidates.forEach(entry => {
           const t = this.transformBounds({
               x: entry.room.x - halfSize, y: entry.room.y - halfSize,
               width: this.settings.roomSize, height: this.settings.roomSize,
           });
           if (t.x + t.width >= minX && t.x <= maxX &&
               t.y + t.height >= minY && t.y <= maxY) {
               result.push(entry.room);
           }
       });
       return result;
   }
   ```
   Note: `collectRoomCandidates` currently uses instance buffer sets. Make sure
   `queryRoomsInBounds` doesn't clobber them — allocate a fresh set or copy before returning.

2. In `MapRenderer`, create and own `CullingManager`:
   ```ts
   readonly culling: CullingManager;  // internal, not in public API yet

   constructor(...) {
       // after creating camera and state:
       this.culling = new CullingManager(/* stageInfo */, roomLayer, linkLayer, settings);
   }
   ```
   The `stageInfo` and layer references are Konva-specific — for now pass a stub from
   `KonvaRenderBackend` after it constructs. This wiring detail may need a small adapter
   (`CullingManager.setStageInfo(info)`) to avoid a chicken-and-egg problem with layer
   construction order. The exact approach can be resolved during implementation; the goal is
   `CullingManager` being passed into `KonvaRenderBackend`, not created inside it.

3. Remove `culling: CullingManager` from the `InteractiveBackend` interface.

4. Update `MapRenderer.setCullingMode()` to use `this.culling` directly:
   ```ts
   setCullingMode(mode: CullingMode) {
       this.state.settings.cullingMode = mode;
       this.state.settings.cullingEnabled = mode !== 'none';
       this.culling.scheduleCulling();
   }
   ```

### Verify
- `yarn test` passes.
- Culling still works visually in the demo (`yarn demo:dev`, zoom out to see rooms appear/disappear).

---

## Step 6 — Expose `findRoomAtMap` and `findRoomAtScreen` on `MapRenderer`

**Files:** `src/rendering/MapRenderer.ts`

### What to do

Now that `CullingManager` is on `MapRenderer`, hit-testing is a direct call — no backend
indirection needed.

1. Add to `MapRenderer`:
   ```ts
   findRoomAtMap(mapX: number, mapY: number): MapData.Room | null {
       return this.culling.findRoomAtMapPoint(mapX, mapY);
   }

   findRoomAtScreen(screenX: number, screenY: number, containerOffset?: { left: number; top: number }): MapData.Room | null {
       const p = this.camera.clientToMapPoint(screenX, screenY, containerOffset);
       if (!p) return null;
       return this.culling.findRoomAtMapPoint(p.x, p.y);
   }
   ```
2. In the editor codebase, replace:
   ```ts
   (renderer.backend as any).culling?.findRoomAtMapPoint?.(mapX, mapY)
   ```
   with:
   ```ts
   renderer.findRoomAtMap(mapX, mapY)
   ```

### Verify
- `yarn test` passes.
- Editor hit-testing still works on mouse move.

---

## Step 7 — Pre-filter rooms in `ScenePipeline` via `CullingManager`

**Files:** `src/ScenePipeline.ts`, `src/CullingManager.ts`, `src/rendering/KonvaRenderBackend.ts`

### What to do

`ScenePipeline.buildScene()` currently calls `plane.getRooms()` and creates nodes for every
room unconditionally. `viewportBounds` is passed but only used for grid rendering. This step
makes culling happen before node creation.

1. Add a `setRoomFilter(filter: ((room: MapData.Room) => boolean) | null)` method to
   `ScenePipeline`, or pass a pre-filtered room list directly into `buildScene`:
   ```ts
   buildScene(area: Area, plane: Plane, zIndex: number, viewportBounds?: ViewportBounds, visibleRooms?: Set<number>): SceneBuildResult
   ```
   The `visibleRooms` set contains room IDs that should be rendered; when absent all rooms are
   rendered (backward-compatible default).

2. In `renderRooms()`, filter before iterating:
   ```ts
   private renderRooms(rooms: MapData.Room[], zIndex: number, visibleRooms?: Set<number>) {
       const filtered = visibleRooms
           ? rooms.filter(r => visibleRooms.has(r.id))
           : rooms;
       filtered.forEach(room => { /* existing logic */ });
   }
   ```

3. In `KonvaRenderBackend.buildScene()`, pass the pre-filtered set:
   ```ts
   const vpBounds = this.camera.getViewportBounds();
   const visibleRooms = this.culling.queryRoomsInBounds(vpBounds);
   const visibleIds = new Set(visibleRooms.map(r => r.id));
   const result = this.pipeline.buildScene(area, plane, zIndex, vpBounds, visibleIds);
   ```

4. In `SvgExporter`, the `viewportBounds` it already computes from `computeExportBounds` can
   now be used to pre-filter rooms the same way — pass it to `culling.queryRoomsInBounds()`.

### Verify
- `yarn test` passes.
- `yarn test:visual` — visual snapshots unchanged (same rooms rendered).
- SVG export of a large area is measurably faster.

---

## Step 8 — Dissolve `KonvaRenderBackend` into unified `MapRenderer` path

**This is the largest step. It is safe to split into sub-tasks.**

**Files:** `src/rendering/MapRenderer.ts`, `src/rendering/KonvaRenderBackend.ts`,
`src/export/SvgExporter.ts`, `src/export/Exporter.ts`, `src/index.ts`, all files that import
`InteractiveBackend`

### Goal

One rendering path. `MapRenderer` owns `ScenePipeline` and `DrawingBackend` directly.
`KonvaRenderBackend` becomes a thin `KonvaLayerManager` that sets up a Konva Stage and layers
and wires `batchDraw`. `SvgExporter` is replaced by a base-backend swap.

### Sub-task 8a — Move overlay management to `MapRenderer`

All overlay logic currently in `KonvaRenderBackend` (position marker, highlight shapes, path
shapes, current-room overlay, area exit hit zones) moves to `MapRenderer`. These render through
`DrawingBackend` already and have no intrinsic Konva dependency.

### Sub-task 8b — `KonvaRenderBackend` → `KonvaLayerManager`

Strip everything from `KonvaRenderBackend` except:
- Creating `Konva.Stage`
- Creating the five `Konva.Layer` instances (grid, link, room, topLabel, overlay, position)
- Calling `stage.batchDraw()` / `layer.batchDraw()`
- Applying Camera transform to the stage (`applyViewportToStage`)
- Providing a `StageInfo` adapter for `CullingManager`

The result is a small class (~100 lines) that `MapRenderer` creates when a DOM container is
provided, and is `null` otherwise (headless/SVG mode).

### Sub-task 8c — Remove `SvgExporter` as a separate path

Replace `SvgExporter` with a method on `MapRenderer` (or a thin wrapper) that:
1. Saves the current `baseBackend`
2. Swaps to a fresh `SvgBackend`
3. Runs `this.pipeline.buildScene(...)` with the export bounds and pre-filtered rooms
4. Renders overlays through the same pipeline
5. Restores the original `baseBackend`
6. Returns the assembled SVG string

The `Exporter<T>` plugin pattern can stay for PNG/Canvas exports where a full context object
makes sense; SVG simply becomes a first-class method.

### Sub-task 8d — Remove `InteractiveBackend` interface

- Delete the `InteractiveBackend` interface from `src/rendering/MapRenderer.ts`
- Remove `src/rendering/KonvaRenderBackend.ts` export from `src/index.ts` if it was exported
- All `this.backend.*` call sites in `MapRenderer` become `this.layerManager.*` or direct
  calls on owned objects

### Verify
- `yarn test` passes.
- `yarn test:visual` — all visual snapshots pass.
- `yarn demo:dev` — interactive rendering works.
- `yarn demo:headless` — headless PNG export works.
- SVG export produces identical output to before.

---

## Step 9 — Rewire `SceneOverlay` and `LiveEffect`

**Files:** `src/overlay/SceneOverlay.ts`, `src/overlay/LiveEffect.ts`,
`src/rendering/MapRenderer.ts`

### SceneOverlay

`SceneOverlayContext.onViewportChange` is currently wired through `KonvaRenderBackend` (via an
`onViewportChange` callback in the overlay context it creates). After Step 8, wire it directly
to `Camera.onChange`:

```ts
// In MapRenderer.addSceneOverlay():
const ctx: SceneOverlayContext = {
    state: this.state,
    onViewportChange: (cb) => {
        // Camera.onChange is a single callback slot — wrap with an event emitter
        // or convert Camera.onChange to a proper event set in this step
        const unsub = this.cameraChangeListeners.add(cb);
        return unsub;
    },
    invalidate: () => this.renderOverlays(),
};
overlay.attach?.(ctx);
```

Consider converting `Camera.onChange?: () => void` to a proper multi-listener pattern
(`Camera.addChangeListener / removeChangeListener`) to support multiple subscribers cleanly.

### LiveEffect

`LiveEffect` currently has `attach(layer: Konva.Layer)` — a hard Konva dependency. In the
new architecture:

1. Change `attach` to receive a `DrawingBackend` and a redraw callback:
   ```ts
   export interface LiveEffect {
       attach(backend: DrawingBackend, requestRedraw: () => void): void;
       updateViewport(bounds: ViewportBounds, scale: number, coordinateTransform: CoordFn): void;
       destroy(): void;
   }
   ```
2. Effects that need a raw Konva layer can cast `backend` to `KonvaBackend` and access the
   layer there — this is an escape hatch, not the primary path.
3. `requestRedraw` is `() => backend.requestRedraw()` (wired by `MapRenderer`).
4. The RAF tick loop lives in `InteractionHandler`. `InteractionHandler` calls
   `effect.updateViewport(camera.getViewportBounds(), camera.getScale(), backend.getTransform())`
   on every camera change.
5. `addLiveEffect` when there is no `InteractionHandler` (SVG/headless): register the effect
   but never call `attach` or `updateViewport` — silent no-op.

### Verify
- `yarn test` passes.
- Demo: `AmbientLightOverlay` (a `LiveEffect`) still works visually.
- SVG export still does not include live effects.

---

## Step 10 — Cleanup

**Files:** `src/index.ts`, `src/rendering/MapRenderer.ts`, `docs/architecture.md`,
`src/HeadlessRenderer.ts`, `src/Renderer.ts`

### What to do

1. Remove from public exports:
   - `InteractiveBackend` type (gone)
   - `KonvaRenderBackend` class (gone or internal)
   - `SvgRenderBackend` / `SvgExporter` if still exported
2. Ensure `HeadlessRenderer` and `Renderer` deprecated wrappers still compile (they delegate to
   `MapRenderer`). If they reference removed internals, update them.
3. Update remaining sections of `docs/architecture.md` — the data flow sequence diagrams,
   component descriptions, and key source files table all reference the old split-path
   architecture.
4. Run `yarn test:visual:update` if any snapshots changed due to rendering path changes, then
   review diffs carefully before committing.
5. Update the demo (`demo/`) if it imports any removed types.

### Verify
- `yarn build` clean.
- `yarn test` passes.
- `yarn test:visual` passes.
- `yarn demo:dev` works.
- `yarn demo:headless` works.

---

## Key invariants to maintain throughout

- **`yarn test` must pass after every step.** Do not proceed to the next step with failing tests.
- **`yarn build` must produce no TypeScript errors after every step.**
- **Visual snapshots** (`yarn test:visual`) are the ground truth for rendering correctness.
  Run them before and after Step 8 especially.
- **The `Style` / `compose` / decorator backend system is untouched.** `BaseStyle` already
  forwards `requestRedraw` (added in Step 2); no other changes needed.
- **`MapData.Room` coordinates** (`room.x`, `room.y`) are always in Cartesian map space.
  The `coordinateTransform` on `DrawingBackend` converts to render space. Hit-testing via
  `CullingManager` already applies this transform correctly — do not add a second transform.
