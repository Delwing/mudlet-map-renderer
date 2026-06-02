# OffscreenCanvas rendering (Web Worker)

`mudlet-map-renderer` ships an **opt-in** rendering backend that runs the map's
per-frame rasterisation inside a Web Worker via
[`OffscreenCanvas`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas).
The default backend (Konva, on the main thread) is unchanged; you only get the
worker backend when you wire it in explicitly.

The goal is **main-thread responsiveness**. On a large map, every pan/zoom frame
rasterises thousands of shapes. With the default backend that work runs on the
main thread, so input handling, UI, and (in a real client) trigger/alias
processing all stall while the map redraws. The worker backend moves that work
off-thread, so the main thread stays free.

> It does **not** make a single frame's rasterisation faster in wall-clock time —
> it moves the work off the main thread. The win is responsiveness and
> parallelism, not raw throughput.

---

## Quick start

```ts
import { MapRenderer, MapReader, createSettings } from 'mudlet-map-renderer';
import { createOffscreenBackend } from 'mudlet-map-renderer/offscreen';

const container = document.getElementById('map') as HTMLDivElement;

const renderer = new MapRenderer(
  mapReader,
  createSettings(),
  container,
  createOffscreenBackend(container), // ← the only change vs the default
);

renderer.drawArea(42, 0);
renderer.setPosition(1234);
```

Everything else — `drawArea`, `setPosition`, `renderHighlight`, `renderPath`,
`setStyle`, settings, events, hit-testing — works exactly as with the default
backend.

> **Why is `container` passed twice?** `MapRenderer`'s `backendFactory` hook
> receives only the `MapState`, not the container, so `createOffscreenBackend`
> closes over the container you give it. Pass the same element to both.

### Capability-gated opt-in (recommended)

`OffscreenCanvas` + `transferControlToOffscreen` are widely supported, but if you
need to support older browsers, fall back to the default backend:

```ts
const supportsOffscreen =
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' &&
  typeof Worker !== 'undefined';

const renderer = new MapRenderer(
  mapReader,
  createSettings(),
  container,
  supportsOffscreen ? createOffscreenBackend(container) : undefined,
);
```

