# Architecture Refactor Plan

This document outlines an incremental refactoring of the mudlet-map-renderer library.
Each phase is self-contained: the library stays functional and publishable after every phase.

---

## Current State

| File | Lines | Responsibility |
|------|------:|----------------|
| Renderer.ts | ~2330 | Everything: layers, rooms, exits, symbols, grid, culling, hit detection, zoom/pan, events, positions, highlights, labels, animations |
| CanvasExporter.ts | ~650 | Canvas2D export (duplicates room/exit/grid drawing logic) |
| ExitRenderer.ts | ~560 | Exit geometry & drawing (already extracted) |
| SvgExporter.ts | ~540 | SVG export (duplicates room/exit/grid drawing logic) |
| PathFinder.ts | ~280 | Graph construction + pathfinding algorithms |
| PathRenderer.ts | ~130 | Path overlay drawing |
| HeadlessRenderer.ts | ~160 | Server-side thin wrapper |
| AreaMapRenderer.ts | ~1700 | Area-level meta-map (standalone, out of scope) |

### Key problems

1. **Renderer.ts is a monolith** — 2300+ lines, 6-7 responsibilities, hard to test or modify in isolation.
2. **Duplicated rendering logic** — Room shapes, colors, exits, emboss are implemented independently in Renderer (Konva), SvgExporter (SVG strings), and CanvasExporter (Canvas2D). Visual bugs require triple fixes.
3. **No rendering abstraction** — Code directly creates Konva nodes / SVG strings / Canvas2D calls. No shared "what to draw" layer.
4. **Mutable settings with no change contract** — Consumers mutate settings and hope the right things re-render.
5. **Raw DOM events** — No type-safe event API; easy to typo event names with no compiler help.
6. **No dirty tracking** — Every interaction either does a full redraw or carefully avoids one via ad-hoc paths.

---

## Phase 1 — Break Up Renderer.ts

**Goal:** Split the monolith into focused classes without changing any public API or rendering behavior.

This is pure mechanical extraction — move methods and their state into new files, wire them back through the Renderer orchestrator.

### 1.1 Extract ViewportManager

New file: `src/ViewportManager.ts`

Moves out of Renderer:
- Zoom state and logic (`currentZoom`, `zoomToFit`, `zoomToRoom`, zoom wheel handler)
- Pan state (stage drag config, `panTo`, `centerOnRoom`)
- Coordinate transforms (`clientToMapPoint`, `mapToClientPoint`, viewport bounds calculation)
- `pan` and `zoom` event dispatch

Renderer keeps a `viewport: ViewportManager` and delegates.

### 1.2 Extract RoomRenderer

New file: `src/RoomRenderer.ts`

Moves out of Renderer:
- `renderRooms()` and all sub-methods
- Room shape creation (rect, circle, rounded rect)
- Symbol rendering (`renderSymbol`)
- Emboss effect rendering
- Stub rendering
- Inner exit rendering (up/down/in/out triangles)
- Room color computation (normal, frame, colored modes)

Interface: receives a room + settings + target layer, returns a Konva.Group.

### 1.3 Extract GridRenderer

New file: `src/GridRenderer.ts`

Moves out of Renderer:
- Grid line creation and caching
- Grid bounds tracking and dirty check
- Grid redraw on viewport change

Interface: receives viewport bounds + settings + target layer, draws/caches grid.

### 1.4 Extract InteractionHandler

New file: `src/InteractionHandler.ts`

Moves out of Renderer:
- Mouse/touch event listeners on stage/container
- Hit detection via spatial index query
- Room click, map click, area exit click, context menu dispatch
- Touch long-press timer logic

Interface: receives stage + container + spatial index, dispatches typed events.

### 1.5 Extract CullingManager

New file: `src/CullingManager.ts`

Moves out of Renderer:
- `updateRoomCulling()` logic
- Spatial index build and query (`roomSpatialIndex`, `exitSpatialIndex`)
- Bucket size computation
- Visible room/exit set management
- rAF scheduling for culling updates

Interface: receives viewport bounds + room/exit node maps, toggles visibility.

### After Phase 1

Renderer.ts becomes a ~400-600 line orchestrator:
- Creates layers and sub-renderers
- Wires `drawArea()` → data fetch → RoomRenderer → ExitRenderer → GridRenderer
- Delegates viewport to ViewportManager
- Delegates interaction to InteractionHandler
- Delegates culling to CullingManager

**Validation:** No public API changes. Demo should work identically. Visuals unchanged.

---

## Phase 2 — Typed Event Emitter

**Goal:** Replace raw DOM CustomEvents with a type-safe event API.

