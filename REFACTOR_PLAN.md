# Renderer Pipeline Refactor — Plan

## Goal

Pull geometry, draw, culling, hit testing, and engine binding apart so a single
pipeline drives Konva, SVG, Canvas, and hit-testing. Nothing downstream of
`ScenePipeline` should know about Konva until the final renderer step.

**Constraints (locked):**
- Breaking changes acceptable; major version bump.
- `AreaMapRenderer` (1700-line inter-area meta map) is out of scope.
- Single big-bang rewrite on branch `claude/new-session-Jl0dm`.
- Visual parity bar: close — minor antialiasing/rounding diffs OK; visual
  regression snapshots will be refreshed once.
- `Viewport` is hard-removed; `Camera` replaces it with no compatibility alias.

## Target architecture

```
MapState ── events ──▶ ScenePipeline (style-aware)
                          │
                          ▼
                       SceneIR  (Shape[] per layer; pure data, no Konva)
                          │
              ┌───────────┼─────────────────┐
              ▼           ▼                 ▼
         CullingMgr   HitTester        DrawCommandBuilder
         (uses Camera) (uses Camera)        │
              │           │                 ▼
              └────┬──────┘             DrawCommand[]  (pure data)
                   ▼                          │
            visible Shape[]    ┌──────────────┼──────────────┐
                   │           ▼              ▼              ▼
                   ▼      KonvaRenderer  SvgRenderer   CanvasRenderer
              (filters list)  (interactive) (string out)  (rasterize)

Camera  ◀──── InteractionHandler (DOM events only, no Konva)
```

## Concept boundaries

| Layer | Knows | Does not know |
|---|---|---|
| `MapState` | rooms, areas, position, paths | rendering |
| `ScenePipeline` | how to lay out rooms/exits/grid; calls `Style` for geometry | backends, Konva, SVG |
| `Style` (Sketchy / Iso / etc.) | transforms shape geometry (wobble, project, color) | draw calls, Konva |
| `SceneIR` | `Shape` records (rect, circle, line, polygon, text, image, group) with world coords + paint | engines |
| `Camera` | zoom/pan/world↔screen/animation | DOM, Konva, scene |
| `CullingManager` | spatial index over `Shape[]`, queries by camera viewport | engines |
| `HitTester` | spatial index over hittable shapes, point→shape lookup | engines |
| `DrawCommandBuilder` | translates `Shape[]` + camera transform → `DrawCommand[]` | engines |
| `*Renderer` (Konva/SVG/Canvas) | interprets `DrawCommand[]` for one engine | scene logic |
| `InteractionHandler` | DOM events → camera actions + hit queries | rendering |

## Module layout

```
src/
  state/        MapState.ts (moved), MapEvents.ts
  camera/       Camera.ts (renamed from Viewport.ts), CameraAnimator.ts
  scene/
    Shape.ts                 ← SceneIR types (the new center of gravity)
    ScenePipeline.ts         ← unchanged role, but emits Shape[]
    elements/                ← per-element layout (was scene/* + RoomShapeRenderer)
      RoomLayout.ts
      ExitLayout.ts
      SpecialExitLayout.ts
      StubLayout.ts
      GridLayout.ts
      OverlayLayout.ts
  style/        SketchyStyle.ts, ParchmentStyle.ts, BlueprintStyle.ts,
                NeonStyle.ts, IsometricStyle.ts, Style.ts (new interface)
  culling/      CullingManager.ts (now operates on Shape[])
  hit/          HitTester.ts (NEW — promoted out of CullingManager)
  draw/
    DrawCommand.ts           ← engine IR
    DrawCommandBuilder.ts    ← Shape[] + camera → DrawCommand[]
  render/
    KonvaRenderer.ts         ← was rendering/KonvaRenderBackend.ts
    SvgRenderer.ts
    CanvasRenderer.ts        ← absorbs old CanvasBackend command-replay logic
  interaction/  InteractionHandler.ts
  export/       SvgExporter.ts, PngExporter.ts, CanvasExporter.ts (thin)
  overlay/      SceneOverlay.ts (now produces Shape[]), AmbientLightOverlay.ts,
                LiveEffect.ts (stays Konva-only, interactive only)
  rendering/    MapRenderer.ts (facade — public API stays)
  reader/, types/, utils/, AreaMapRenderer.ts (untouched)
```

## File-by-file changes

