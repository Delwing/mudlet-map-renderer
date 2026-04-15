# Architecture

This document describes the high-level architecture of **mudlet-map-renderer**, a TypeScript library for rendering Mudlet MUD maps as interactive, zoomable 2D canvases or static exports (SVG/PNG).

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

    subgraph Rendering["Rendering Layer"]
        Facade[MapRenderer<br/><i>facade</i>]
        KB[KonvaRenderBackend]
        SB[SvgRenderBackend]
    end

    subgraph Engine["Engine Abstraction"]
        SP[ScenePipeline]
        DB["DrawingBackend<br/><i>interface</i>"]
        KDB[KonvaBackend]
        SDB[SvgBackend]
    end

    subgraph Viewport["Camera & Interaction"]
        VP[Viewport]
        CM[CullingManager]
        IH[InteractionHandler]
    end

    JSON --> MR
    MR --> Area --> Plane
    MR --> MS
    MS --> Facade
    Facade --> KB
    Facade --> SB
    KB --> SP
    SB --> SP
    SP --> DB
    DB --> KDB
    DB --> SDB
    KB --> VP
    KB --> CM
    KB --> IH
    IH --> VP
    VP --> CM
```

---

## Layered Architecture

The codebase follows a strict layered design. Each layer depends only on layers below it.

```mermaid
block-beta
    columns 1
    block:API["Public API"]
        A["MapRenderer (facade)"]
    end
    block:STATE["State"]
        B["MapState"] C["TypedEventEmitter"]
    end
    block:RENDER["Rendering Backends"]
        D["KonvaRenderBackend"] E["SvgRenderBackend"]
    end
    block:SCENE["Scene Building"]
        F["ScenePipeline"] G["RoomShapeRenderer"] H["ExitRenderer"] I["GridRenderer"]
    end
    block:BACKEND["Drawing Abstraction"]
        J["DrawingBackend"] K["KonvaBackend"] L["SvgBackend"]
    end
    block:INFRA["Infrastructure"]
        M["Viewport"] N["CullingManager"] O["InteractionHandler"]
    end
    block:DATA["Data Model"]
        P["MapReader"] Q["Area / Plane"] R["MapData types"]
    end

    API --> STATE
    STATE --> RENDER
    RENDER --> SCENE
    SCENE --> BACKEND
    RENDER --> INFRA
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
    participant KB as KonvaRenderBackend
    participant SP as ScenePipeline
    participant VP as Viewport
    participant CM as CullingManager

    App->>MR: new MapRenderer(mapReader, settings, container)
    MR->>MS: new MapState(mapReader, settings)
    MR->>KB: new KonvaRenderBackend(state, container)
    KB->>VP: new Viewport()
    KB->>CM: new CullingManager()
    KB-->>MS: subscribe to events

    App->>MR: drawArea(areaId, zIndex)
    MR->>MS: setArea(areaId, zIndex)
    MS-->>KB: emit 'area' event
    KB->>SP: buildScene(area, plane)
    SP->>SP: render grid, rooms, exits, labels
    KB->>CM: buildIndex(roomNodes)
    KB->>CM: updateCulling()

    App->>MR: setPosition(roomId)
    MR->>MS: setPosition(roomId)
    MS-->>KB: emit 'position' event
    KB->>VP: panToMapPoint(room.x, room.y)
    VP-->>CM: scheduleCulling()
```

### User Interaction Flow

```mermaid
sequenceDiagram
    participant DOM as Browser DOM
    participant IH as InteractionHandler
    participant VP as Viewport
    participant KB as KonvaRenderBackend
    participant CM as CullingManager

    DOM->>IH: pointerdown + pointermove
    IH->>VP: startDrag() / updateDrag()
    VP->>VP: update position
    VP-->>KB: onChange callback
    KB->>KB: applyViewportToStage()
    KB->>CM: scheduleCulling()
    CM->>CM: query spatial index
    CM->>CM: toggle room visibility

    DOM->>IH: wheel event
    IH->>VP: zoomToPoint(delta, x, y)
    VP-->>KB: onChange callback

    DOM->>IH: click on room
    IH-->>KB: emit 'roomclick' event