### 2.1 Create TypedEventEmitter

New file: `src/TypedEventEmitter.ts`

```ts
interface RendererEvents {
  roomclick: RoomClickEventDetail;
  areaexitclick: AreaExitClickEventDetail;
  mapclick: void;
  contextmenu: RoomClickEventDetail;
  pan: PanEventDetail;
  zoom: ZoomChangeEventDetail;
}

class TypedEventEmitter<T> {
  on<K extends keyof T>(event: K, handler: (detail: T[K]) => void): void;
  off<K extends keyof T>(event: K, handler: (detail: T[K]) => void): void;
  emit<K extends keyof T>(event: K, detail: T[K]): void;
}
```

### 2.2 Integrate into Renderer

- Renderer extends or composes `TypedEventEmitter<RendererEvents>`
- `renderer.on('roomclick', detail => ...)` — full autocomplete, type-checked
- Keep dispatching DOM CustomEvents as well for backwards compat (deprecate over 1-2 versions)

### 2.3 Update InteractionHandler

InteractionHandler emits through the typed emitter instead of directly dispatching DOM events.

**Validation:** Existing `addEventListener` code still works. New `.on()` API available.

---

## Phase 3 — Shared Scene Description

**Goal:** Eliminate rendering duplication between Renderer, SvgExporter, and CanvasExporter by introducing a shared "what to draw" layer.

This is the highest-effort phase but has the biggest payoff.

### 3.1 Define Drawing Primitives

New file: `src/scene/primitives.ts`

```ts
type SceneNode =
  | { type: 'rect'; x: number; y: number; w: number; h: number;
      fill?: string; stroke?: string; strokeWidth?: number;
      cornerRadius?: number; }
  | { type: 'circle'; cx: number; cy: number; r: number;
      fill?: string; stroke?: string; strokeWidth?: number; }
  | { type: 'line'; points: number[];
      stroke?: string; strokeWidth?: number; dash?: number[]; }
  | { type: 'polygon'; points: number[];
      fill?: string; stroke?: string; }
  | { type: 'text'; x: number; y: number; text: string;
      fontSize: number; fontFamily: string; fill?: string;
      align?: string; }
  | { type: 'group'; x: number; y: number; children: SceneNode[];
      id?: string; }
  | { type: 'image'; x: number; y: number; w: number; h: number;
      data: string; }
```

### 3.2 Build Scene Producers

New files under `src/scene/`:

- `buildRoomScene(room, envColors, settings): SceneNode` — produces the shape, symbol, emboss, stubs for one room
- `buildExitScene(exit, rooms, settings): SceneNode` — produces line, arrow, door for one exit
- `buildGridScene(bounds, settings): SceneNode[]` — produces grid lines
- `buildPathScene(pathData, settings): SceneNode[]` — produces path overlay
- `buildLabelScene(label, settings): SceneNode` — produces label text/image

These are pure functions: data in, scene nodes out. No Konva, no SVG, no Canvas2D.

### 3.3 Build Scene Consumers (Backends)

New files:

- `src/backends/KonvaBackend.ts` — `SceneNode → Konva.Node` (used by Renderer)
- `src/backends/SvgBackend.ts` — `SceneNode → SVG string` (replaces SvgExporter internals)
- `src/backends/CanvasBackend.ts` — `SceneNode → Canvas2D draw calls` (replaces CanvasExporter internals)

Each backend implements:
```ts
interface RenderBackend {
  render(nodes: SceneNode[]): void;
  clear(): void;
}
```

### 3.4 Rewire Renderer, SvgExporter, CanvasExporter

- Renderer: `buildRoomScene()` → `KonvaBackend.render()` → layer
- SvgExporter: `buildRoomScene()` → `SvgBackend.render()` → string
- CanvasExporter: `buildRoomScene()` → `CanvasBackend.render()` → ctx calls

Room/exit/grid rendering code now lives in one place. Visual bugs get fixed once.

**Validation:** Pixel-for-pixel identical output across all three backends. Compare exported SVG/PNG before and after.

---

## Phase 4 — Settings Contract ✅

**Status:** Implemented. Adds an explicit, scoped path for settings updates on
top of the existing in-place mutation; the underlying `Settings` object reference
is preserved so the many sub-renderers that hold a long-lived reference (room
shape, exit, grid, culling, etc.) continue to see the latest values without
rewiring.

### 4.1 Diff helper

`src/types/Settings.ts` exposes:

```ts
export type SettingsKey = keyof Settings;
export function diffSettings(prev: Settings, partial: Partial<Settings>): Set<SettingsKey>;
```

