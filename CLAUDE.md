# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript rendering library for [Mudlet](https://www.mudlet.org/) MUD client map data. Renders interactive, zoomable maps using Konva (canvas), with SVG and PNG export support. Published as an npm package (`mudlet-map-renderer`), ESM-only via Vite.

## Commands

**Always use `yarn`, not `npm`.**

| Task | Command |
|---|---|
| Build (tsc + vite) | `yarn build` |
| Run demo dev server | `yarn demo:dev` |
| Run streaming/big-map demo | `yarn demo:streaming` |
| Run headless demo (Node) | `yarn demo:headless` |
| Run render benchmarks | `yarn bench` |
| Run tests (vitest, once) | `yarn test` |
| Run tests (watch mode) | `yarn test:watch` |
| Run single test file | `yarn vitest run tests/<file>.test.ts` |
| Visual regression tests | `yarn test:visual` |
| Update visual snapshots | `yarn test:visual:update` |
| Review snapshot diffs | `yarn snapshot-review` |

## Architecture

### Core Data Flow

Everything downstream of `ScenePipeline` is engine-agnostic data: `Shape`s in
world space, then `DrawCommand`s in render space. Konva, SVG, and Canvas2D are
all just replay targets for the same command stream.

```
MapReader (parses map data)
    ↓
MapState (pure state + events, no rendering)
    ↓ emits typed events (area, position, highlight, path, etc.)
MapRenderer (facade) → InteractiveBackend (KonvaRenderBackend)
    ↓
ScenePipeline → Shape[] (SceneIR, world space)
    ↓ SceneManager caches the build + a CullIndex over those shapes
    ↓ applyStyleToShapes(shape, style, ctx)  — Style rewrites geometry + paint
    ↓ buildDrawCommands(shapes, camera)      — world → render space
DrawCommand[] → Konva replay | SvgRenderer | CanvasRenderer
```

### Key Components

- **MapRenderer** (`src/rendering/MapRenderer.ts`) — Public facade. Owns MapState and the rendering backend. All API calls mutate MapState, which emits events that drive rendering.
- **MapState** (`src/MapState.ts`) — Pure state + TypedEventEmitter. No rendering logic. Backends subscribe to its events.
- **KonvaRenderBackend** (`src/rendering/KonvaRenderBackend.ts`) — Interactive canvas renderer. Manages Konva.Stage with layers (lod, grid, link+room shared, position, overlay, top). Coordinates Camera, SceneManager, CullingManager, InteractionHandler, LodController.
- **SceneManager** (`src/rendering/SceneManager.ts`) — Owns the ScenePipeline instance, the last `SceneBuildResult`, and the `CullIndex` (built lazily per rebuild). It does *not* apply the Style — the backend does.
- **ScenePipeline** (`src/ScenePipeline.ts`) — Backend-agnostic scene composition. Shared by every render path. Renders: grid → labels → link exits → rooms → area name.
- **Camera** (`src/camera/Camera.ts`) — Transform state (zoom, pan, animations, viewport bounds). No Konva dependency — works headless.
- **HitTester** (`src/hit/HitTester.ts`) — Point → shape lookup using each shape's `hit: HitInfo` annotation.
- **CullingManager** (`src/CullingManager.ts`) — RAF-debounced scheduler that batches camera changes into one cull pass per frame; also holds the world→scene transform. The cull predicate lives in `clipSceneToViewport` (shared by SVG/PNG export, one-shot, linear scan).
- **CullIndex** (`src/render/CullIndex.ts`) — Uniform-grid spatial index over scene-space AABBs (with an oversized-bucket for long exits). Built per scene rebuild by `SceneManager`; powers the interactive cull so panning a 10k-room map is O(visible cells), not O(all rooms). `KonvaRenderBackend.applyClipping` flips only the `DrawEntry.visible` deltas (shapes entering/leaving the viewport). Note: `cullingMode` `basic`/`indexed` are currently identical at runtime — culling is on whenever `cullingEnabled` is true. The SVG/PNG export path and the OffscreenCanvas worker still use the linear scan.
- **OffscreenCanvasBackend** (`src/rendering/offscreen/`, subpath export `./offscreen`) — Alternative backend that renders `DrawCommand`s on a worker-owned OffscreenCanvas instead of Konva nodes. Does not implement LOD.

### SceneIR: Shape and DrawCommand

- **`Shape`** (`src/scene/Shape.ts`) — Pure data the pipeline emits: `rect | circle | line | polygon | text | image | group`, in **world space**, carrying engine-agnostic `Paint` (fill as colour string *or* gradient, stroke, dash, alpha) plus optional `hit: HitInfo` and a `layer: LayerId`.
- **`DrawCommand`** (`src/draw/DrawCommand.ts`) — Flat command stream in **render space** (camera transform already applied), produced by `buildDrawCommands` (`src/draw/DrawCommandBuilder.ts`). Groups become `pushTransform`/`popTransform` stack commands.
- **Replay targets** — `shapeToRecording` + `RecordingLayer` (Konva), `svgFromBatches` (`src/render/SvgRenderer.ts`), `renderToCanvas` (`src/render/CanvasRenderer.ts`).

**Gotcha:** room bodies are emitted as a `group` carrying `hit: {kind: "room", payload: room}`, and exits as a `group` with `layer: "link"`. In both cases the *children* carry neither the hit nor the layer — they inherit from the group. Code that needs to recognise a room body or an exit connector must inspect the **group**, not the leaf shapes.

### Style System

`Style` (`src/style/Style.ts`) is the visual-theme mechanism: an engine-agnostic
`transform(shape, ctx) => Shape | Shape[]`. It never touches a backend, so the
same style drives interactive canvas, SVG, and PNG output identically.

