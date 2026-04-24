# Architecture

This document describes the high-level architecture of **mudlet-map-renderer**, a TypeScript library for rendering Mudlet MUD maps as interactive, zoomable 2D canvases or static exports (SVG/PNG).

---

## System Overview

```mermaid
flowchart TD
    JSON[/"Mudlet Map JSON"/]

    subgraph MR["MapRenderer — Konva-free core"]
        direction LR
        MS[MapState] --> SP[ScenePipeline]
        CAM[Camera] --> CM[CullingManager]
        CAM --> SP
    end

    JSON -->|parse| MR

    MR -->|"+ new KonvaLayerManager(container, renderer)"| INTER["Interactive canvas\nStage · layers · InteractionHandler · live effects"]
    MR -->|"export(new SvgExporter())"| SVG["SVG string"]
    MR -->|"+ new KonvaLayerManager(undefined)\nexport(new CanvasExporter())"| PNG["PNG / headless canvas"]
```

---

## Key Design Principles

1. **`MapRenderer` is Konva-free.** It owns state, camera, culling, pipeline, and scene overlays. No Konva import.
2. **`KonvaLayerManager` is injectable.** Create it separately and pass `renderer` to wire it up. SVG-only use requires no `KonvaLayerManager` at all.
3. **One `ScenePipeline` code path.** Layer nodes are passed at `buildScene()` time — Konva nodes for interactive, SVG nodes for export. Same code, different output target.
4. **`Camera` drives everything.** Subscribe to all viewport changes via `camera.addChangeListener()` — fires for user gestures, animated pans, and programmatic moves alike.

---

## Layered Architecture

```mermaid
block-beta
    columns 1
    block:API["Public API"]
        A["MapRenderer (facade)"]
    end
    block:BACKEND["Konva Backend (optional)"]
        B["KonvaLayerManager"] C["InteractionHandler"]
    end
    block:STATE["State"]
        D["MapState"] E["Camera"]
    end
    block:SCENE["Scene Building"]
        F["ScenePipeline"] G["RoomShapeRenderer"] H["ExitRenderer"] I["GridRenderer"]
    end
    block:DRAWING["Drawing Abstraction"]
        J["DrawingBackend"] K["KonvaBackend"] L["SvgBackend"] M["CanvasBackend"]
    end
    block:INFRA["Infrastructure"]
        N["CullingManager"] O["TypedEventEmitter"]
    end
    block:DATA["Data Model"]
        P["MapReader"] Q["Area / Plane"] R["MapData types"]
    end

    API --> BACKEND
    API --> STATE
    BACKEND --> STATE
    BACKEND --> SCENE
    STATE --> SCENE
    SCENE --> DRAWING
    SCENE --> INFRA
    INFRA --> DATA
```

---

## Data Flow

### Setting Up — Interactive Mode

```mermaid
sequenceDiagram
    participant App as Application
    participant MR as MapRenderer
    participant KLM as KonvaLayerManager
    participant CAM as Camera
    participant CM as CullingManager

    App->>MR: new MapRenderer(mapReader, settings)
    MR->>CAM: new Camera(1, 1)
    MR->>CM: new CullingManager(camera, settings)
    MR->>MR: new ScenePipeline(mapReader, settings, backend)

    App->>KLM: new KonvaLayerManager(container, renderer)
    KLM->>CAM: setSize(container.clientWidth, height)
    KLM->>CAM: addChangeListener(applyViewportToStage)
    KLM-->>MR: _attachBackend(this)

    App->>MR: drawArea(areaId, zIndex)
    MR->>MR: state.setArea()
    MR-->>KLM: 'area' event → refresh()
    KLM->>MR: pipeline.buildScene(area, plane, zIndex, konvaLayers)
    KLM->>CM: buildIndex(roomNodes)
    KLM->>CM: updateCulling()
```

### Setting Up — SVG-Only (No Konva)

```mermaid
sequenceDiagram
    participant App as Application
    participant MR as MapRenderer
    participant SE as SvgExporter

    App->>MR: new MapRenderer(mapReader, settings)
    Note over MR: No KonvaLayerManager created — zero Konva loaded

    App->>MR: drawArea(areaId, zIndex)
    App->>MR: export(new SvgExporter())
    MR->>SE: render(context)
    SE->>SE: new ScenePipeline(mapReader, settings, svgBackend)
    SE->>SE: pipeline.buildScene(area, plane, zIndex, svgLayers)
    SE-->>App: SVG string
```

