# Architecture

This document describes the high-level architecture of **mudlet-map-renderer**, a TypeScript library for rendering Mudlet MUD maps as interactive, zoomable canvases or static exports (SVG / PNG / Canvas).

The pipeline is built around three engine-neutral intermediate representations:

1. **Shape** — world-space scene geometry (rooms, exits, labels) emitted by `ScenePipeline`.
2. **Style** — pure functions that transform Shapes (Parchment, Blueprint, Neon, Sketchy, Isometric).
3. **DrawCommand** — camera-baked, render-space drawing primitives consumed by concrete renderers (Konva, Canvas2D, SVG).

There is no `DrawingBackend` abstraction anymore — `ScenePipeline` is backend-free, and each renderer / exporter consumes Shapes (or their compiled DrawCommands) directly.

---

## System Overview

```mermaid
flowchart TB
    subgraph Input
        JSON["Mudlet Map JSON"]
    end

    subgraph Data["Data Layer"]
        MR[MapReader]
        Area[Area]
        Plane[Plane]
    end

    subgraph State["State Layer"]
        MS[MapState]
    end

    subgraph Facade["Public API"]
        Renderer[MapRenderer]
    end

    subgraph SceneIR["Scene IR"]
        SP[ScenePipeline]
        Shape["Shape[]<br/><i>world-space</i>"]
    end

    subgraph Styling["Style Layer"]
        Style["Style<br/><i>shape transformer</i>"]
    end

    subgraph DrawIR["Draw IR"]
        DCB[DrawCommandBuilder]
        DC["DrawCommand[]<br/><i>render-space</i>"]
    end

    subgraph Renderers["Renderers"]
        KRB[KonvaRenderBackend]
        CR[CanvasRenderer]
        SR[SvgRenderer]
    end

    subgraph Interaction["Camera & Interaction"]
        Cam[Camera]
        Cull[CullingManager]
        Hit[HitTester]
        IH[InteractionHandler]
    end

    JSON --> MR
    MR --> Area --> Plane
    MR --> MS
    MS --> Renderer
    Renderer --> KRB
    KRB --> SP
    SP --> Shape
    Shape --> Style
    Style --> DCB
    Cam --> DCB
    DCB --> DC
    DC --> KRB
    DC --> CR
    DC --> SR
    KRB --> Cam
    KRB --> Cull
    KRB --> Hit
    IH --> Cam
    IH --> Hit
    Cam --> Cull
```

---

## Layered Architecture

The codebase follows a strict layered design. Each layer depends only on layers below it.

```mermaid
block-beta
    columns 1
    block:API["Public API"]
        A["MapRenderer (facade)"] AM["AreaMapRenderer"]
    end
    block:STATE["State"]
        B["MapState"] C["TypedEventEmitter"]
    end
    block:BACKEND["Interactive Backend"]
        D["KonvaRenderBackend"]
    end
    block:EXPORT["Exporters"]
        E1["SvgExporter"] E2["CanvasExporter"] E3["PngExporter"]
    end
    block:SCENE["Scene IR (Shapes)"]
        F["ScenePipeline"] G["RoomLayout / ExitLayout / GridLayout / LabelLayout / OverlayLayout"]
    end
    block:STYLE["Style Layer"]
        S1["Style interface + compose()"] S2["Parchment / Blueprint / Neon / Sketchy / Isometric"]
    end
    block:DRAW["Draw IR"]
        H["DrawCommandBuilder"] I["CanvasRenderer / SvgRenderer / shapeToRecording"]
    end
    block:INFRA["Engine-Neutral Infrastructure"]
        M["Camera"] N["CullingManager"] O["HitTester"] P["InteractionHandler"]
    end
    block:DATA["Data Model"]
        Q["MapReader"] R["Area / Plane / Room"] T["MapGraph / PathFinder"]
    end

    API --> STATE
    STATE --> BACKEND
    API --> EXPORT
    BACKEND --> SCENE
    EXPORT --> SCENE
    SCENE --> STYLE
    STYLE --> DRAW
    BACKEND --> INFRA
    INFRA --> DATA
```

---

## Data Flow

### Loading and Rendering a Map