Comparison is reference equality (`!==`); pass a fresh object/array to register
a nested change. `undefined` values in the partial are skipped.

### 4.2 Selective invalidation

Targets:

| Target       | Effect                                    |
|--------------|-------------------------------------------|
| `background` | `backend.updateBackground()`              |
| `culling`    | `backend.culling.scheduleCulling()`       |
| `position`   | `state.refreshPosition()`                 |
| `scene`      | full `backend.refresh()` (superset)       |

```ts
export const SETTINGS_INVALIDATION: Readonly<Partial<Record<SettingsKey, readonly InvalidationTarget[]>>>;
export function invalidationTargetsFor(changed: Iterable<SettingsKey>): Set<InvalidationTarget>;
```

Keys without an explicit entry default to `['scene']`. `instantMapMove` /
`perfCallback` map to `[]` (no re-render). `cullingMode`, `cullingEnabled`,
`cullingBounds` map to `['culling']`. `playerMarker`, `highlightCurrentRoom`
map to `['position']`. `roomShape` maps to `['scene', 'position']`. The full
table is in `src/types/Settings.ts`.

### 4.3 Public API

`MapRenderer` adds:

```ts
renderer.updateSettings({ roomSize: 0.8 });   // returns Set<SettingsKey> of keys that changed
renderer.getSettings();                         // returns frozen shallow copy (incl. playerMarker)
```

`updateSettings()` mutates the live settings object in place and dispatches the
union of invalidation targets. When `scene` is in the union, only the full
refresh runs (it already covers the others). When the partial changes nothing,
the call is a no-op and returns an empty set.

### Validation

`tests/settings.test.ts` covers:
- diff returns the right key set, skips `undefined`, uses `!==` for nested objects
- invalidation map is total over `keyof Settings` (guards against omissions)
- `backgroundColor`-only change doesn't change SVG geometry (only the bg fill differs)
- `roomSize` change rebuilds the scene (SVG materially differs)
- `cullingMode` change doesn't rebuild the scene (SVG export is byte-identical)
- `getSettings()` is frozen (top + `playerMarker`) and reflects current values

---

## Phase 5 — Dirty Tracking & Render Scheduling

**Goal:** Batch multiple state changes into a single render pass per frame.

### 5.1 Dirty Flag System

```ts
enum DirtyFlag {
  Rooms      = 1 << 0,
  Exits      = 1 << 1,
  Grid       = 1 << 2,
  Position   = 1 << 3,
  Highlights = 1 << 4,
  Path       = 1 << 5,
  Culling    = 1 << 6,
}
```

State-mutating methods set flags instead of rendering immediately:
- `setPosition()` → sets `DirtyFlag.Position`
- `renderHighlight()` → sets `DirtyFlag.Highlights`
- `updateSettings({roomSize})` → sets `DirtyFlag.Rooms | DirtyFlag.Exits`

### 5.2 Render Scheduler

```ts
class RenderScheduler {
  private dirty: number = 0;
  private scheduled = false;

  markDirty(flags: number) {
    this.dirty |= flags;
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  private flush() {
    const flags = this.dirty;
    this.dirty = 0;
    this.scheduled = false;
    // re-render only what's flagged
    if (flags & DirtyFlag.Rooms) this.renderRooms();
    if (flags & DirtyFlag.Exits) this.renderExits();
    // ...
  }
}
```

### 5.3 Immediate Escape Hatch

For cases where the caller needs synchronous rendering (export, tests):

```ts
renderer.flush();  // process all pending dirty flags immediately
```

**Validation:** Calling `setPosition()` + `renderHighlight()` + `updateSettings()` in the same tick results in exactly one render pass. Measurable FPS improvement on rapid state changes.

---

## Phase 6 — PathFinder Separation (Optional)

**Goal:** Separate graph construction from pathfinding algorithms.

### 6.1 Extract MapGraph

New file: `src/MapGraph.ts`

```ts
class MapGraph {
  constructor(mapReader: MapReader);
  getNeighbors(roomId: number): Array<{ roomId: number; weight: number; direction: string }>;
  buildAdjacencyMap(options?: { visitedOnly?: Set<number> }): Map<number, Edge[]>;
}
```

### 6.2 Simplify PathFinder

PathFinder becomes algorithm-only:
```ts
class PathFinder {
  constructor(graph: MapGraph);
  setAlgorithm(algo: 'dijkstra' | 'astar'): void;
  findPath(from: number, to: number): number[];
}
```

**Validation:** Pathfinding results identical. Can now unit-test pathfinding with synthetic graph fixtures.

---

## Phase Summary

