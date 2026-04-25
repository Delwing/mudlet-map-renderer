# Implementation Plan: Unified Renderer Architecture

## Current state

Steps 1–7 from the refactor doc are done (Camera lifted to MapRenderer, CullingManager lifted,
overlays in MapRenderer, KonvaLayerManager as thin layer manager). The gaps are in steps 8–10.

---

## Phase 1 — `DrawCommand[]` as the shared intermediate (foundation)

**Goal**: `CanvasBackend`'s `DrawCommand` becomes the universal intermediate that any output
format can replay. This is the prerequisite for everything else.

**Changes:**

- Export `DrawCommand` type (and sub-types) from `src/backend/CanvasBackend.ts`
- Add `src?: string` to `ImageCommand` (SVG replay needs the URL, not the loaded element)
- Add `SceneLayerNode` to `src/backend/SvgBackend.ts`:
  - Stores `RecordingGroupNode[]` (accepts `GroupNode`, ignores non-recording nodes)
  - `toSvg(): string` — replays each group's `DrawCommand[]` as SVG elements
  - Implements `LayerNode` (batchDraw is a no-op)
- Add `drawCommandToSvg(cmd: DrawCommand): string` (internal helper, mirrors `SvgBackend.add*` logic)

**Verify:** `yarn build` clean, `yarn test` passes (no behavior change yet).

---

## Phase 2 — `SvgRenderingBackend` as a proper `RenderingBackend`

**Goal**: SVG export attaches to `MapRenderer` the same way `KonvaLayerManager` does.

**Changes to `src/rendering/SvgRenderingBackend.ts`** (full rewrite):

- Constructor: `(renderer: MapRenderer, camera: Camera, style?: Style)`
- `drawingBackend`: `style(new CanvasBackend())` — same backend type as Konva path
- `coordinateTransform`: from `drawingBackend.getTransform()`
- All 6 layers are `SceneLayerNode` instances
- `readonly camera: Camera` — exposed on interface for camera-matching logic
- Calls `renderer._attachBackend(this)` in constructor
- `onCameraChanged / onPositionChanged / animatePanTo / setStyle / updateBackground`: no-ops (static export)
- `onSceneOverlayAdded(id, overlay)`: renders overlay to `overlayLayer`
- `toSvg(viewBounds?)`: assembles and returns the SVG string from all layers
- `destroy()`: calls `renderer._detachBackend(this)`
- `getDrawnExits / getDrawnSpecialExits / getDrawnStubs`: return `[]`
- `toCanvas / exportCanvas`: return `undefined`

**Add optional `camera?: Camera` to `RenderingBackend` interface** in `MapRenderer.ts`.

**Verify:** `yarn build` clean. (Tests will fail until Phase 3.)

---

## Phase 3 — Multi-backend `MapRenderer`

**Goal**: `MapRenderer` holds a `Set<RenderingBackend>` instead of one. Backends with the same
camera share one scene build (via `BroadcastLayerNode`); backends with different cameras get a
separate build.

**Changes to `src/rendering/MapRenderer.ts`:**

- `private backends = new Set<RenderingBackend>()` + `private primaryBackend?: RenderingBackend`
  (replaces `private backend?`)
- Add local `BroadcastLayerNode implements LayerNode` — forwards `addNode` to N layers
  simultaneously (enables shared `RecordingGroupNode[]`)
- `_attachBackend(backend)`:
  - First backend → set as primary, wire camera listener + state listeners
  - Additional backends → build scene immediately (same-camera backends share nodes via
    `BroadcastLayerNode`; different-camera backends get a separate build)
  - Forward already-registered overlays
- `_detachBackend(backend)`:
  - Remove from set
  - If was primary: reassign or teardown listeners, restore pipeline to `CanvasBackend`
- `_buildScene()`:
  - Partition into same-camera and different-camera backends
  - Same-camera group: ONE pipeline build with `BroadcastLayerNode` (shared `DrawCommand[]`)
  - Different-camera group: one separate build per backend
  - Culling updated from primary result only
  - Grid rendered per-backend with correct pipeline backend set
  - All backends notified
- Camera listener: loop over all backends (grid + `onCameraChanged` per backend, sharing groups
  where cameras match)
- Overlay sync (`_syncHighlights`, `_syncPaths`, `_syncPosition`): loop over all backends
- `events` getter, `setStyle`, `updateBackground`: delegate to primary backend
- `getDrawnExits / getDrawnSpecialExits / getDrawnStubs`: from `lastBuildResult` (primary)

**Verify:** `yarn test` passes. `yarn build` clean.

---

## Phase 4 — `KonvaLayerManager` camera parameter

**Goal**: match the architecture doc examples `KonvaLayerManager(container, renderer, camera)`.

**Changes to `src/rendering/KonvaLayerManager.ts`:**

- Constructor: `(container: HTMLDivElement | undefined, renderer: MapRenderer, camera?: Camera)`
- `readonly camera: Camera = camera ?? renderer.camera`
- Change `private readonly camera` → `readonly camera` (satisfies `RenderingBackend.camera?`)

**Verify:** `yarn test` passes.

---

## Phase 5 — `SvgExporter` uses `SvgRenderingBackend`

**Goal**: remove the backend-swap approach; SVG export goes through the unified path.

**Changes to `src/export/SvgExporter.ts`:**

- Compute export `Camera` from `state.computeExportBounds(...)`:
  ```ts
  const exportCam = new Camera(bounds.w, bounds.h);
  exportCam.position = { x: -bounds.x, y: -bounds.y };
  ```
- Create `new SvgRenderingBackend(renderer, exportCam, style)` → attaches → scene builds into
  `SceneLayerNode`s
- Render `options.overlays` (custom highlights/paths/position) using `svgBackend.drawingBackend`
  → `svgBackend.overlayLayer.addNode(...)`
- Render `sceneOverlays` the same way
- Call `svgBackend.toSvg({ viewBounds: bounds })` to get the SVG string
- `svgBackend.destroy()` — detaches from renderer

**Verify:** `yarn test` passes (SVG snapshot tests). `yarn test:visual` passes.

---

## Phase 6 — Cleanup

- Remove `SvgRenderingBackend.applyCulling()` (replaced by camera-based `toSvg`)
- Remove the old `SvgRenderingBackend` constructor signature (already done in Phase 2)
- Update `src/index.ts` exports if any types were removed/renamed
- Update `docs/architecture.md` note about hit-testing (hit-testing is via
  `Camera + CullingManager`, not `SceneBuildResult`)
- Run `yarn test:visual:update` if snapshot diffs are expected
- Run `yarn demo:dev` and `yarn demo:headless` smoke-check

---

## Key invariants throughout

- `yarn test` must pass after each phase
- `yarn build` must be type-error-free after each phase
- `BroadcastLayerNode` is not exported — internal `MapRenderer` implementation detail