```mermaid
sequenceDiagram
    participant App as Application
    participant MR as MapRenderer
    participant MS as MapState
    participant KRB as KonvaRenderBackend
    participant SP as ScenePipeline
    participant Style as Style
    participant DCB as DrawCommandBuilder
    participant Cam as Camera
    participant Cull as CullingManager
    participant Hit as HitTester

    App->>MR: new MapRenderer(mapReader, settings, container)
    MR->>MS: new MapState(mapReader, settings)
    MR->>KRB: new KonvaRenderBackend(state, container)
    KRB->>Cam: new Camera()
    KRB->>Cull: new CullingManager()
    KRB-->>MS: subscribe to events

    App->>MR: drawArea(areaId, zIndex)
    MR->>MS: setArea(areaId, zIndex)
    MS-->>KRB: emit 'area' event
    KRB->>SP: buildScene(area, plane, viewport)
    SP-->>KRB: SceneBuildResult { sceneShapes, hitShapes, refs }
    KRB->>Style: applyStyleToShapes(shapes, ctx)
    KRB->>Hit: build(hitShapes, coordTransform)
    KRB->>DCB: buildDrawCommands(shapes, camera)
    DCB-->>KRB: DrawCommandBatch[] per layer
    KRB->>KRB: replay batches into RecordingLayerNodes
    KRB->>Cull: rebuild spatial index

    App->>MR: setPosition(roomId)
    MR->>MS: setPosition(roomId)
    MS-->>KRB: emit 'position' event
    KRB->>Cam: panToWorldPoint(room.x, room.y)
    Cam-->>Cull: scheduleCulling()
    Cam-->>KRB: rebuild draw commands
```

### User Interaction Flow

```mermaid
sequenceDiagram
    participant DOM as Browser DOM
    participant IH as InteractionHandler
    participant Cam as Camera
    participant Hit as HitTester
    participant KRB as KonvaRenderBackend
    participant Cull as CullingManager

    DOM->>IH: pointerdown + pointermove
    IH->>Cam: startDrag() / updateDrag()
    Cam-->>KRB: 'change' event
    KRB->>Cull: scheduleCulling()
    KRB->>KRB: rebuild DrawCommands & redraw

    DOM->>IH: wheel event
    IH->>Cam: zoomToPoint(delta, x, y)
    Cam-->>KRB: 'change' event

    DOM->>IH: click on stage
    IH->>Hit: pick(screenX, screenY)
    Hit-->>IH: HitResult { roomId, ... }
    IH-->>KRB: emit 'roomclick' event
```

---

## Core Components

### MapState — Pure State Container

`MapState` holds all mutable state with zero rendering logic. State changes are broadcast via typed events; renderers subscribe.

```mermaid
classDiagram
    class MapState {
        +mapReader: MapReader
        +settings: Settings
        +currentArea: number
        +currentZIndex: number
        +positionRoomId: number
        +centerRoomId: number
        +highlights: Map~number, HighlightEntry~
        +paths: PathEntry[]
        +setArea(id, zIndex)
        +setPosition(roomId, center?)
        +centerOn(roomId, instant?)
        +addHighlight(roomId, color)
        +clearHighlights()
        +addPath(locations, color)
        +clearPaths()
        +getOverlaysForArea(area, z)
    }

    class TypedEventEmitter~T~ {
        +on(event, handler)
        +off(event, handler)
        +emit(event, detail)
    }

    MapState --|> TypedEventEmitter : extends
```

**Events emitted:**

| Event | Trigger | Payload |
|-------|---------|---------|
| `area` | Area or z-level changes | `{ area, zIndex }` |
| `position` | Player location changes | `{ roomId, center, areaChanged }` |
| `center` | Camera focus changes | `{ roomId, instant }` |
| `highlight` | Highlight added/removed | `{ roomId, color? }` |
| `path` | Path overlay changes | — |
| `clear` | All overlays cleared | — |

### Shape — Engine-Neutral Scene IR

Defined in `src/scene/Shape.ts`. World-space geometry emitted by `ScenePipeline`, with no engine knowledge.

