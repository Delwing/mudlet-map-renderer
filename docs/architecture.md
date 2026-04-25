# Architecture

## Overview

One unified path from map data to any output format. The output format (interactive canvas,
SVG, PNG) is decided at the very last step. Everything above it is shared.

```
MapData
  │
  ▼
ScenePipeline  (uses DrawingBackend for style / coordinate transforms)
  │
  ▼
SceneBuildResult  ─────────────────────────────────►  selection overlays, etc.
  │                                                  
  ▼
Camera + CullingManager  (what is visible in this viewport, in this style?) ─────► hit testing data
  │
  ├── Overlays  (position marker, highlights, paths — event-driven, same DrawingBackend)
  │
  ▼
LayerNode.render()  (backend-specific: sceneFunc for Konva, toSvg() for SVG)
  │
  ├── Konva canvas  (interactive)
  ├── SVG string
  └── PNG / PDF / …
```

---

## Components

### SceneNode  (universal scene primitive)

A backend-agnostic group of draw commands at a given position:

```typescript
class SceneNode {
    x: number;
    y: number;
    visible: boolean;
    noScaling?: boolean;
    readonly commands: DrawCommand[];   // rect, circle, line, polygon, text, image
}
```

Every `DrawingBackend` creates and populates `SceneNode` instances. There is only one type —
no `RecordingGroupNode`, no `SvgGroupNode`. The commands encode the final styled, transformed
geometry. Backends replay them to their own output format.

### DrawingBackend

Two responsibilities:

**1. Builder** — called by `ScenePipeline` during scene construction:
`createGroup()`, `addRect()`, `addLine()`, `addPolygon()`, `addText()`, `addImage()` push
`DrawCommand` entries into the `SceneNode`.

**2. Coordinate transform** — `getTransform(): CoordFn` exposes the render-space transform
(identity for flat maps, isometric matrix for isometric style). `CullingManager` uses this to
determine what is actually visible.

The builder interface is identical across all backends. Style decorators (`SketchyStyle`,
`IsometricStyle`, etc.) wrap any `DrawingBackend` and modify geometry before commands are
stored — the stored `DrawCommand[]` already has the style applied.

### SceneBuildResult

Output of `ScenePipeline.buildScene()`. Format-agnostic:

```typescript
type SceneBuildResult = {
    roomNodes:            Map<number, { room: MapData.Room; node: SceneNode }>;
    standaloneExitNodes:  Array<{ node: SceneNode; bounds: Bounds }>;
    drawnExits:           DrawnExitEntry[];
    drawnSpecialExits:    DrawnSpecialExitEntry[];
    drawnStubs:           DrawnStubEntry[];
    areaExitHitZones:     AreaExitHitZone[];
};
```

The same result is used for hit-testing in the editor ("which room did I click?"), for
culling ("which rooms are in the viewport?"), and for rendering to any output format.

### RenderingContext

The geometry and viewport state that determines what you see:

```
camera:          Camera             viewport: position, zoom, dimensions
drawingBackend:  DrawingBackend     style + coordinate transform
culling:         CullingManager     camera + transform → visible SceneNodes
```

**Camera is independent** — shareable across backends. Two backends with the same camera see
the same viewport. Two backends with different cameras act as independent views (e.g. main
view + minimap). `CullingManager` sits between camera and backend because culling depends on
both the viewport (camera) and the coordinate transform (style). It is not inside the backend.

Hit-testing is a `RenderingContext` question: "given this screen point, which room is here?"
→ `camera.clientToMapPoint()` + `culling.findRoomAtMapPoint()`. The answer is the same
regardless of whether output is Konva, SVG, or PNG.

### LayerNode  (output sink)

The only part that differs per output format. Receives the same `SceneNode[]` and renders
them:

```
RecordingLayerNode.batchDraw():   SceneLayerNode.toSvg():
  sceneFunc(ctx):                   for each visible SceneNode:
    for each visible SceneNode:       for each DrawCommand:
      for each DrawCommand:             rect  → <rect .../>
        rect  → ctx.fillRect()          line  → <polyline .../>
        line  → ctx.stroke()            text  → <text ...>
```

`CanvasBackend` is the single builder — `addRect()` always pushes the same `DrawCommand[]`
into a `RecordingGroupNode`. `RecordingLayerNode` replays those commands on a Canvas2D context;
`SceneLayerNode` replays them as SVG element strings.