### User Interaction Flow

```mermaid
sequenceDiagram
    participant DOM as Browser DOM
    participant IH as InteractionHandler
    participant CAM as Camera
    participant KLM as KonvaLayerManager
    participant CM as CullingManager

    DOM->>IH: pointerdown + pointermove
    IH->>CAM: startDrag() / updateDrag()
    CAM->>CAM: update position
    CAM-->>KLM: addChangeListener callback
    KLM->>KLM: applyViewportToStage()
    KLM->>CM: scheduleCulling()
    CM->>CM: query spatial index → toggle visibility

    DOM->>IH: centerOn room
    IH->>IH: animatePanTo(x, y) — RAF loop
    IH->>CAM: position = interpolated
    IH->>CAM: notifyChange()
    CAM-->>KLM: addChangeListener callback
```

---

## Core Components

### MapRenderer — Public Facade

`MapRenderer` is Konva-free. It owns state, camera, culling, the shared pipeline, style, and scene overlays. All rendering is forwarded to the injected `KonvaLayerManager` via the `RenderingBackend` interface.

```mermaid
classDiagram
    class MapRenderer {
        +state: MapState
        +camera: Camera
        +culling: CullingManager
        +pipeline: ScenePipeline
        +drawArea(id, zIndex)
        +setPosition(roomId, center?)
        +centerOn(roomId, instant?)
        +renderHighlight(roomId, color)
        +addSceneOverlay(id, overlay)
        +setStyle(style)
        +export~T~(exporter) T
        +findRoomAtMap(x, y) Room
        +findRoomAtScreen(x, y) Room
    }

    class RenderingBackend {
        <<interface>>
        +events: TypedEventEmitter
        +coordinateTransform: CoordFn
        +setStyle(style)
        +updateBackground()
        +refresh()
        +onSceneOverlayAdded(id, overlay)
        +onSceneOverlayRemoved(id)
        +toCanvas(options) Canvas
        +exportCanvas(options?) Canvas
        +destroy()
    }

    MapRenderer --> RenderingBackend : optional backend
    MapRenderer --> Camera
    MapRenderer --> CullingManager
    MapRenderer --> ScenePipeline
```

### Camera — Viewport State

`Camera` owns all transform state. Use `addChangeListener` to subscribe to every viewport change regardless of cause.

```mermaid
classDiagram
    class Camera {
        +zoom: number
        +position: XY
        +width: number
        +height: number
        +minZoom: number
        +centerOnResize: boolean
        +addChangeListener(cb) unsubscribe
        +removeChangeListener(cb)
        +notifyChange()
        +setZoom(zoom) bool
        +zoomToCenter(zoom) bool
        +zoomToPoint(zoom, x, y) bool
        +panToMapPoint(x, y)
        +fitToMapBounds(minX, maxX, minY, maxY)
        +getViewportBounds() ViewportBounds
        +getScale() number
    }
```

> **`pan` event vs `addChangeListener`:** `renderer.on('pan', cb)` fires only on user gesture pans (mouse drag, wheel, touch). For full viewport tracking — including animated `centerOn` and programmatic pans — use `renderer.camera.addChangeListener(cb)`.

### KonvaLayerManager — Injectable Konva Backend

Owns the physical canvas infrastructure and all Konva-specific rendering. Wires into `MapRenderer` at construction. Can be absent entirely for SVG-only usage.

```mermaid
classDiagram
    class KonvaLayerManager {
        +stage: Konva.Stage
        +gridLayer: Konva.Layer
        +overlayLayer: Konva.Layer
        +positionLayer: Konva.Layer
        +events: TypedEventEmitter
        +addLiveEffect(id, effect)
        +removeLiveEffect(id)
        +toCanvas(options) Canvas
        +exportCanvas(options?) Canvas
        +destroy()
    }
```

### ScenePipeline — Unified Scene Builder

`ScenePipeline` is fully backend-agnostic. Layer nodes are passed at `buildScene()` time — Konva recording nodes for interactive rendering, SVG layer nodes for export. The same code path runs for both.

```mermaid
flowchart LR
    subgraph ScenePipeline
        direction TB
        G[GridRenderer] --> Grid[Grid lines]
        L[Labels] --> LB[Label nodes]
        E[ExitRenderer] --> EX[Exit lines & arrows]
        R[RoomShapeRenderer] --> RM[Room shapes]
    end

    Area["Area + Plane"] --> ScenePipeline
    Layers["SceneLayers<br/>(Konva or SVG)"] --> ScenePipeline
    Backend["DrawingBackend"] --> ScenePipeline
    ScenePipeline --> Result["SceneBuildResult<br/>roomNodes · exitNodes · hitZones"]
```