```mermaid
classDiagram
    class Shape {
        <<union>>
        RectShape | CircleShape | LineShape
        PolygonShape | TextShape | ImageShape
        GroupShape
    }

    class ShapeBase {
        +layer?: LayerId
        +hit?: HitInfo
        +noScale?: boolean
        +alpha?: number
    }

    class Paint {
        +fill?: string
        +stroke?: string
        +strokeWidth?: number
        +dash?: number[]
    }

    class GroupShape {
        +children: Shape[]
        +x?: number
        +y?: number
    }

    class HitInfo {
        +roomId?: number
        +exitId?: string
        +bbox?: Bbox
    }

    Shape --|> ShapeBase
    Shape --> Paint : carries
    GroupShape --o Shape : contains
    ShapeBase --> HitInfo : optional
```

Layers: `grid` | `link` | `room` | `position` | `overlay` | `top`.

### Style — Shape Transformer

A `Style` is a pure function that maps one Shape to zero or more output Shapes. Styles compose left-to-right and run **before** culling, hit-testing, and DrawCommand compilation.

```mermaid
classDiagram
    class Style {
        <<interface>>
        +transform(shape, ctx) Shape | Shape[]
        +worldToScene?(p) Point
        +sceneToWorld?(p) Point
    }

    class StyleContext {
        +mapReader: MapReader
        +settings: Settings
    }

    class Parchment
    class Blueprint
    class Neon
    class Sketchy {
        +options: SketchyOptions
    }
    class Isometric {
        +options: IsometricOptions
    }

    Style <|.. Parchment
    Style <|.. Blueprint
    Style <|.. Neon
    Style <|.. Sketchy
    Style <|.. Isometric
    Style ..> StyleContext : uses
```

`compose(a, b, c)` returns a Style whose `transform` is `c ∘ b ∘ a`. `applyStyleToShapes(shapes, style, ctx)` walks a shape tree and reassembles the styled output.

`Isometric` additionally provides `worldToScene` / `sceneToWorld` — a 2.5D projection consumed by `CullingManager` and `HitTester` so spatial queries stay correct after geometric warping.

### DrawCommand — Render-Space Draw IR

Defined in `src/draw/DrawCommand.ts`. Coordinates are **already in render space** (camera transform applied) and paint is fully baked. `DrawCommandBuilder.buildDrawCommands(shapes, camera)` is the only producer.

```mermaid
classDiagram
    class DrawCommand {
        <<union>>
        RectCommand | CircleCommand | LineCommand
        PolygonCommand | TextCommand | ImageCommand
        PushTransformCommand | PopTransformCommand
        PushClipCommand | PopClipCommand
    }

    class CameraTransform {
        +scale: number
        +offsetX: number
        +offsetY: number
    }

    class DrawCommandBatch {
        +layer: LayerId
        +commands: DrawCommand[]
    }

    DrawCommandBatch --o DrawCommand : contains
    CameraTransform ..> DrawCommand : drives
```

`noScale` Shapes (e.g. text that should stay screen-sized) are wrapped in `PushTransform` / `PopTransform` pairs that cancel the camera scale.

### MapRenderer — Public Facade

`MapRenderer` is a thin facade: it owns `MapState` and an `InteractiveBackend` (default `KonvaRenderBackend`), and exposes the entire public API.

```mermaid
classDiagram
    class InteractiveBackend {
        <<interface>>
        +camera: Camera
        +culling: CullingManager
        +hitTester: HitTester
        +events: TypedEventEmitter
        +setStyle(style)
        +addSceneOverlay(overlay)
        +exportCanvas(options?) HTMLCanvasElement
        +refresh()
        +destroy()
    }

    class KonvaRenderBackend {
        -stage: Konva.Stage
        -gridLayer / linkLayer / roomLayer ...
        -scenePipeline: ScenePipeline
        -hitTester: HitTester
        +setStyle(style)
        +refresh()
    }

    class MapRenderer {
        +state: MapState
        +backend: InteractiveBackend
        +drawArea()
        +setPosition()
        +renderHighlight()
        +renderPath()
        +setStyle(style)
        +addSceneOverlay(overlay)
        +export(exporter) T
        +hitTest(x, y) HitResult?
    }

    InteractiveBackend <|.. KonvaRenderBackend
    MapRenderer --> InteractiveBackend : delegates to
    MapRenderer --> MapState : mutates
```

---

## Rendering Pipeline

### Scene Building

`ScenePipeline.buildScene(area, plane, viewport?)` is engine-neutral. It produces a `SceneBuildResult` whose primary outputs are `sceneShapes` (per-layer Shape arrays) and `hitShapes` (annotated for `HitTester`).