### Removed (breaking)

- `src/backend/DrawingBackend.ts` — role splits into `Shape` (SceneIR) +
  `DrawCommand` (engine IR).
- `src/backend/KonvaBackend.ts`, `SvgBackend.ts`, `CanvasBackend.ts` — engine
  draw moves to `*Renderer.ts`.
- Style decorator base (`BaseStyle`) — replaced by the `Style` interface.
- `src/Viewport.ts` — replaced by `Camera`. **No alias kept.**

### Reshaped

- `src/RoomShapeRenderer.ts` (geometry + `backend.add*` fused at lines 25–111)
  → `src/scene/elements/RoomLayout.ts`. Returns `Shape[]`; never calls a backend.
- `src/ScenePipeline.ts` (every `backend.add*`/`createGroup` call site at lines
  273–518) → emits `SceneBuildResult { shapes: Shape[]; hitZones: HitZone[]; meta }`.
  No backend parameter.
- `src/scene/RoomStyle.ts`, `InnerExitStyle.ts`, `SpecialExitStyle.ts`,
  `StubStyle.ts`, `GridStyle.ts`, `AmbientLightStyle.ts`, `OverlayStyle.ts` →
  layout helpers producing `Shape[]`.
- `src/Viewport.ts` → `src/camera/Camera.ts`. API mostly preserved (`zoom`,
  `position`, `getScale`, `clientToMapPoint`, `mapToClientPoint`, drag/animate).
  Replace the single `onChange` callback with an event emitter so renderer,
  culling, and hit tester can all subscribe.
- `src/CullingManager.ts` → operates on `Shape[]` with world-space bboxes;
  drops `StageInfo`; queries `Camera` directly. Returns visible shape index
  slices, not Konva groups.
- `src/InteractionHandler.ts` → callback shape narrows to
  `{ camera, hitTester, areaExitHitZones }`. Stays DOM-only.
- `src/rendering/KonvaRenderBackend.ts` → `src/render/KonvaRenderer.ts`.
  Receives `DrawCommand[]` per layer + a culling subscription. Preserves the
  `RecordingLayerNode` single-`sceneFunc` strategy that keeps culling cheap.
- `src/export/SvgExporter.ts` → consumes `DrawCommand[]` instead of running its
  own `ScenePipeline` instance.
- `src/export/PngExporter.ts` / `CanvasExporter.ts` → public contract
  unchanged; internally reuse the same pipeline instead of grabbing the live
  Konva stage.
- `src/overlay/SceneOverlay.ts` → returns `Shape[]`. `LiveEffect.ts` stays
  Konva-bound (documented escape hatch — interactive only).
- `src/rendering/MapRenderer.ts` → facade; public surface preserved (see below).

### New

- `src/scene/Shape.ts` — discriminated union:
  `RectShape | CircleShape | LineShape | PolygonShape | TextShape | ImageShape | GroupShape`
  with world coords, optional `hit: HitInfo`, optional
  `layer: 'grid' | 'link' | 'room' | 'overlay' | 'top'`.
- `src/draw/DrawCommand.ts` — engine IR; near-identical to today's
  `CanvasBackend` command list but enriched (clip, transform-push/pop,
  layer hint).
- `src/draw/DrawCommandBuilder.ts` — flattens `Shape[]` + active `Camera`
  transform into `DrawCommand[]`. Single source of truth for transform math.
- `src/hit/HitTester.ts` — promoted from `CullingManager`'s spatial index.
  Public method: `pick(worldX, worldY): { kind: 'room' | 'exit' | …; id }`.
- `src/style/Style.ts` — `Style.transform(shape: Shape, ctx: StyleContext): Shape | Shape[]`.

### Untouched

- `src/AreaMapRenderer.ts` (out of scope).
- `src/MapState.ts`, `src/TypedEventEmitter.ts`, `src/PathData.ts`,
  `src/PathFinder.ts`, `src/MapGraph.ts`, `src/reader/*`, `src/utils/*`,
  `src/types/*`.

## Public API after refactor

### Kept (facade)

- `MapRenderer` — same constructor + `drawArea`, `setPosition`, `setStyle`,
  `export`, highlight/path APIs, overlay APIs, `getDrawnExits` /
  `getDrawnSpecialExits` / `getDrawnStubs`, getters `state`, `camera`,
  `culling`, `events`.
