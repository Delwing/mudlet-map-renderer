# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[2.0.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/2.0.0
[1.2.2]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.2
[1.2.1]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.1
[1.2.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.2.0
[1.1.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.1.0
[1.0.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.0.0
