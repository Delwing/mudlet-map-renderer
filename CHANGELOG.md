# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Big-map support** — render maps with plane densities far beyond what one Konva scene can hold (proven against a 2.3M-room map, densest plane 1M rooms at one z):
  - **Three-tier LOD** (`Settings.lodEnabled`, default `false`): as a plane's density (or zoom-out) increases past each budget, the interactive backend steps `vector` (rooms + exit lines, full detail) → `roomsOnly` (exit lines dropped, rooms still real vector shapes) → `raster` (pixel overview, one filled box per room, painted on a new bottom-most `lodLayer`). Every switch is zoom-based and pan-invariant (no mid-pan mode flips); zooming in steps back toward full detail. Position marker, highlights, paths and scene overlays stay visible in every tier, and the raster overview composites into `exportCanvas()`/PNG. Each decision is reported through the new `lod` renderer event (`{mode: 'vector' | 'roomsOnly' | 'raster', planeRoomCount, visibleEstimate, hitTestActive}`). Works with any `IMapReader`. Not yet supported by the OffscreenCanvas backend; decorator styles with coordinate transforms are not applied to the raster.
  - **`Settings.lodRoomBudget`** (default `16000`): max rooms before the plane switches to `raster`.
  - **`Settings.lodExitBudget`** (default `12000`, must be ≤ `lodRoomBudget`): above this many rooms, exit lines are dropped (the `roomsOnly` tier) — exit pairing and exit-line shape building are typically the single largest share of a dense rebuild's cost (exit count often runs ~2x room count in a well-connected area), so this tier buys back most of that cost while still showing real room geometry instead of raster pixels. Set above `lodRoomBudget` (or `Infinity`) to disable the tier.
  - **`Settings.lodHitTestBudget`** (default `10000`, same unit as the room budgets): above this many rooms in a vector or roomsOnly build, the hit-test index is skipped instead of rebuilt every time — clicks/hover stop resolving to a room in that density band, but the scene keeps rendering at full vector detail. Rebuilding the hit index is a real fraction of a large rebuild's cost, and precise pointer interaction rarely matters that zoomed out.
  - **Rebuild-on-pan padding is deliberately generous** (50% of the viewport per side, not just enough to cover edge-room popping): panning inside the padded region is free (existing culling handles it), so a bigger pad buys much more pan distance between rebuilds — verified ~8.7x fewer rebuilds while panning at the same worst-case per-rebuild cost. Every LOD decision divides its effective budget by the padding's area inflation so each tier's flip point retreats to compensate, keeping the actual materialised room count pinned near its configured budget regardless of pad size, instead of silently overshooting it. A zoom change of more than ±20% since the last materialisation also forces a re-narrowing even with no pan, so `visibleEstimate` and the hit-test/exit decisions track the current zoom instead of staying stuck at a stale, much-wider room count after a pure zoom-in.
  - **`SkeletonMapReader`** (new `mudlet-map-renderer/bigmap` subpath): an `IMapReader` over a compact typed-array `MapSkeleton` (parallel `Int32Array` columns + sparse full-detail rooms) instead of a room object graph. Planes materialise only the rooms inside the current viewport via a uniform-grid `PlaneIndex`. `buildSkeleton(mapData, colors)` covers maps that parse fine but render slowly; out-of-process producers (e.g. a Web Worker streaming a `.dat`, see `demo/streaming/`) can transfer the arrays zero-copy. `MapSkeleton` is raw Mudlet map space — the reader converts to renderer space once at construction. Link-exit pairing (`pairLinkExits`, extracted from and still used by `Area` itself) runs directly over a room list instead of constructing a throwaway `Area`/`Plane` — also what powers the `roomsOnly` tier's `withoutLinkExits(area)` wrapper, which skips exit pairing entirely.
  - **`ViewportDataSource`** capability interface (exported, with `isViewportDataSource`): the interactive backend detects viewport-aware readers, pushes padded camera bounds before every scene build, and rebuilds on pan (or material zoom change) only when the camera escapes the padding. Engages once the camera has a real size, so headless renderers never clamp exports implicitly.
  - New exports from the main entry: `ViewportDataSource`, `isViewportDataSource`, `shouldUseRaster`, `computeLodMode`, `LodDecisionInput`, `LodModeInput`, `LodMode`, `LodEventDetail`. The streaming demo (`yarn demo:streaming`) now runs entirely on these core APIs, with an LOD budget metrics panel (vector/exits/hit-test bars); the regular demo gains an LOD toggle.
  - Measured on a 122500-room synthetic grid: a full rebuild right at the 16000-room raster flip (the original worst case) dropped from ~900ms-1.2s to ~580-620ms via the padding/hit-test fixes, and down to ~130-170ms once the `roomsOnly` tier covers that density band instead. Typical rebuild-on-pan frequency dropped ~8.7x from the wider padding.