- Exporters: `SvgExporter`, `PngExporter`, `CanvasExporter`,
  `PngBytesExporter`, `canvasToBytes`.
- Overlays: `SceneOverlay`, `LiveEffect`, `AmbientLightOverlay`.
- Styles: `Parchment`, `Blueprint`, `Neon`, `Sketchy`, `Isometric` factories
  — same names, new internals.
- `createSettings`, settings type, color utils, `PathFinder`, `MapGraph`,
  `AreaMapRenderer`, `MapState`.

### Removed (breaking, accepted)

- `DrawingBackend`, `BaseStyle`, `CanvasBackend`, `SvgBackend`, `KonvaBackend`,
  `KonvaRenderBackend`, `Viewport`.

### Added

- `Camera`.
- `Shape`, `DrawCommand`, `Style`, `HitTester` types — exposed for advanced
  users / external renderers.
- `MapRenderer.hitTest(worldX, worldY)` — fulfils "library will provide full
  hit testing".

## Execution sequence (single big-bang)

All on `claude/new-session-Jl0dm`, with intermediate commits so review can
step through:

1. **Add IR types** (`Shape.ts`, `DrawCommand.ts`, `Style.ts`) — no behaviour
   change yet.
2. **Extract Camera** from `Viewport` — rename + event emitter; delete the
   `Viewport` symbol. All call sites updated.
3. **Convert `ScenePipeline` + element renderers to emit `Shape[]`** instead of
   calling backend. Includes `RoomShapeRenderer` → `RoomLayout` rename.
4. **Rewrite Style decorators** as `Style.transform(shape)` implementations.
   - Sketchy: wobble line/polygon shapes.
   - Parchment / Blueprint / Neon: rewrite paints (Neon also splits into
     glow-pass + main-pass shapes).
   - Isometric: project coords on shapes; expose `worldToScene` for
     `HitTester` / `Camera` inverse-projection alignment.
5. **Add `DrawCommandBuilder`** — `Shape[]` + camera → `DrawCommand[]`.
6. **Add `HitTester`** — built from `Shape[]` with `hit` annotation. Wire into
   `InteractionHandler`.
7. **Migrate `CullingManager`** to operate on `Shape[]` with world bboxes;
   drop `StageInfo`.
8. **Replace `KonvaRenderBackend` with `KonvaRenderer`** — consumes
   `DrawCommand[]` per layer; preserves `RecordingLayerNode` single-`sceneFunc`
   replay.
9. **Rewrite `SvgExporter` / `CanvasExporter`** to reuse pipeline + builder.
10. **Update `MapRenderer` facade** wiring; expose `hitTest()`.
11. **Delete old backends** (`DrawingBackend`, `KonvaBackend`, `SvgBackend`,
    `CanvasBackend`, `BaseStyle`) and `Viewport`.
12. **Refresh tests + visual snapshots** (one-time refresh — close-parity bar).
13. **Update `src/index.ts` exports** and bump major version in `package.json`.

## Risks and mitigations

- **Isometric coordinate transforms** — currently overrides `getTransform` /
  `getInverseTransform`; `RoomShapeRenderer` checks `IDENTITY_TRANSFORM`.
  Mitigation: Iso becomes a `Style` that rewrites shape coords *before*
  `DrawCommandBuilder` applies the camera; expose `Style.worldToScene(point)`
  so `HitTester` and `Camera` inverse-projection still line up.
- **`RecordingLayerNode` single-sceneFunc replay** is what makes culling cheap
  on Konva today; the new Konva renderer must keep this technique or per-frame
  cost regresses.
- **`LiveEffect`** needs a `Konva.Layer`. Stays as the documented escape hatch
  — `KonvaRenderer` exposes `getLayer('overlay')` for live effects only;
  not part of the IR.
- **`SceneOverlay` consumers** in user code currently get a `DrawingBackend`.
  Breaking change: they get a small `ShapeBuilder` helper. Documented in
  CHANGELOG.
- **`AreaMapRenderer`** — verify no shared imports drift after the rename pass.

## Test strategy

- Unit tests on `Shape` → `DrawCommand` math (transform composition, isometric
  projection, sketchy wobble determinism).
- Existing scene/integration tests rebound to the new types.
- Visual regression: run `yarn test:visual:update` once after step 12; review
  diffs manually before committing snapshots.
- Add hit-testing tests (`MapRenderer.hitTest(x, y)`) — new public API.