```mermaid
flowchart LR
    Area["Area + Plane data"] --> SP[ScenePipeline]
    Settings --> SP
    SP --> GL[GridLayout]
    SP --> LL[LabelLayout]
    SP --> EL[ExitLayout]
    SP --> RL[RoomLayout]
    SP --> SE[SpecialExitLayout]
    SP --> SL[StubLayout]
    GL & LL & EL & RL & SE & SL --> Shapes["Shape[]<br/>per layer"]
    SP --> Result["SceneBuildResult<br/>{ sceneShapes, hitShapes,<br/>roomShapeRefs, drawnExits, ... }"]
```

The `*Layout` modules in `src/scene/elements/` build the actual geometry. The `*Style` modules in `src/style/` (`RoomStyle`, `GridStyle`, `OverlayStyle`, `InnerExitStyle`, `SpecialExitStyle`, `StubStyle`, `AmbientLightStyle`) are pure-data helpers that compute colors, geometry parameters, and overlay shapes — they are **not** `Style` interface implementations, just data computations shared across layouts.

### Style → DrawCommand → Renderer

Once Shapes are built, the rest of the pipeline is uniform across interactive and export paths:

```mermaid
flowchart LR
    Shapes["Shape[]"] --> AS["applyStyleToShapes(shapes, style, ctx)"]
    AS --> Styled["Shape[] (styled)"]
    Styled --> DCB["buildDrawCommands(shapes, camera)"]
    DCB --> Batches["DrawCommandBatch[] per layer"]
    Batches --> Konva["Konva replay<br/>(RecordingLayerNode)"]
    Batches --> Canvas["renderToCanvas(ctx, batches)"]
    Batches --> SVG["svgFromBatches(batches)"]
```

- `src/render/CanvasRenderer.ts` — replays DrawCommands onto a `CanvasRenderingContext2D`. Used by `CanvasExporter` and `PngExporter`.
- `src/render/SvgRenderer.ts` — emits an SVG string from DrawCommandBatches. Used by `SvgExporter`.
- `src/render/RecordingLayer.ts` — Konva-side replay infrastructure: `RecordingLayerNode` stores `DrawEntry`s (one per scene group) and materializes them into a single Konva.Shape with a `sceneFunc`, giving cheap visibility toggling for culling without recreating Konva nodes.
- `src/render/shapeToRecording.ts` — converts a single Shape to recording draw commands (used by Konva when adding/updating individual scene groups).

### Layer Structure (Konva)

`KonvaRenderBackend` exposes six logical layers but uses **five** physical `Konva.Layer`s — `linkLayer` and `roomLayer` share one underlying layer to stay under Konva's recommended layer count. Drawn bottom-to-top:

```mermaid
flowchart TB
    subgraph Stage["Konva.Stage"]
        direction TB
        L1["Layer 1: Grid<br/><i>background grid lines</i>"]
        L2["Layer 2: Scene (link + room)<br/><i>two-way exits, room shapes, symbols,<br/>inner exits, stubs — one shared Konva.Layer</i>"]
        L3["Layer 3: Position<br/><i>player marker, current room ring</i>"]
        L4["Layer 4: Overlay<br/><i>highlights, paths, SceneOverlays, live effects</i>"]
        L5["Layer 5: Top Label<br/><i>area name, area-exit labels (always on top)</i>"]
    end

    L1 ~~~ L2 ~~~ L3 ~~~ L4 ~~~ L5

    style L1 fill:#1a1a2e
    style L2 fill:#0f3460
    style L3 fill:#533483
    style L4 fill:#e94560
    style L5 fill:#3a2d5c
```

### Export Pipeline

Exporters implement a tiny `Exporter<T>` interface and run the same Shape → Style → DrawCommand pipeline as the interactive backend, but with their own renderer at the tail.

```mermaid
flowchart LR
    Ctx["ExportContext<br/>{ state, backend, style, overlays }"] --> Exp[Exporter]
    Exp --> SP[ScenePipeline.buildScene]
    SP --> Flush["flushSceneShapes(layers, cb)"]
    Flush --> Style["applyStyleToShapes"]
    Style --> DCB["buildDrawCommands<br/>(export camera)"]
    DCB --> Sink

    subgraph Sink["Renderer per Exporter"]
        SVG["svgFromBatches → SVG string"]
        CV["renderToCanvas → Canvas"]
        PNG["canvasToBytes → PNG bytes"]
    end
```