### Overlays

Player position, highlights, path overlays are **not** part of `SceneBuildResult`. They are
computed separately (event-driven) and rendered through the same `DrawingBackend`, producing
`SceneNode` instances added to dedicated layers (position layer, overlay layer).

Because they use the same `DrawingBackend` and coordinate transform, a position marker on an
isometric map is automatically in isometric coordinates — no special handling needed.

```
state change (setPosition, renderHighlight, renderPath)
  → compute data  (computePositionMarker, computeHighlight, computePathOverlay)
  → DrawingBackend.addCircle() / addRect() / addLine()
  → SceneNode  →  positionLayer / overlayLayer
  → LayerNode.render()  →  Konva / SVG / PNG
```

### MapRenderer  (facade)

Owns `MapState`, `ScenePipeline`, and the active `RenderingContext` + backends. Exposes the
full public API: `drawArea()`, `setPosition()`, `renderHighlight()`, `renderPath()`,
`setZoom()`, `fitArea()`, `on('roomclick', …)`, etc.

Users interact with `MapRenderer` for the common case. Power users hold references to the
backend they created and call format-specific methods directly (e.g. `svgBackend.toSvg()`).
The backend registration pattern is consistent — any backend self-registers in its
constructor via `renderer._attachBackend(this)`.

---

## Multiple backends / cameras

Camera is independent — pass any camera to any backend:

```typescript
// Two backends, same camera → same viewport, different outputs simultaneously
const camera = renderer.camera;
const konva  = new KonvaLayerManager(container, renderer, camera);
const svg    = new SvgRenderingBackend(renderer, camera);

// Two backends, different cameras → main view + minimap
const mainCam = new Camera(1920, 1080);
const miniCam = new Camera(200, 200);
const main = new KonvaLayerManager(mainContainer, renderer, mainCam);
const mini = new KonvaLayerManager(miniContainer,  renderer, miniCam);
```

Scene changes (area, state) notify all attached backends. Camera changes notify only the
backends that share that camera.

---

## SVG export

No special export path. Attach an `SvgRenderingBackend`, the scene renders into it, call
`toSvg()`:

```typescript
// Export what's currently on screen (same camera):
const svg = new SvgRenderingBackend(renderer, renderer.camera);
const output = svg.toSvg();
svg.destroy();

// Export full area regardless of current view (own camera):
const exportCam = new Camera(1920, 1080);
exportCam.fitToMapBounds(renderer.getAreaBounds());
const svg = new SvgRenderingBackend(renderer, exportCam);
const output = svg.toSvg();
svg.destroy();
```

Culling runs once via the export camera. The same `DrawCommand[]` that drives the Konva
canvas is read by the SVG layer node to produce SVG elements — no duplicate scene
construction, no separate pipeline.

---

## Responsibility table

| Concern | Owner |
|---|---|
| Map data, state mutations | `MapState` |
| Scene construction (rooms, exits, labels, grid) | `ScenePipeline` |
| Style / coordinate transform | `DrawingBackend` (decorator pattern) |
| Viewport state | `Camera` (independent, shareable) |
| Visibility culling | `CullingManager` (per camera + style pair) |
| Hit-testing | `CullingManager` via `MapRenderer.findRoomAt*()` |
| Output format | `LayerNode` implementation (Konva / SVG / PNG) |
| Overlays (position, highlights, paths) | `MapRenderer` orchestrates; same `DrawingBackend` |
| User interaction, animation | `InteractionHandler` (Konva-specific, optional) |
| Public API | `MapRenderer` (facade) |

---

## Key invariants

- **`SceneNode` is the only group type.** No `RecordingGroupNode`, no `SvgGroupNode`.
- **`DrawCommand[]` is the intermediate.** Style transforms are baked in at build time.
  Backends replay the same commands — they do not re-derive geometry.
- **`CullingManager` is not inside the backend.** It sits between camera + style and backend.
  Multiple backends sharing a camera share one culling pass.
- **Overlays use the same `DrawingBackend`.** They are automatically style-transformed,
  matching the scene geometry. They are not part of `SceneBuildResult`.
- **`SceneBuildResult` is format-agnostic.** It is the source of truth for hit-testing,
  selection, and rendering.
- **Output format is chosen at the `LayerNode` level, nowhere earlier.**
