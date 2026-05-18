# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.1.0
[1.0.0]: https://github.com/Delwing/mudlet-map-renderer/releases/tag/1.0.0