(When the offscreen backend is selected on a browser that lacks the APIs, it
simply does not render — there is no automatic fallback, by design, since
opting in is the caller's decision.)

---

## How it works

Konva's `Stage` is DOM-coupled and cannot run in a worker, so the worker backend
does **not** use Konva. It reuses the same engine-neutral pipeline the headless
exporters use:

```
ScenePipeline.buildScene → applyStyleToShapes → buildDrawCommands → renderToCanvas
```

`renderToCanvas` draws to any `CanvasRenderingContext2D`, including an
`OffscreenCanvas` 2D context.

### The main-thread / worker split

The split is dictated by two facts: hit-testing must stay synchronous, and the
scene build transitively touches the DOM (text measurement). So:

**Main thread** (`OffscreenCanvasBackend`)
- Owns the `Camera`, `CullingManager`, `HitTester`, events, and interaction.
- Runs `buildScene` on area / style / lens changes (**not** per frame), which
  keeps `hitTest()`, `getDrawnExits()` etc. synchronous and exact.
- Styles the shapes and ships plain, serialisable `Shape[]` to the worker.
- On camera changes, posts only the lightweight render transform + viewport.

**Worker** (`worker.ts`)
- Holds the latest styled scene + overlays.
- On each camera message: culls → builds draw commands → rasterises onto the
  transferred `OffscreenCanvas`. This is the per-frame hot path, now off-thread.
- Coalesces redraws onto one animation frame (only the latest camera matters).

```
                 main thread                          worker
   ┌───────────────────────────────────┐     ┌─────────────────────────┐
   drawArea/setStyle ─► buildScene      │     │                         │
                        (+ HitTester)   │     │                         │
                        style shapes ───┼────►│  store scene/overlays   │
   pan / zoom ───► camera change ───────┼────►│  cull → drawCommands    │
   click ───► HitTester.pick (sync)     │     │      → renderToCanvas   │
   getDrawnExits (sync)                 │     │  ──► OffscreenCanvas     │
   └───────────────────────────────────┘     └─────────────────────────┘
```

Because the scene build, styling, and hit index stay on the main thread, the
worker never needs the map data, Konva, or a DOM — and hit-testing,
`coordinateTransform`, and the drawn-geometry snapshots remain synchronous.

### Coordinate transforms

`Style.worldToScene` / `sceneToWorld` are closures and can't cross `postMessage`,
so the main thread flattens them into a serialisable transform: `'identity'` for
every flat style, or an affine matrix sampled at basis points for warping styles
(Isometric). The worker uses it for culling-bounds projection and grid layout.

### Bundling

The worker is **inlined** into the published bundle as a self-contained Blob-URL
worker, so consumers need no extra asset, worker loader, or bundler config — it
works the same under Vite, webpack, and plain `<script type=module>`. The worker
module graph imports only worker-safe code, so it never pulls Konva in.

---

## Feature support

| Feature | Supported | Notes |
|---|---|---|
| Rooms, exits, stubs, special exits | ✅ | |
| Grid, area name, area-exit labels | ✅ | |
| All visual styles (Parchment, Neon, Isometric, …) | ✅ | Styled on the main thread |
| Culling (`none` / `basic` / `indexed`) | ✅ | Runs in the worker |
| Position marker, highlights, paths | ✅ | |
| Current-room overlay (`highlightCurrentRoom`) | ✅ | |
| Scene overlays (`addSceneOverlay`) | ✅ | `render()` runs on the main thread |
| Image labels (`labelRenderMode: "image"`) | ✅ | Decoded in the worker via `createImageBitmap` |
| Ambient-light overlay | ✅ | Data-URL vignette decoded in the worker |
| **Live effects (`addLiveEffect`)** | ✅ | See below |
| Hit-testing (`hitTest`, `pick`) | ✅ | Synchronous, on the main thread |
| `getDrawnExits` / `getDrawnSpecialExits` / `getDrawnStubs` | ✅ | Synchronous |
| SVG / PNG export (`CanvasExporter`, `PngBytesExporter`, `exportSvg`) | ✅ | Headless — rebuilds from state, unaffected by the backend |
| **`MapRenderer.exportCanvas()`** | ⚠️ | Returns `undefined` — see [Limitations](#limitations) |

### Images and labels

The only reason image shapes were ever a problem is that `renderToCanvas`'s
default image loader uses `new Image()`, which doesn't exist in a worker. Since
image labels (`data:image/png;base64,…`) and the ambient-light vignette are data
URLs, the worker decodes them itself with `fetch` + `createImageBitmap`, caches
the resulting `ImageBitmap`, and redraws when it resolves (a sub-frame pop-in).
Remote, cross-origin image URLs would need CORS to decode in a worker; Mudlet's
data-URL labels are unaffected.

### Live effects

`addLiveEffect` (e.g. rain / weather) registers a Konva animation, which can't
run in a worker. The worker backend instead runs the effect on a **main-thread
Konva overlay stage composited above the worker's canvas**, with its transform
synced to the camera. The map still rasterises off-thread; only the (light)
effect animation is local, so the performance benefit is preserved.

```ts
renderer.addLiveEffect('rain', new RainEffect()); // works on both backends
```

---

## Limitations

- **`MapRenderer.exportCanvas()` returns `undefined`.** The live canvas is owned
  by the worker and can't be read synchronously on the main thread. Use either:
  - the headless exporters, which rebuild from state and are completely
    unaffected by the backend:
    ```ts
    import { PngBytesExporter, CanvasExporter } from 'mudlet-map-renderer';
    const png = renderer.export(new PngBytesExporter({ width: 1920, height: 1080 }));
    ```
  - or the backend's async live snapshot:
    ```ts
    import { OffscreenCanvasBackend } from 'mudlet-map-renderer/offscreen';
    if (renderer.backend instanceof OffscreenCanvasBackend) {
      const bitmap = await renderer.backend.captureViewport();
    }
    ```
- **No automatic fallback** on browsers without `OffscreenCanvas` — gate the
  opt-in yourself (see [Quick start](#capability-gated-opt-in-recommended)).
- **Warping-style culling** uses a sampled affine transform — exact for all
  built-in styles (identity + Isometric); a hypothetical non-affine style would
  cull imperfectly (geometry still renders correctly).

---

## When to use it

**Use it when the dominant interaction is panning/zooming a large map while the
main thread has other work to do** (game logic, UI, MUD output processing).

**Skip it for** small maps, export-heavy or static-render flows, or workloads
dominated by area-switching/style-changes rather than pan/zoom — there the
`postMessage` serialisation cost can outweigh the rasterisation saved.

### Measured results

A generated single-area grid under continuous panning (Chromium), comparing the
default Konva backend with the worker backend. *Main-thread stall* is the time
the main thread was blocked and unavailable to your code:

| | 4,900 rooms | | 10,000 rooms | |
|---|---|---|---|---|
| | Konva | Offscreen | Konva | Offscreen |
| Render FPS | 58 | 60 | 16 | 61 |
| Main-thread p95 stall | 18.8 ms | **0.1 ms** | 69.9 ms | **0.1 ms** |
| Main-thread avg stall | 17.8 ms | 0.0 ms | 45.4 ms | 0.0 ms |

At 4,900 rooms both hold ~60 FPS, but Konva consumes ~18.8 ms of the 16.7 ms
frame budget *on the main thread* (≈188× more stall). At 10,000 rooms Konva
collapses to 16 FPS with ~70 ms main-thread freezes, while the worker holds
61 FPS with the main thread essentially idle.

Reproduce locally with `yarn bench` (toggle Konva/Offscreen in the HUD) or
headlessly with `node bench/measure.mjs <size>`.

---

## API reference

### `createOffscreenBackend(container?, options?)`

Returns a backend factory for `MapRenderer`'s `backendFactory` parameter.

```ts
function createOffscreenBackend(
  container?: HTMLDivElement,
  options?: OffscreenBackendOptions,
): (state: MapState) => InteractiveBackend;
```

`OffscreenBackendOptions`:

| Option | Type | Description |
|---|---|---|
| `transport` | `WorkerTransport` | Pre-created worker transport (tests / custom workers). |
| `createTransport` | `() => WorkerTransport` | Lazily create the transport. Defaults to the inline worker. |
| `devicePixelRatio` | `number` | Override the DPR (defaults to `window.devicePixelRatio`). |

### `OffscreenCanvasBackend`

The concrete backend. Implements `InteractiveBackend`. Notable extra:

- `captureViewport(options?: { pixelRatio?: number }): Promise<ImageBitmap>` —
  async live-viewport snapshot (a worker round-trip), since `exportCanvas()`
  can't return the worker-owned canvas synchronously.

---

## See also

- [`docs/architecture.md`](./architecture.md) — the Shape → Style → DrawCommand
  pipeline the worker backend reuses.