- `src/export/Exporter.ts` — `Exporter<T>` interface and `ExportContext` definition.
- `src/export/flushSceneShapes.ts` — single source of truth for the canonical layer order and how built-in / custom `SceneOverlay` shapes are merged in.
- `src/export/sceneBounds.ts` — derives the export region from area bounds, viewport, or room-centred bounds.
- `src/export/SvgExporter.ts` — drives the pipeline and returns an SVG string.
- `src/export/CanvasExporter.ts` — produces an `ExportCanvas` (also exposes `PngBytesExporter`).
- `src/export/PngExporter.ts` — wraps `CanvasExporter` and returns a PNG data URL (`PngBlobExporter` returns a `Blob`).
- `src/export/canvasToBytes.ts` — browser- and Node-compatible canvas → PNG byte serialisation.

### Culling Pipeline

`CullingManager` is engine-neutral spatial bucketing keyed off `Camera.getViewportBounds()`. When the camera moves, the manager queries its index, computes which entries (rooms, exits) are in view, and invokes the visibility callbacks the backend supplied at registration time.

```mermaid
flowchart LR
    Cam[Camera change] --> SC[scheduleCulling]
    SC --> QB[Query spatial buckets<br/>intersecting viewport]
    QB --> VR[Visible entries set]
    VR --> CB["Toggle visibility callbacks<br/>(setRoomVisible, setExitVisible)"]
    CB --> Replay[Konva batchDraw]

    subgraph SpatialIndex["Spatial Index"]
        B1["bucket(0,0): entries..."]
        B2["bucket(1,0): entries..."]
        B3["bucket(0,1): entries..."]
    end

    QB --> SpatialIndex
```

For non-trivial style projections (e.g. `Isometric`), the backend supplies a `CoordinateTransform` so culling and hit-testing operate in rendered space.

---

## Data Model

### Map Data Hierarchy

```mermaid
classDiagram
    class MapReader {
        +areas: Map~number, Area~
        +rooms: Map~number, Room~
        +envColors: Map~number, Color~
        +getRoom(id) Room
        +getArea(id) Area
        +getEnvColor(envId) string
    }

    class Area {
        +areaId: number
        +areaName: string
        +planes: Map~number, Plane~
        +exits: Exit[]
        +getPlane(z) Plane
        +getZLevels() number[]
    }

    class Plane {
        +zIndex: number
        +rooms: Room[]
        +labels: Label[]
        +bounds: Bounds
    }

    class Room {
        +id: number
        +x: number
        +y: number
        +z: number
        +name: string
        +env: number
        +roomChar: string
        +exits: Record~string, number~
        +specialExits: Record~string, number~
        +doors: Record~string, DoorType~
        +stubs: number[]
    }

    MapReader "1" --> "*" Area
    Area "1" --> "*" Plane
    Plane "1" --> "*" Room
```

`src/MapGraph.ts` builds a graph of rooms + edges from the `MapReader`; `src/PathFinder.ts` runs A* over it; `src/PathData.ts` turns a path result into overlay geometry consumed by `OverlayLayout`.

### Exit Types

```mermaid
flowchart LR
    subgraph ExitTypes["Exit Classification"]
        Link["Link Exit<br/><i>two-way, both rooms in area</i>"]
        Special["Special Exit<br/><i>named portal, may cross areas</i>"]
        Stub["Stub Exit<br/><i>one-way, target not in area</i>"]
        Inner["Inner Exit<br/><i>up/down/in/out, rendered inside room</i>"]
    end
```

---

## Overlay System

`SceneOverlay` is the unified extension point for anything that is **not** part of the map's static scene — highlights, the player marker, path trails, ambient lighting, custom plug-ins.

```ts
interface SceneOverlay {
    attach?(ctx: SceneOverlayContext): void;
    detach?(): void;
    render(state: MapState, bounds: ViewportBounds): Shape | Shape[] | void;
}
```

```mermaid
flowchart LR
    SO[SceneOverlay] --> RShapes["render() → Shape[]"]
    RShapes --> Flush[flushSceneShapes]
    Flush --> Pipeline["Style → DrawCommand → Renderer"]
    Flush --> Konva
    Flush --> SVG
    Flush --> Canvas
```