## [2.5.0] - 2026-06-20

### Changed

- Upgraded the optional `mudlet-map-binary-reader` peer dependency to `>=1.0.0` (now `1.0.1`), which migrated its Qt serialization to the browser-safe `qtdatastream-web` package. `BinaryMapReader.fromBuffer()` now accepts any `Uint8Array` and parses **and** exports map data with no dependency on Node's `Buffer`, so it runs unchanged in the browser. This is backward compatible: a Node `Buffer` is a `Uint8Array` subclass and still works, so existing `fromBuffer(fs.readFileSync(path))` callers are unaffected.

### Removed

- The browser shim for `qtdatastream` (`demo/qtdatastream-browser.js`) and the Vite aliases that wired it in (`vite.config.ts`, `vite.demo.config.ts`), plus the `Buffer` polyfill in the demo's dropped-`.dat` loader — all obsolete now that the binary reader is browser-safe.

## [2.4.0] - 2026-06-20

### Added

- **Hidden rooms & per-room border styling**, both driven by Mudlet `userData`:
  - `Settings.hiddenRooms` controls how Mudlet-hidden rooms (the `system.fallback_hidden` userData key, used as a fallback where the v21+ binary `hidden` field isn't surfaced) are drawn: `"hide"` (default — drops the room **and** any exit touching it), `"show"`, `"faded"` (reduced opacity), or `"dashed"` (full opacity with a dashed border — a more distinct marker than a fade). Hidden rooms fold into the active lens (`isVisible` / `getExitTreatment`), so the scene build, culling, and the current-room overlay all hide them and their exits consistently.
  - Per-room **border colour & thickness** via the `room.ui_borderColor` / `room.ui_borderThickness` userData keys: they override the room's stroke, draw even when global borders are off, survive emboss, and accept Mudlet's Qt `#AARRGGBB` colour strings (converted to CSS).
  - New public exports: `isRoomHidden`, `getRoomBorderColor`, `getRoomBorderThickness`, the `ROOM_UI_HIDDEN` / `ROOM_UI_BORDER_COLOR` / `ROOM_UI_BORDER_THICKNESS` key constants, and the `HiddenRoomMode` type. The demo gains a "Hidden rooms" mode selector.
- Optional **neighbouring-area spill**: when enabled, rooms from adjacent areas that are reachable within a step budget of the player's room are drawn across the boundary, projected into the current area's coordinate space. Because areas use independent coordinates, the projection BFS advances by real coordinate deltas within an area and anchors a 2-unit gap along the crossing exit's planar direction at the boundary (a visible seam). The BFS follows **special exits** as well as regular exits, so rooms reachable only via a special exit still appear (boundaries are crossed only via a planar regular exit, which is the only thing that gives an anchor direction). Only **visible** rooms (lens / fog-of-war) are spilled. Spilled rooms are **cloned into the current frame** (coordinates *and* custom-line points offset by the same delta) and rendered through the **normal room pass** — so their bodies, custom lines, stubs and inner exits all use the same drawing logic, they participate in culling, and they stay clickable (clicks navigate to the real room). Their plain regular/special exits are drawn as connector lines (custom-line exits are skipped there since the room pass already draws them as polylines). Cross-area arrows/labels for crossings *into* spilled rooms are suppressed (main pass, room-level special/inner exits, and the current-room highlight overlay) so the crossing reads as an ordinary connection, and spilled rooms don't sprout their own area-exit arrows. **Highlights and paths** on spilled rooms are drawn at their projected positions via a `ProjectedMapReader` that presents them as current-area rooms to the overlay code. Configured by `neighborSpill` (default `false`) and `neighborSpillDistance` (default `20`). New public exports: `computeNeighborSpill`, `projectRoom`, `spillPositionMap`, `ProjectedMapReader` (plus `NeighborSpill`, `ProjectedRoom`, `ProjectedEdge` types). The demo gains a "Neighbour area spill" toggle and a spill-distance slider. Controlled by three new `Settings`: `neighborSpill` (default `false`), `neighborSpillDistance` (default `20`), and `neighborSpillAlpha` (default `1` — render like ordinary rooms; set below `1` to fade). The spill is recomputed as the player moves so it tracks proximity to boundaries, and appears immediately on crossing a boundary. New public exports: `computeNeighborSpill`, `spillPositionMap`, `ProjectedMapReader` (plus `NeighborSpill`, `ProjectedRoom`, `ProjectedEdge` types). The demo gains a "Neighbour area spill" toggle and a spill-distance slider.

## [2.3.1] - 2026-06-03

### Fixed

- `WaypointOverlay` and its `Waypoint` type are now actually exported from the package (`import { WaypointOverlay } from "mudlet-map-renderer"`). In 2.3.0 the overlay lived only in the demo, so the feature was unreachable by consumers; it has been moved into `src/overlay/` and re-exported from the public entry point, with declarations emitted to `dist/index.d.ts`.

## [2.3.0] - 2026-06-03

### Added

- Clickable waypoints in the demo's `WaypointOverlay` example. The `Waypoint` interface gains an optional `onClick?: (waypoint) => void` callback, and the overlay exposes `hitTest(worldX, worldY)` to resolve a world-space point to the topmost bubble (waypoint bubbles are overlay-layer shapes, so they aren't part of the renderer's `HitTester` — the overlay records the rects it places and tests them itself). The demo wires pointer clicks to it by converting the cursor to world space via `renderer.camera.clientToMapPoint(...)`, and shows a pointer cursor on hover over a clickable bubble.

### Removed

- Waypoint placement-debug visualisation (candidate-slot boxes, per-slot clearance scores, and the console log) from the demo's `WaypointOverlay`, along with its "Waypoint debug (slot scores)" toggle.

## [2.2.0] - 2026-06-02

### Added

- Four new shape styles, each a target-agnostic `Style` that drives the interactive canvas, SVG export, and PNG/Canvas export identically:
  - `StainedGlass` — jewel-toned panes (fills pushed to high saturation in a mid-lightness window) framed by fat near-black "leading". Filled rooms get leading even when the source had no stroke; grey rooms stay neutral (frosted). Exit lines become slim leading.
  - `Watercolor(options?)` — each filled room becomes a stack of translucent, edge-wobbled washes (seeded, so re-renders are identical) that bleed and pool where they overlap; no crisp outline. Options: `bleed`, `layers` (1..4), `alpha`. Hit info rides only the first wash to avoid duplicate pick zones.
  - `GraphPaper` — old-school D&D look: fills mapped to a pale slate-blue → near-white range by luminance, fattened navy ink outlines, navy exits/text. Grid lines stay thin. Pair with a light background and blue grid.
  - `Topographic` — earthy elevation palette (mossy green → pale tan by luminance) plus concentric inset contour rings inside each room, so rooms read like hills on a relief map.
- New shared HSL helpers `rgbToHsl` / `hslToRgbString` in the style paint utilities (used by the new styles; Neon and SciFi keep their local copies).
- Demo render-mode dropdown gains Stained Glass, Watercolor, Graph-Paper Dungeon, and Topographic entries, each with a matching background / grid / font preset.
- Opt-in **OffscreenCanvas (Web Worker) rendering backend**, exposed from a new `mudlet-map-renderer/offscreen` entry point via `createOffscreenBackend(container)`. Pass it to `MapRenderer`'s existing `backendFactory` parameter to move the per-frame hot path (cull → draw-command build → rasterise) into a Web Worker, keeping the main thread responsive during pan/zoom on large maps. The default Konva backend is unchanged. The scene build, hit-testing (`hitTest`/`pick`), `getDrawnExits`/`getDrawnSpecialExits`/`getDrawnStubs`, and `coordinateTransform` stay on the main thread and remain synchronous. The worker is bundled inline (self-contained Blob URL), so no extra asset or bundler configuration is needed by consumers.
  - Renders the full scene, all visual styles, culling, the position marker, highlights, paths, the current-room overlay, scene overlays, image labels (`labelRenderMode: "image"`), and the ambient-light overlay — image `src`s are decoded in the worker via `createImageBitmap`.
  - Live effects (`addLiveEffect`) are supported on this backend too: they run on a main-thread Konva overlay stage composited above the worker canvas (Konva animations can't run in a worker), while the map itself still rasterises off-thread.
  - The single limitation: `MapRenderer.exportCanvas()` returns `undefined` with this backend (the live canvas is owned by the worker). Use the headless `CanvasExporter` / `PngBytesExporter` exporters (they rebuild from state), or the backend's async `captureViewport()`.
- `InteractiveBackend` gains optional `addLiveEffect?` / `removeLiveEffect?` methods; `MapRenderer` now routes these by capability instead of an `instanceof KonvaRenderBackend` check, so any backend that implements them participates. Backward compatible — the methods are optional and the default Konva path is unchanged.
- Benchmark harness (`yarn bench`) that renders a generated single-area grid map and measures main-thread stall under continuous panning, with a Konva-vs-Offscreen A/B toggle, plus a headless runner (`node bench/measure.mjs`).

## [2.1.0] - 2026-05-31

### Added

- Multi-colour room highlights. `MapRenderer.renderHighlight(roomId, color)` now accepts either a single colour (unchanged) or an array of colours; with two or more, the highlight is split into that many equal pie wedges, one colour each. Works for circle and rectangular highlights and across the interactive, SVG, and canvas/PNG render paths. `HighlightEntry` gains `colors: string[]` (its `color` field is retained, see Deprecated), and the export overlay `highlights[].color` accepts `string | string[]`.
- `HighlightStyle.shape` selects the highlight outline shape independently of the room: `'match'` (default when omitted — follows `roomShape`), `'rectangle'`, `'roundedRectangle'`, or `'circle'`. Exposed as a "Shape" dropdown in the demo's Highlight panel (replacing the match-room-shape checkbox).

### Deprecated

- `HighlightEntry.color` and the `'highlight'` event's `color` field — use `colors` instead. Both are still populated (`color === colors[0]`) so existing readers keep working.
- `HighlightStyle.matchRoomShape` — use `HighlightStyle.shape` instead. Still honoured when `shape` is `'match'` or omitted (defaults to `true`).

### Fixed

- Dashed highlights drawn as line segments — rectangular / "match room shape" highlights and the new multi-colour pie wedges — ignored the `dashEnabled` toggle on the interactive Konva canvas (circle highlights honoured it). All shape kinds now route their dash through a shared `resolveDash` helper, so toggling the dash off applies to every highlight shape.
- `'roundedRectangle'` highlights rendered as sharp rectangles: the stroked ring was built from four straight corner-aligned line segments, so the corner radius (applied only to the optional fill) was invisible on the usual hollow highlight. Rounded highlights now emit a single rounded rect for the stroke, so the radius shows. Multi-colour rounded highlights trace their pie wedges along the rounded-rect perimeter too (flat edges with quarter-circle corners).

## [2.0.0] - 2026-05-23

### Added

- Gradient fills for shapes: `Paint.fill` accepts `LinearGradient` or `RadialGradient` in addition to a colour string. New types `FillStyle`, `LinearGradient`, `RadialGradient`, `GradientStop` and helpers `isGradientFill`, `transformFill` exported from the package root.
- `GradientRooms(options)` shape style — replaces flat room fills with a vertical linear gradient (lighter top, darker bottom). Composes with palette styles; downstream styles recolour the gradient stops, preserving the gradient through palette swaps.
- Gradient rendering across all output targets: interactive Konva canvas, SVG export, and PNG/Canvas export.

### Changed

- **Breaking:** `Paint.fill` is now `FillStyle | undefined` (`= string | LinearGradient | RadialGradient | undefined`). Producers that only assign colour strings are unaffected. Custom `Style.transform` / `SceneOverlay.render` / backend code that *reads* `paint.fill` must narrow with `isGradientFill(paint.fill)` before treating it as a string.
- `IsometricStyle` now projects gradient endpoints (linear) and centres (radial) through the iso transform, so gradient fills follow the projected polygon geometry instead of sampling from world-space coords. Shapes with flat colour fills render byte-identically.

### Fixed

- Multi-shape style outputs (Isometric with `depth > 0` fans one rect into top + side faces + edges) no longer leak Konva nodes on re-render. `KonvaRenderBackend.addStyledShape` now wraps the whole expansion into one `RecordingGroupNode`, so the cached handle used by the position marker, scene overlays, highlights, current-room overlay, and paths covers every emitted node. Also fixes a latent culling bug where iso side faces stayed visible after culling toggled the top face.

## [1.2.2] - 2026-05-23

### Fixed

- Position marker no longer renders on the wrong area's canvas after `drawArea` switches to an area or z-level that does not contain the player room. `KonvaRenderBackend.applyPositionMarker` now applies the same area/z guard that `MapState.getOverlaysForArea` uses for the export path; `MapState.positionRoomId` is preserved, so switching back to the player's area/z re-draws the marker automatically.

## [1.2.1] - 2026-05-19

### Fixed

- Surrounding rooms in the current-room overlay no longer drop their inner-exit triangles (up/down/in/out). They were being added to the position layer as standalone shapes, but their vertices are room-local, so they rendered far off-position; they are now appended as children of the overlay room group.
- Path-overlay inner-exit markers now align with the regular inner-exit triangles. Both call sites share `computeInnerExitTrianglesForDirection`, so a "go up" path marker draws on top of the room's regular up-arrow triangle (and `in`/`out` markers emit both west+east triangles).

## [1.2.0] - 2026-05-19

### Added

- `Camera.batch(fn)` groups multiple camera mutations into a single `change` event, preventing subscribers from observing transient intermediate state. Nested batches are supported; only the outermost batch emits.

### Changed

- `InteractionHandler` resize logic now wraps its size update and re-centering in `Camera.batch`, so resizes produce one consolidated change notification instead of two.

## [1.1.0] - 2026-05-12

### Added

- `IMapReader` interface so renderers accept any reader implementation; `MapReader` is now one concrete option among several.
- `BinaryMapReader` for parsing Mudlet binary map data, with optional peer dependency on `mudlet-map-binary-reader`.
- Visibility lens system: `RoomLens`, `ExitTreatment`, `ExplorationLens`, and `composeLenses` for filtering what the renderer paints. Replaces the `ExplorationArea` decorator with a composable abstraction.
- Public `IArea`, `IPlane`, `IExit`, and `ExitKind` interfaces for working with map data without depending on internal classes.
- `HighlightStyle` settings block (`settings.highlight`) — configurable `strokeAlpha`, `fillAlpha`, `strokeWidth`, `sizeFactor`, `dash`, `dashEnabled`, and `matchRoomShape` for room highlights.
- Filled highlights via `highlight.fillAlpha > 0`; rectangular highlights render the fill beneath the dashed sides so corners stay crisp.
- `hexToRgba` now accepts short hex (`#rgb`), `rgb(...)` / `rgba(...)`, and common CSS named colours in addition to `#rrggbb`.

### Changed

- `HighlightData` shape: `stroke` renamed to `strokeColor`; new fields `strokeAlpha`, `fillColor`, `fillAlpha`, `dashEnabled`; `dash` is now optional.
- `Settings` now includes a `highlight: HighlightStyle` block — use `createSettings()` for defaults.
- Highlight strokes are serialised through `hexToRgba`, so they appear as `rgba(...)` in SVG output rather than the raw input string.

### Removed

- `ExplorationArea` decorator — use `ExplorationLens` composed via `composeLenses` instead.
- `KonvaRenderBackend` public export — construct renderers via `MapRenderer`.

## [1.0.0] - 2026-04-29

Initial public release.

### Added

- Interactive map renderer (`MapRenderer`) for Mudlet map data, built on Konva canvas with zoom, pan, and viewport animations.
- `MapReader` for parsing Mudlet JSON map data with area, plane, and room lookups.
- `ExplorationArea` decorator providing fog-of-war for unvisited rooms.
- Pure `MapState` + typed event emitter, decoupling state mutations from rendering backends.
- `ScenePipeline` for backend-agnostic scene composition shared by canvas and SVG render paths.
- `DrawingBackend` abstraction with `KonvaBackend` (interactive canvas) and `SvgBackend` (string output) implementations.
- Visual style decorator backends: `SketchyBackend`, `ParchmentBackend`, `BlueprintBackend`, `NeonBackend`, `IsometricBackend`, plus `Construction` and `Sci-Fi` styles.
- SVG export via `MapRenderer.exportSvg()` and headless PNG export through the `canvas` package.
- `CullingManager` with `none` / `basic` / `indexed` modes for viewport-based visibility culling.
- Configurable settings via `createSettings()` — room size and shape, grid, emboss, ambient light, player marker styling, background color, and more.
- `SceneOverlay` API and `LiveEffect` for interactive-only animated effects.
- `HitTester` and `hitTest()` on the renderer facade; `renderedToMapPoint` for inverse coordinate transforms.
- Support for stub exits, special exits, and link exits with custom rendering.
- Published as dual-format ESM + CJS npm package with TypeScript declarations.

[2.4.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.4.0
[2.3.1]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.3.1
[2.3.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.3.0
[2.2.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.2.0
[2.1.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.1.0
[2.0.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.0.0
[1.2.2]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.2
[1.2.1]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.1
[1.2.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.0
[1.1.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.1.0
[1.0.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.0.0
