# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript rendering library for [Mudlet](https://www.mudlet.org/) MUD client map data. Renders interactive, zoomable maps using Konva (canvas), with SVG and PNG export support. Published as an npm package (`mudlet-map-renderer`), dual-format ESM + CJS via Vite.

## Commands

**Always use `yarn`, not `npm`.**

| Task | Command |
|---|---|
| Build (tsc + vite) | `yarn build` |
| Run demo dev server | `yarn demo:dev` |
| Run headless demo | `yarn demo:headless` |
| Run tests (vitest, once) | `yarn test` |
| Run tests (watch mode) | `yarn test:watch` |
| Run single test file | `yarn vitest run tests/<file>.test.ts` |
| Visual regression tests | `yarn test:visual` |
| Update visual snapshots | `yarn test:visual:update` |

## Architecture

### Core Data Flow

```
MapReader (parses map data)
    ↓
MapState (pure state + events, no rendering)
    ↓ emits typed events (area, position, highlight, path, etc.)
MapRenderer (facade) → InteractiveBackend (KonvaRenderBackend)
                      → ScenePipeline → DrawingBackend
```

### Key Components

- **MapRenderer** (`src/rendering/MapRenderer.ts`) — Public facade. Owns MapState and the rendering backend. All API calls mutate MapState, which emits events that drive rendering.
- **MapState** (`src/MapState.ts`) — Pure state + TypedEventEmitter. No rendering logic. Backends subscribe to its events.
- **KonvaRenderBackend** (`src/rendering/KonvaRenderBackend.ts`) — Interactive canvas renderer. Manages Konva.Stage with layers (grid, link, room, overlay, position). Coordinates Viewport, CullingManager, InteractionHandler.
- **ScenePipeline** (`src/ScenePipeline.ts`) — Backend-agnostic scene composition. Shared by both Konva and SVG render paths. Renders: grid → labels → link exits → rooms → area name.
- **Viewport** (`src/Viewport.ts`) — Transform state (zoom, pan, animations). No Konva dependency — works headless.
- **CullingManager** (`src/CullingManager.ts`) — RAF-debounced scheduler that batches camera changes into one cull pass per frame; also holds the world→scene transform. The cull predicate lives in `clipSceneToViewport` (shared by SVG/PNG export, one-shot, linear scan).
- **CullIndex** (`src/render/CullIndex.ts`) — Uniform-grid spatial index over scene-space AABBs (with an oversized-bucket for long exits). Built per scene rebuild by `SceneManager`; powers the interactive cull so panning a 10k-room map is O(visible cells), not O(all rooms). `KonvaRenderBackend.applyClipping` flips only the `DrawEntry.visible` deltas (shapes entering/leaving the viewport). Note: `cullingMode` `basic`/`indexed` are currently identical at runtime — culling is on whenever `cullingEnabled` is true. The SVG/PNG export path and the OffscreenCanvas worker still use the linear scan.

### Big-Map Support (LOD + skeleton reader)

- **LOD raster overview** (`src/rendering/lod/`) — With `settings.lodEnabled`, planes denser than `settings.lodRoomBudget` swap the vector scene for a pixel overview when zoomed out (`shouldUseRaster` in `lodDecision.ts`: zoom-based, pan-invariant). `LodController` paints via `RasterOverview.ts` into a map-space `Konva.Image` on `lodLayer` (bottom of the stage); repaint only on painted-region escape or zoom change. Works for ANY reader; raster mode suppresses the vector scene but keeps position marker/highlights/paths. Reported via the `lod` renderer event. Not implemented for the OffscreenCanvas backend; ignores Style coordinate transforms.
- **SkeletonMapReader** (`src/bigmap/`, subpath export `./bigmap`) — `IMapReader` + `ViewportDataSource` over a `MapSkeleton` (parallel Int32Array columns + sparse detail rooms; RAW map space, reader negates y once at construction, taking ownership of the arrays). Planes materialise only viewport rooms via `PlaneIndex` (uniform-grid counting sort). Producers: `buildSkeleton()` (eager, in-process) or a worker streaming a .dat (`demo/streaming/`, still aliased to the sibling reader repo until `streamRooms` is published).
- **ViewportDataSource** (`src/reader/ViewportDataSource.ts`) — capability interface; `KonvaRenderBackend` detects it and pushes padded (6%+1) camera bounds before every build, rebuilding on pan only when the camera escapes the padding (hysteresis). Engages only once the camera has a real size — a headless 1×1 backend never clamps the reader, so exports stay whole-map unless `setViewport` is called explicitly.

### DrawingBackend System

`DrawingBackend` (`src/backend/DrawingBackend.ts`) is the abstract rendering interface. Implementations:

- **KonvaBackend** — Canvas rendering via Konva nodes
- **SvgBackend** — SVG string output
- **Decorator backends** that wrap KonvaBackend for visual styles: SketchyBackend (hand-drawn), ParchmentBackend, BlueprintBackend, NeonBackend, IsometricBackend

### Render Paths

- **Interactive**: MapRenderer → KonvaRenderBackend → ScenePipeline → KonvaBackend (or decorator)
- **SVG export**: MapRenderer.exportSvg() → SvgRenderBackend → ScenePipeline → SvgBackend
- **PNG export**: Headless rendering via `canvas` package (Node.js)

### Map Data Model

- **MapReader** (`src/reader/MapReader.ts`) — Main interface to map data, room/area/plane lookups
- **Area** → collection of **Plane**s (z-levels) → collection of rooms
- **ExplorationArea** — Decorator for fog-of-war (hides unvisited rooms)

### Settings

`createSettings()` returns a mutable settings object. Modify properties then call `renderer.refresh()` to apply. Key settings: roomSize, roomShape, culling mode, emboss, grid, ambient light, player marker style.

## Testing

- **Vitest** for unit/integration tests (`tests/` directory)
- **Playwright** for visual regression tests (`tests/visual/`)
- Test setup mocks `textMeasure` utility and enables Konva canvas backend
- Test fixtures: `test-map.json`, `test-envs.json`

## Build Output

Vite produces dual bundles in `dist/`:
- `index.mjs` (ESM) + `index.cjs` (CJS) + `index.d.ts` (types)
- TypeScript strict mode enabled, target ES2021