- Most styles return one recoloured shape; some split (Neon emits a glow shape plus the main one, Topographic emits contour rings, Isometric extrudes rects into cube faces).
- Coordinate-warping styles (Isometric) also supply `worldToScene` / `sceneToWorld` / `sceneLayerOffset` so hit-testing and the camera stay aligned.
- `compose(...)` chains styles left → right. Order matters: shape-changing styles must run before styles that depend on the new geometry, and the *last* palette style wins.
- Implementations live in `src/style/shape/` (Parchment, Blueprint, Neon, Sketchy, Isometric, Construction, SciFi, GradientRooms, StainedGlass, GraphPaper, Topographic, Watercolor, DarkModern, TreasureMap, Transit, Circuit, Terminal, PixelArt). `src/style/shape/paintMap.ts` holds the shared colour helpers.
- Apply with `renderer.setStyle(style)`; `clearStyle()` / `identityStyle` turns it off.

**Where the Style actually runs (interactive path):** culling and hit-testing
operate on the **unstyled** scene shapes, projected through the Style's
`worldToScene` / `sceneLayerOffset` rather than through its `transform`. The
`transform` itself runs per shape at render time, in
`KonvaRenderBackend.addStyledShape`. That is why a coordinate-warping Style
(Isometric) must supply the transform pair — moving points inside `transform`
alone would leave clicks and culling looking at the old geometry. Exporters
(`SvgExporter`, `CanvasExporter`) style the whole shape list up front instead.

New styles: add the implementation in `src/style/shape/`, export it from that
directory's `index.ts`, give it a public alias in `src/style/index.ts`, re-export
from `src/index.ts`, then wire a demo mode (`demo/index.html` option +
`demo/main.ts` switch) and tests in `tests/shape-styles.test.ts`.

### Render Paths

All four share `ScenePipeline` → Style → `buildDrawCommands`:

- **Interactive** — `MapRenderer` → `KonvaRenderBackend`, replaying commands onto Konva layers.
- **SVG export** — `renderer.export(new SvgExporter(...))` → `svgFromBatches`.
- **PNG export** — `PngExporter` / `PngBlobExporter` rasterize the *live* Konva stage. `CanvasExporter` / `PngBytesExporter` instead re-render through `renderToCanvas` with an explicit width/height, so they work headless (Node via the `canvas` devDependency, as `demo/headless.ts` does).
- **Offscreen** — worker-side `renderFrame` on an OffscreenCanvas.

### Map Data Model

- **MapReader** (`src/reader/MapReader.ts`) — Main interface to map data, room/area/plane lookups
- **Area** → collection of **Plane**s (z-levels) → collection of rooms
- **Lenses** (`src/lens/`) — Composable per-room filters (`RoomLens`). `ExplorationLens` provides fog-of-war (hides unvisited rooms); `hiddenAwareLens` applies `settings.hiddenRooms`. Compose with `composeLenses`.
- **Overlays** (`src/overlay/`) — `SceneOverlay` adds shapes to every output including exporters (`renderer.addSceneOverlay(id, overlay)`); `LiveEffect` (RippleEffect, WaypointOverlay, AmbientLightOverlay) is interactive-only.

### Big-Map Support (LOD + skeleton reader)

- **LOD raster overview** (`src/rendering/lod/`) — With `settings.lodEnabled`, planes denser than `settings.lodRoomBudget` swap the vector scene for a pixel overview when zoomed out (`shouldUseRaster` in `lodDecision.ts`: zoom-based, pan-invariant). `LodController` paints via `RasterOverview.ts` into a map-space `Konva.Image` on `lodLayer` (bottom of the stage); repaint only on painted-region escape or zoom change. Works for ANY reader; raster mode suppresses the vector scene but keeps position marker/highlights/paths. Reported via the `lod` renderer event. Not implemented for the OffscreenCanvas backend; ignores Style coordinate transforms.
- **SkeletonMapReader** (`src/bigmap/`, subpath export `./bigmap`) — `IMapReader` + `ViewportDataSource` over a `MapSkeleton` (parallel Int32Array columns + sparse detail rooms; RAW map space, reader negates y once at construction, taking ownership of the arrays). Planes materialise only viewport rooms via `PlaneIndex` (uniform-grid counting sort). Producers: `buildSkeleton()` (eager, in-process) or a worker streaming a .dat (`demo/streaming/`, still aliased to the sibling reader repo until `streamRooms` is published).
- **ViewportDataSource** (`src/reader/ViewportDataSource.ts`) — capability interface; `KonvaRenderBackend` detects it and pushes padded (6%+1) camera bounds before every build, rebuilding on pan only when the camera escapes the padding (hysteresis). Engages only once the camera has a real size — a headless 1×1 backend never clamps the reader, so exports stay whole-map unless `setViewport` is called explicitly.

### Settings

`createSettings()` returns a mutable settings object. Modify properties then call
`renderer.refresh()` to apply. Key settings: roomSize, roomShape, culling mode,
emboss, grid, ambient light, player marker style, hiddenRooms, LOD budgets, and
`pixelate` (rasterizes the interactive canvas at a fraction of its normal
resolution with nearest-neighbour upscaling — the one part of the pixel-art look
a Style cannot express, since it is rasterization rather than geometry).

## Testing

- **Vitest** for unit/integration tests (`tests/` directory)
- **Playwright** for visual regression tests (`tests/visual/`)
- Test setup mocks `textMeasure` utility and enables Konva canvas backend
- Test fixtures: `test-map.json`, `test-envs.json`

## Build Output

Vite produces ESM bundles in `dist/`:
- `index.mjs` + `index.d.ts` (main entry)
- Subpath entries: `binary.mjs`, `bigmap.mjs`, `offscreen.mjs` (see `exports` in `package.json`)
- TypeScript strict mode enabled, target ES2021