- Built-in overlays for highlights, position, and paths are merged in by `flushSceneShapes` so they appear in interactive output **and** every exporter without each overlay needing renderer-specific code.
- `src/overlay/AmbientLightOverlay.ts` — optional ambient lighting (vignette / shadows).
- `src/overlay/LiveEffect.ts` — Konva-only animated effects (rain, snow, pulses); attached to `KonvaRenderBackend` directly, not exported.
- `attach()` / `detach()` let an overlay subscribe to `MapState` and viewport events and call `ctx.invalidate()` to force a re-render. Exporters skip these hooks and call `render()` once.

---

## Camera, Hit-Testing & Interaction

| Concern | Module | Notes |
|---|---|---|
| Zoom / pan / animation | `src/camera/Camera.ts` | Pure math — no Konva or DOM. Emits `change` events; falls back to `setTimeout` outside the browser. Replaces the legacy `Viewport`. |
| Spatial visibility | `src/CullingManager.ts` | Engine-neutral. Accepts an optional `CoordinateTransform` so projected styles (Isometric) cull correctly. |
| Point → room lookup | `src/hit/HitTester.ts` | Built from the `hitShapes` returned by `ScenePipeline`; spatial index over annotated bboxes. Used by interaction *and* by `MapRenderer.hitTest()`. |
| DOM events | `src/InteractionHandler.ts` | Routes mouse / touch / wheel / resize to the camera and hit tester. No Konva dependency. |

---

## Extensibility

### Adding a New Style

A Style only needs to implement `transform(shape, ctx)`. It runs before culling, hit-testing, and command compilation, so it works with every renderer and exporter.

```typescript
import type { Style, Shape } from 'mudlet-map-renderer';

const RedTint: Style = {
    transform(shape: Shape) {
        if ('fill' in shape && shape.fill) {
            return { ...shape, fill: '#ff5555' };
        }
        return shape;
    },
};

renderer.setStyle(RedTint);
```

Compose with shipped styles via `compose(Parchment, RedTint)`.

### Adding a New Exporter

Implement `Exporter<T>` and drive the standard pipeline:

```typescript
import {
    type Exporter, type ExportContext,
    buildDrawCommands, applyStyleToShapes,
} from 'mudlet-map-renderer';

class MyExporter implements Exporter<MyOutput> {
    render(ctx: ExportContext): MyOutput {
        const scene = ctx.backend.buildSceneFor(ctx.state); // or call ScenePipeline directly
        const styled = applyStyleToShapes(scene.shapes, ctx.style, ctx);
        const batches = buildDrawCommands(styled, exportCamera);
        return myEngineReplay(batches);
    }
}
```

### Adding a New Interactive Backend

Implement `InteractiveBackend` (camera + culling + hit-testing + scene rebuild on `MapState` events) and inject it via `MapRenderer`'s factory:

```typescript
const renderer = new MapRenderer(mapReader, settings, container,
    (state, container) => new MyCustomBackend(state, container));
```

Backends are free to consume Shapes directly (like Konva does, via `RecordingLayerNode`) or compile them to `DrawCommand`s with `buildDrawCommands` and replay through `renderToCanvas` / `svgFromBatches` / a custom replayer.

---

## AreaMapRenderer