### DrawingBackend — Rendering Abstraction

All visual output flows through `DrawingBackend`. Decorator backends wrap an inner backend to transform drawing calls (isometric projection, sketchy wobble, parchment colours).

```mermaid
classDiagram
    class DrawingBackend {
        <<interface>>
        +createGroup(x, y) GroupNode
        +addRect(parent, config)
        +addCircle(parent, config)
        +addLine(parent, config)
        +addGridLine(parent, config)
        +addPolygon(parent, config)
        +addText(parent, config)
        +addImage(parent, config)
        +requestRedraw()
        +getTransform() CoordFn
        +getInverseTransform() CoordFn
    }

    class BaseStyle {
        <<abstract>>
        forwards all methods to inner
    }

    class KonvaBackend { creates Konva nodes }
    class SvgBackend { builds SVG elements }
    class CanvasBackend { recording nodes for Konva path }
    class SketchyStyle { wobble effect }
    class IsometricStyle { iso projection }
    class ParchmentStyle { ink colours }

    DrawingBackend <|.. KonvaBackend
    DrawingBackend <|.. SvgBackend
    DrawingBackend <|.. CanvasBackend
    BaseStyle <|-- SketchyStyle
    BaseStyle <|-- IsometricStyle
    BaseStyle <|-- ParchmentStyle
```

> `addGridLine` is intentionally separate from `addLine` so decorator backends can exempt grid lines from effects like the sketchy wobble.

### MapState — Pure State Container

`MapState` holds all mutable rendering state with zero rendering logic. State changes are broadcast via typed events.

**Events emitted:**

| Event | Trigger | Payload |
|-------|---------|---------|
| `area` | Area or z-level changes | `{ area, zIndex }` |
| `position` | Player location changes | `{ roomId, center, areaChanged }` |
| `center` | Camera focus requested | `{ roomId, instant }` |
| `highlight` | Highlight added/removed | `{ roomId, color? }` |
| `path` | Path overlay changes | — |
| `clear` | All overlays cleared | — |

---

## Rendering Paths

### Interactive (Konva)

```
Application
  → new MapRenderer(mapReader, settings)
  → new KonvaLayerManager(container, renderer)
  → state event → KonvaLayerManager.refresh()
  → pipeline.buildScene(area, plane, zIndex, konvaLayers, viewportBounds)
  → CanvasBackend (or styled decorator) → RecordingLayerNode → Konva.Layer
  → KonvaLayerManager.culling.updateCulling() → toggle visibility
```

### SVG Export

```
renderer.export(new SvgExporter())
  → new ScenePipeline(mapReader, settings, svgBackend)
  → pipeline.buildScene(area, plane, zIndex, svgLayers, exportBounds)
  → SvgBackend → SvgLayerNode.toSvg() → SVG string
```

### Headless PNG Export

```
new KonvaLayerManager(undefined, renderer)   ← no DOM container
renderer.export(new CanvasExporter({width, height}))
  → KonvaLayerManager.toCanvas(options)
  → stage.toCanvas() → composite with background → Uint8Array
```

---

## Layer Structure (Konva)

```mermaid
flowchart TB
    subgraph Stage["Konva.Stage"]
        direction TB
        L1["Layer 1: Grid<br/><i>background grid lines</i>"]
        L2["Layer 2: Scene (shared)<br/><i>exits + rooms + labels — one Konva.Layer</i>"]
        L3["Layer 3: Position<br/><i>player marker, current room highlight</i>"]
        L4["Layer 4: Overlay<br/><i>highlights, paths, scene overlays, live effects</i>"]
        L5["Layer 5: Top Labels<br/><i>noScaling labels</i>"]
    end

    L1 ~~~ L2 ~~~ L3 ~~~ L4 ~~~ L5

    style L1 fill:#1a1a2e
    style L2 fill:#16213e
    style L3 fill:#0f3460
    style L4 fill:#533483
    style L5 fill:#e94560
```

> Link exits and rooms share one physical `Konva.Layer` to stay under Konva's recommended layer count. Z-order is preserved by insertion order inside a `RecordingLayerNode`.

---

## Culling Pipeline