```

---

## Core Components

### MapState — Pure State Container

`MapState` holds all mutable state with zero rendering logic. State changes are broadcast via typed events, keeping backends decoupled.

```mermaid
classDiagram
    class MapState {
        +mapReader: MapReader
        +settings: Settings
        +currentArea: number
        +currentZIndex: number
        +positionRoomId: number
        +centerRoomId: number
        +highlights: Map~number, HighlightInfo~
        +paths: PathInfo[]
        +setArea(id, zIndex)
        +setPosition(roomId, center?)
        +centerOn(roomId, instant?)
        +addHighlight(roomId, color)
        +clearHighlights()
        +addPath(locations, color)
        +clearPaths()
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

### DrawingBackend — Rendering Abstraction

All visual output flows through `DrawingBackend`, eliminating code duplication across rendering targets. Both scene building (rooms, exits, grid) and overlay rendering (highlights, position marker, paths) use this interface.

```mermaid
classDiagram
    class DrawingBackend {
        <<interface>>
        +createGroup(x, y) GroupNode
        +addRect(parent, config)
        +addCircle(parent, config)
        +addLine(parent, config)
        +addPolygon(parent, config)
        +addText(parent, config)
        +addImage(parent, config)
    }

    class GroupNode {
        <<interface>>
        +setVisible(visible)
        +isVisible() bool
        +destroy()
        +setPosition(x, y)
        +getPosition() Position
        +moveToTop()
    }

    class KonvaBackend {
        creates Konva.Group, Konva.Rect, etc.
    }

    class SvgBackend {
        builds SVG string elements
    }

    DrawingBackend <|.. KonvaBackend : implements
    DrawingBackend <|.. SvgBackend : implements
    DrawingBackend ..> GroupNode : creates
```

### InteractiveBackend — Backend Contract

`MapRenderer` delegates all rendering to an `InteractiveBackend`, allowing alternative engines (PixiJS, Paper.js, etc.).

```mermaid
classDiagram
    class InteractiveBackend {
        <<interface>>
        +viewport: Viewport
        +culling: CullingManager
        +events: TypedEventEmitter
        +updateBackground()
        +refresh()
        +toCanvas(options) Canvas
        +exportCanvas(options?) HTMLCanvasElement
        +destroy()
    }

    class KonvaRenderBackend {
        -stage: Konva.Stage
        -layers: Konva.Layer[]
        -scenePipeline: ScenePipeline
        +updateBackground()
        +refresh()
    }

    class MapRenderer {
        +state: MapState
        +backend: InteractiveBackend
        +drawArea()
        +setPosition()
        +renderHighlight()
        +exportSvg()
    }

    InteractiveBackend <|.. KonvaRenderBackend : implements
    MapRenderer --> InteractiveBackend : delegates to
    MapRenderer --> MapState : mutates
```

---

## Rendering Pipeline

### Scene Building

`ScenePipeline` is the backend-agnostic scene builder. It receives a `DrawingBackend` and builds the complete visual scene from map data.

```mermaid
flowchart LR
    subgraph ScenePipeline
        direction TB
        G[GridRenderer] --> Grid[Grid lines]
        L[Labels] --> LB[Label nodes]
        E[ExitRenderer] --> EX[Exit lines & arrows]
        R[RoomShapeRenderer] --> RM[Room shapes + symbols]
    end

    Area["Area + Plane data"] --> ScenePipeline
    DB["DrawingBackend"] --> ScenePipeline
    ScenePipeline --> Result["SceneBuildResult<br/>roomNodes, exitNodes, exitDrawData"]
```

### Overlay Rendering

Overlays (highlights, position marker, path trails) are computed as pure data by `scene/OverlayStyle.ts` and rendered through `DrawingBackend` by `scene/OverlayRenderer.ts`. Both `KonvaRenderBackend` and `SvgRenderBackend` use this shared path.

```mermaid
flowchart LR
    OS["OverlayStyle<br/><i>pure data computation</i>"] --> OR["OverlayRenderer<br/><i>DrawingBackend calls</i>"]
    OR --> DB["DrawingBackend"]
    DB --> KB["KonvaBackend"]
    DB --> SB["SvgBackend"]
```

### Layer Structure (Konva)

The Konva backend organizes rendering into five layers, drawn bottom-to-top:

```mermaid
flowchart TB
    subgraph Stage["Konva.Stage"]
        direction TB
        L1["Layer 1: Grid<br/><i>background grid lines</i>"]
        L2["Layer 2: Links<br/><i>exit lines between rooms</i>"]
        L3["Layer 3: Rooms<br/><i>room shapes, symbols, labels</i>"]
        L4["Layer 4: Position<br/><i>player marker, current room</i>"]
        L5["Layer 5: Overlay<br/><i>highlights, paths</i>"]
    end

    L1 ~~~ L2 ~~~ L3 ~~~ L4 ~~~ L5

    style L1 fill:#1a1a2e
    style L2 fill:#16213e
    style L3 fill:#0f3460
    style L4 fill:#533483
    style L5 fill:#e94560
```

### SVG Export

`SvgRenderBackend` produces SVG output through the same `DrawingBackend` interface as the interactive Konva path. Scene content goes through `ScenePipeline` with `SvgBackend`, and overlays go through the shared `OverlayRenderer` with the same `SvgBackend` instance.

```mermaid
flowchart LR
    SRB[SvgRenderBackend] --> SP[ScenePipeline]
    SRB --> OR[OverlayRenderer]
    SP --> SB[SvgBackend]
    OR --> SB
    SB --> SVG["SVG string"]
```

### Culling Pipeline

Spatial bucketing prevents rendering thousands of off-screen rooms.

```mermaid
flowchart LR
    VP[Viewport change] --> SC[scheduleCulling]
    SC --> QB[Query spatial buckets<br/>intersecting viewport]
    QB --> VR[Visible rooms set]
    VR --> TV["Toggle visibility<br/>GroupNode.setVisible()"]
    TV --> BD[Konva batchDraw]

    subgraph SpatialIndex["Spatial Index (5x5 buckets)"]
        B1["bucket(0,0): rooms..."]
        B2["bucket(1,0): rooms..."]
        B3["bucket(0,1): rooms..."]
    end

    QB --> SpatialIndex
```

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

## Room Rendering Modes

The library supports multiple visual modes controlled by `Settings`:

```mermaid
flowchart LR
    subgraph Default["Default Mode"]
        D["fill = envColor<br/>stroke = envColor"]
    end
    subgraph Frame["Frame Mode"]
        F["fill = background<br/>stroke = envColor"]
    end
    subgraph Colored["Colored Mode"]
        C["fill = darken(envColor)<br/>stroke = envColor"]
    end
    subgraph Emboss["+ Emboss"]
        E["light edge top-left<br/>dark edge bottom-right"]
    end
```

Room shapes: `circle` | `rectangle` | `roundedRectangle`

---

## Extensibility

### Adding a New Rendering Backend

To render to a new target (WebGL, Canvas2D, etc.):

1. **Implement `DrawingBackend`** — 7 methods for shape primitives
2. **Pass to `ScenePipeline`** — the pipeline drives your implementation
3. **Optionally implement `InteractiveBackend`** — for full interactive support

```mermaid
flowchart TB
    Custom["MyCustomBackend<br/><i>implements DrawingBackend</i>"]
    SP[ScenePipeline]
    SP -->|"calls addRect, addCircle, ..."| Custom
    Custom -->|"produces"| Output["WebGL / Canvas3D / PDF / ..."]
```

### Injecting a Custom Interactive Backend

```typescript
const renderer = new MapRenderer(mapReader, settings, container,
    (state) => new MyCustomRenderBackend(state, container));
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/rendering/MapRenderer.ts` | Public facade — all public API lives here |
| `src/MapState.ts` | Pure state container with typed events |
| `src/rendering/KonvaRenderBackend.ts` | Interactive Konva.js rendering backend |
| `src/rendering/SvgRenderBackend.ts` | SVG export backend (uses DrawingBackend) |
| `src/backend/DrawingBackend.ts` | Shape abstraction interface |
| `src/backend/KonvaBackend.ts` | Konva implementation of DrawingBackend |
| `src/backend/SvgBackend.ts` | SVG implementation of DrawingBackend |
| `src/ScenePipeline.ts` | Backend-agnostic scene builder |
| `src/scene/OverlayStyle.ts` | Pure-data overlay computation (highlights, marker, paths) |
| `src/scene/OverlayRenderer.ts` | Renders overlays through DrawingBackend |
| `src/Viewport.ts` | Zoom/pan/animation (engine-agnostic) |
| `src/CullingManager.ts` | Spatial indexing and visibility culling |
| `src/InteractionHandler.ts` | DOM event handling (mouse, touch, keyboard) |
| `src/reader/MapReader.ts` | Mudlet JSON parser and data indexer |
| `src/RoomShapeRenderer.ts` | Room shape and symbol rendering |
| `src/ExitRenderer.ts` | Exit geometry computation |
| `src/types/Settings.ts` | Settings type, event types, and `createSettings()` factory |
| `src/types/MapData.ts` | Mudlet map data type definitions |
| `src/utils/color.ts` | Color utilities (darken, lightness, hex-to-rgba) |
| `src/SvgTypes.ts` | SVG export option and overlay types |
| `src/Renderer.ts` | Deprecated backward-compat `Renderer` wrapper class |
| `src/HeadlessRenderer.ts` | Deprecated backward-compat `HeadlessRenderer` wrapper class |