`src/AreaMapRenderer.ts` is a separate top-level renderer for the **meta-map** (areas as nodes, inter-area exits as edges, force-directed layout). It owns its own Konva stage and does **not** share the main `ScenePipeline`. It is exported alongside `MapRenderer` for consumers that need both views.

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Public package exports |
| `src/rendering/MapRenderer.ts` | Public facade — owns MapState and the interactive backend |
| `src/MapState.ts` | Pure state container with typed events |
| `src/rendering/KonvaRenderBackend.ts` | Konva.js interactive backend; consumes Shapes via RecordingLayerNode |
| `src/AreaMapRenderer.ts` | Standalone meta-map (areas + inter-area edges) renderer |
| `src/ScenePipeline.ts` | Backend-free scene builder; produces Shape[] + hit shapes |
| `src/scene/Shape.ts` | Engine-neutral scene IR (Shape union, Paint, HitInfo, LayerId) |
| `src/scene/elements/RoomLayout.ts` | Room body, border, emboss, symbol shapes |
| `src/scene/elements/ExitLayout.ts` | Two-way link exits and inner (up/down/in/out) exits |
| `src/scene/elements/GridLayout.ts` | Background grid shapes |
| `src/scene/elements/LabelLayout.ts` | Room labels, area name, area-exit labels |
| `src/scene/elements/SpecialExitLayout.ts` | Special-exit polylines and arrows |
| `src/scene/elements/StubLayout.ts` | One-way stub indicators |
| `src/scene/elements/OverlayLayout.ts` | Highlights, position marker, path trails as Shapes |
| `src/style/Style.ts` | Style interface + `compose()` |
| `src/style/applyStyle.ts` | Walks shape trees applying a Style |
| `src/style/index.ts` | Re-exports Parchment / Blueprint / Neon / Sketchy / Isometric |
| `src/style/shape/*Style.ts` | Concrete Style implementations |
| `src/style/shape/paintMap.ts` | Palette lookup tables for shape-based styles |
| `src/style/shape/wobble.ts` | Deterministic jitter for Sketchy |
| `src/style/RoomStyle.ts` | `computeRoomColors()` — single source of truth for room paint |
| `src/style/GridStyle.ts` | Grid spacing, color, alpha config |
| `src/style/OverlayStyle.ts` | Pure-data overlay geometry (highlights, marker, paths) |
| `src/style/AmbientLightStyle.ts` | Ambient-light overlay parameters |
| `src/style/InnerExitStyle.ts` | Inner-exit triangle geometry |
| `src/style/SpecialExitStyle.ts` | Special-exit polyline geometry |
| `src/style/StubStyle.ts` | Stub line geometry |
| `src/draw/DrawCommand.ts` | Render-space draw IR (DrawCommand union, batches) |
| `src/draw/DrawCommandBuilder.ts` | `buildDrawCommands(shapes, camera)` — Shape → DrawCommand |
| `src/render/CanvasRenderer.ts` | Replays DrawCommandBatches onto Canvas2D |
| `src/render/SvgRenderer.ts` | Emits SVG string from DrawCommandBatches |
| `src/render/RecordingLayer.ts` | Konva-side replay (RecordingLayerNode, DrawEntry) |
| `src/render/shapeToRecording.ts` | Single-shape → recording draw commands |
| `src/export/Exporter.ts` | Exporter interface + ExportContext |
| `src/export/SvgExporter.ts` | SVG string export |
| `src/export/CanvasExporter.ts` | ExportCanvas + PngBytesExporter |
| `src/export/PngExporter.ts` | PNG data URL / Blob exporters |
| `src/export/flushSceneShapes.ts` | Canonical layer order + overlay merging for exports |
| `src/export/sceneBounds.ts` | Export region computation |
| `src/export/canvasToBytes.ts` | Browser + Node canvas serialisation |
| `src/camera/Camera.ts` | Engine-agnostic zoom / pan / animation |
| `src/CullingManager.ts` | Spatial bucketing, viewport culling |
| `src/hit/HitTester.ts` | Spatial point → Shape lookup |
| `src/InteractionHandler.ts` | DOM event routing (mouse, touch, keyboard) |
| `src/overlay/SceneOverlay.ts` | Unified overlay extension point |
| `src/overlay/AmbientLightOverlay.ts` | Ambient lighting overlay |
| `src/overlay/LiveEffect.ts` | Konva-only animated effects |
| `src/reader/MapReader.ts` | Mudlet JSON parser and data indexer |
| `src/reader/ExplorationArea.ts` | Fog-of-war area decorator |
| `src/MapGraph.ts` | Room graph construction |
| `src/PathFinder.ts` | A* pathfinding over MapGraph |
| `src/PathData.ts` | Path result → overlay geometry |
| `src/ExitRenderer.ts` | Exit geometry computation (used by ExitLayout) |
| `src/coord/CoordFn.ts` | Coordinate-transform helpers (used by Isometric) |
| `src/types/Settings.ts` | Settings type, event types, `createSettings()` |
| `src/types/MapData.ts` | Mudlet map data type definitions |
| `src/utils/color.ts` | Color utilities (darken, lightness, hex-to-rgba) |
| `src/SvgTypes.ts` | SVG export option and overlay types |