```mermaid
flowchart LR
    CAM[Camera change] --> SC[scheduleCulling]
    SC --> QB[Query spatial buckets<br/>intersecting viewport]
    QB --> TV["Toggle visibility<br/>GroupNode.setVisible()"]
    TV --> CB["redrawCallback → sceneNode.batchDraw()"]

    subgraph SpatialIndex["Spatial Index (bucket grid)"]
        B1["bucket(0,0): rooms..."]
        B2["bucket(1,0): rooms..."]
    end

    QB --> SpatialIndex
```

`CullingManager` has no Konva dependency — it reads scale, position, and viewport size directly from `Camera`. Redraw notification is injected via `setRedrawCallback()`.

---

## Overlays

### SceneOverlay — appears everywhere

`SceneOverlay` renders through `DrawingBackend` and appears in all output paths (interactive canvas, SVG, PNG). Registered on `MapRenderer`.

```ts
renderer.addSceneOverlay('ambient', new AmbientLightOverlay({ color: '#ffcc44' }));
```

### LiveEffect — interactive only

`LiveEffect` receives the Konva overlay layer and a scoped `requestRedraw` callback. Skipped by exporters by design. Registered on `KonvaLayerManager`.

```ts
konva.addLiveEffect('fog', new FogOfWarOverlay());
```

---

## Extensibility

### Adding a New Output Format

1. Implement `DrawingBackend` — shape primitives
2. Create `LayerNode` implementations for your target
3. Call `renderer.pipeline.buildScene(area, plane, zIndex, yourLayers, backend)` directly

### Adding a Visual Style

Extend `BaseStyle<Inner>` — all methods forward to `inner` by default. Override only what you need:

```ts
class MyStyle<T extends DrawingBackend> extends BaseStyle<T> {
    addRect(parent, config) {
        this.inner.addRect(parent, { ...config, fill: transform(config.fill) });
    }
}

renderer.setStyle(backend => new MyStyle(backend));
```

### Viewport Change Notifications

```ts
// All changes — user gestures, animation, programmatic
const unsub = renderer.camera.addChangeListener(() => minimap.update());
// cleanup
unsub();

// User gesture pans only
renderer.on('pan', (bounds) => statusBar.update(bounds));
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/rendering/MapRenderer.ts` | Konva-free public facade — state, camera, culling, pipeline, overlays |
| `src/rendering/KonvaLayerManager.ts` | Injectable Konva backend — stage, layers, interaction, live effects |
| `src/Camera.ts` | Zoom/pan/bounds state; multi-listener change notification |
| `src/MapState.ts` | Pure state container with typed events |
| `src/ScenePipeline.ts` | Backend-agnostic scene builder; accepts `SceneLayers` at buildScene time |
| `src/GridRenderer.ts` | Grid rendering with caching; layer injected at render time |
| `src/backend/DrawingBackend.ts` | Shape abstraction interface + `BaseStyle` decorator base |
| `src/backend/KonvaBackend.ts` | Konva node factory (stateless) |
| `src/backend/SvgBackend.ts` | SVG element builder |
| `src/backend/CanvasBackend.ts` | Recording backend for Konva path; materialises into Konva nodes |
| `src/style/` | Visual style decorators: Sketchy, Parchment, Blueprint, Neon, Isometric |
| `src/CullingManager.ts` | Spatial indexing and viewport culling; no Konva dependency |
| `src/InteractionHandler.ts` | DOM event handling — mouse, touch, wheel, animated pans |
| `src/export/SvgExporter.ts` | SVG export via shared `ScenePipeline` with SVG layer nodes |
| `src/export/CanvasExporter.ts` | Headless canvas export |
| `src/export/PngExporter.ts` | PNG data URL / blob export |
| `src/overlay/SceneOverlay.ts` | Backend-agnostic overlay interface (all output paths) |
| `src/overlay/LiveEffect.ts` | Konva-specific animated effect interface |
| `src/scene/OverlayStyle.ts` | Pure-data overlay computation (highlights, position marker, paths) |
| `src/scene/OverlayRenderer.ts` | Renders overlays through `DrawingBackend` |
| `src/reader/MapReader.ts` | Mudlet JSON parser and data indexer |
| `src/RoomShapeRenderer.ts` | Room shape and symbol rendering |
| `src/ExitRenderer.ts` | Exit geometry computation |
| `src/types/Settings.ts` | Settings, event types, `createSettings()` |
| `src/types/MapData.ts` | Mudlet map data type definitions |