| Phase | Effort | Risk | Payoff |
|-------|--------|------|--------|
| 0. Test infrastructure | Medium | None — additive only | Safety net for all subsequent phases |
| 1. Break up Renderer | Medium | Low — pure extraction | Maintainability, testability |
| 2. Typed events | Small | Low | DX, type safety |
| 3. Scene description | Large | Medium — behavioral parity | Eliminates duplication, enables new backends |
| 4. Settings contract | Medium | Low | Predictability, performance |
| 5. Dirty tracking | Medium | Low-Medium | Performance, correctness |
| 6. PathFinder split | Small | Low | Testability |

Phases 1-2 can be done quickly and independently. Phase 3 is the big investment. Phases 4-5 build naturally on top of phases 1+3. Phase 6 is standalone and can happen anytime.

---

## Phase 0 — Test Infrastructure & Regression Safety Net

**Goal:** Establish a test suite _before_ any refactoring begins so that every subsequent phase has a safety net. No tests exist today — no framework, no fixtures, no CI checks.

This phase is numbered 0 because it must come first: refactoring without regression coverage is flying blind.

### 0.1 Install Test Tooling

**Vitest** for unit/integration tests (native Vite integration, same config):
```
yarn add -D vitest
```

**Playwright** for visual regression (screenshot comparison):
```
yarn add -D @playwright/test
npx playwright install chromium
```

Add scripts to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:visual": "playwright test",
    "test:visual:update": "playwright test --update-snapshots"
  }
}
```

Add `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
  },
});
```

Add `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'yarn demo:dev --port 5174',
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
});
```

Directory structure:
```
tests/
├── unit/                   # Vitest unit & integration tests
│   ├── pathfinder.test.ts
│   ├── directions.test.ts
│   ├── svg-export.test.ts
│   ├── canvas-export.test.ts
│   ├── map-reader.test.ts
│   └── headless.test.ts
├── visual/                 # Playwright screenshot tests
│   ├── render.spec.ts
│   └── __screenshots__/    # Committed baseline images (git-tracked)
└── fixtures/
    └── test-map.json       # Minimal map fixture (see 0.2)
```

### 0.2 Create a Minimal Test Map Fixture

The full `mapExport.json` is too large and opaque for tests. Create `tests/fixtures/test-map.json` — a hand-crafted minimal map (~50 rooms) covering:

- **2 areas** (to test cross-area exits)
- **2 z-levels** in one area (to test plane switching)
- **All 8 cardinal exits** + at least one of each inner exit (up/down/in/out)
- **A special exit** between two rooms
- **A locked door, a closed door, an open door**
- **At least one stub** (one-way exit)
- **2-3 different env colors** (to test color modes)
- **One room with a roomChar symbol**
- **One label** (text) and one label (pixmap/image)
- **One custom line** on a room
- **Rooms with exit weights** (for pathfinding tests)

This fixture is the single source of truth for all non-visual tests. Keep it small enough to reason about by hand.

### 0.3 Unit Tests — Pure Logic (No DOM)

These tests run in Node via Vitest, no browser needed.

**`tests/unit/directions.test.ts`** — Geometry helpers:
- `movePoint()` returns correct edge coordinates for all 8 directions
- `movePointCircle()` returns points on the circle perimeter
- `movePointRoundedRect()` handles corners vs edges correctly
- Symmetry: opposite directions produce mirrored points

**`tests/unit/map-reader.test.ts`** — Data loading:
- Loads test fixture, all rooms and areas accessible
- `getRoom(id)` returns correct room data
- `getArea(id)` returns correct area with expected plane count
- Environment colors mapped correctly
- Exploration decoration filters unvisited rooms

**`tests/unit/pathfinder.test.ts`** — Pathfinding:
- Dijkstra finds shortest path between two connected rooms
- A* finds same path as Dijkstra on the test fixture
- Path through locked door still works (pathfinder ignores doors)
- Path across areas works via cross-area exits
- No path between disconnected rooms returns empty
- Exit weights affect path choice (prefer lower-weight route)

**`tests/unit/exit-renderer.test.ts`** — Exit geometry:
- `ExitRenderer.computeExitData()` produces correct line/arrow/door data
- Door colors match door type (open=green, closed=yellow, locked=red)
- One-way exits produce arrow-only data

**`tests/unit/svg-export.test.ts`** — SVG snapshot tests:
- Export test fixture area → SVG string
- Snapshot the SVG string (Vitest inline snapshots or `.snap` files)
- Test with different settings combinations:
  - Default settings
  - `frameMode: true`
  - `coloredMode: true`
  - `emboss: true`
  - `roomShape: 'circle'` / `'roundedRectangle'`
- Test overlays: position marker, highlights, path
- Any settings change that alters SVG output → snapshot updates → visible in PR diff

**`tests/unit/canvas-export.test.ts`** — Canvas export smoke test:
- Mock a minimal Canvas2D context (record draw calls)
- Export test fixture area → assert expected call sequence
- Verifies CanvasExporter doesn't crash with various settings

**`tests/unit/headless.test.ts`** — HeadlessRenderer integration:
- `drawArea()` + `exportSvg()` returns valid SVG
- `setPosition()` adds position marker to SVG output
- `renderHighlight()` adds highlight rect to SVG output
- `renderPath()` adds path overlay to SVG output
- `clearPaths()` / `clearHighlights()` remove overlays

### 0.4 Visual Regression Tests — Playwright Screenshots

These catch rendering regressions that unit tests and SVG snapshots can't — anti-aliasing, Konva layering, interaction states, zoom/pan behavior.

**`tests/visual/render.spec.ts`:**

```ts
import { test, expect } from '@playwright/test';

// Helper: load demo with a specific area/room, wait for render
async function loadMap(page, areaId: number, roomId: number) {
  await page.goto(`/?area=${areaId}&room=${roomId}`);
  await page.waitForSelector('canvas');
  // Wait for rendering to settle (no more redraws)
  await page.waitForTimeout(500);
}

test.describe('visual regression', () => {
  test('default area render', async ({ page }) => {
    await loadMap(page, /* pick a representative area/room */);
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'default-area.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('frame mode', async ({ page }) => {
    await loadMap(page, ...);
    // Toggle frame mode via demo UI or query param
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'frame-mode.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('colored mode', async ({ page }) => {
    await loadMap(page, ...);
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'colored-mode.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('circle rooms', async ({ page }) => {
    await loadMap(page, ...);
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'circle-rooms.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('zoom in', async ({ page }) => {
    await loadMap(page, ...);
    // Zoom via mouse wheel
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'zoomed-in.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('path rendering', async ({ page }) => {
    await loadMap(page, ...);
    // Trigger path via demo API or UI
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'path-overlay.png', { maxDiffPixelRatio: 0.01 }
    );
  });

  test('highlights', async ({ page }) => {
    await loadMap(page, ...);
    // Trigger highlights
    await expect(page.locator('.map-container')).toHaveScreenshot(
      'highlights.png', { maxDiffPixelRatio: 0.01 }
    );
  });
});
```

**Screenshot baselines** are committed to `tests/visual/__screenshots__/`. On a refactoring PR, any visual diff shows up in the Playwright report.

**Threshold:** `maxDiffPixelRatio: 0.01` (1%) allows sub-pixel anti-aliasing variance but catches real regressions. Tune as needed.

### 0.5 SVG Cross-Backend Consistency Test

This test becomes critical from Phase 3 onward but should be established early:

```ts
// tests/unit/backend-consistency.test.ts
test('SVG export matches headless renderer output', () => {
  const mapReader = loadTestFixture();
  const settings = createSettings();

  // Direct SVG export
  const exporter = new SvgExporter(mapReader, settings);
  const directSvg = exporter.export(areaId, 0);

  // Headless renderer SVG export
  const renderer = new HeadlessRenderer(mapReader, settings);
  renderer.drawArea(areaId, 0);
  const headlessSvg = renderer.exportSvg();

  expect(directSvg).toBe(headlessSvg);
});
```

### 0.6 What Each Phase Tests

| Phase | Unit tests catch | Visual tests catch |
|-------|------------------|--------------------|
| 1. Break up Renderer | N/A (no logic changes) | Room/exit/grid positions shift, events break |
| 2. Typed events | Event payload types | Click handlers stop firing |
| 3. Scene description | Scene producer output changes, backend parity | Any visual difference between old/new render |
| 4. Settings contract | Invalidation map correctness | Settings change doesn't re-render correctly |
| 5. Dirty tracking | Flags set correctly per mutation | Visual glitches from missed/extra renders |
| 6. PathFinder split | Path results change | Path overlay renders differently |

### 0.7 CI Integration (Optional)

If/when CI is set up:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: yarn install --frozen-lockfile
      - run: yarn build
      - run: yarn test
      - run: npx playwright install --with-deps chromium
      - run: yarn test:visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### After Phase 0

Before any refactoring begins, you have:
- Unit tests covering pure logic (directions, pathfinding, data loading)
- SVG snapshot tests catching rendering logic changes
- Playwright screenshot baselines catching visual regressions
- A minimal, hand-crafted test fixture that's easy to reason about
- A clear table mapping each refactoring phase to what tests protect it
