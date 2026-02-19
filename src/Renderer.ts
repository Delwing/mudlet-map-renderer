import Konva from "konva";
import ExitRenderer from "./ExitRenderer";
import type {ExitDrawData, ExitDrawLine, ExitDrawArrow, ExitDrawDoor} from "./ExitRenderer";
import MapReader from "./reader/MapReader";
import Exit from "./reader/Exit";
import Area from "./reader/Area";
import ExplorationArea from "./reader/ExplorationArea";
import PathRenderer from "./PathRenderer";

const defaultRoomSize = 0.6;
const defaultZoom = 75
const defaultLineWidth = 0.025;
const lineColor = 'rgb(225, 255, 225)';
const currentRoomColor = 'rgb(120, 72, 0)';

export type PerfSnapshot = {
    /** Total updateRoomCulling time in ms */
    cullingMs: number;
    /** renderGrid time in ms (subset of culling) */
    gridMs: number;
    /** Number of visible rooms after culling */
    visibleRooms: number;
    /** Total room count */
    totalRooms: number;
    /** Number of visible standalone exits */
    visibleExits: number;
    /** Estimated FPS based on time between culling calls */
    fps: number;
};

class PerfMonitor {
    private samples: PerfSnapshot[] = [];
    private lastCullingTime = 0;
    private readonly windowSize: number;
    private callback: ((avg: PerfSnapshot) => void) | null = null;

    constructor(windowSize = 60) {
        this.windowSize = windowSize;
    }

    setCallback(cb: ((avg: PerfSnapshot) => void) | null) {
        if (cb === this.callback) return;
        this.callback = cb;
        this.samples = [];
    }

    record(snapshot: PerfSnapshot) {
        if (!this.callback) return;
        this.samples.push(snapshot);
        if (this.samples.length >= this.windowSize) {
            this.flush();
        }
    }

    computeFps(): number {
        const now = performance.now();
        const dt = now - this.lastCullingTime;
        this.lastCullingTime = now;
        return dt > 0 ? 1000 / dt : 0;
    }

    private flush() {
        const n = this.samples.length;
        if (n === 0) return;
        const avg: PerfSnapshot = {
            cullingMs: 0,
            gridMs: 0,
            visibleRooms: 0,
            totalRooms: 0,
            visibleExits: 0,
            fps: 0,
        };
        for (const s of this.samples) {
            avg.cullingMs += s.cullingMs;
            avg.gridMs += s.gridMs;
            avg.visibleRooms += s.visibleRooms;
            avg.totalRooms += s.totalRooms;
            avg.visibleExits += s.visibleExits;
            avg.fps += s.fps;
        }
        avg.cullingMs /= n;
        avg.gridMs /= n;
        avg.visibleRooms = Math.round(avg.visibleRooms / n);
        avg.totalRooms = Math.round(avg.totalRooms / n);
        avg.visibleExits = Math.round(avg.visibleExits / n);
        avg.fps = Math.round(avg.fps);
        this.callback!(avg);
        this.samples = [];
    }
}

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type LabelRenderMode = "image" | "data";

export type CullingMode = "none" | "basic" | "indexed";

export type RoomShape = "rectangle" | "circle" | "roundedRectangle";

export type RoomContextMenuEventDetail = {
    roomId: number;
    position: { x: number; y: number };
};

export type ZoomChangeEventDetail = {
    zoom: number;
};

/**
 * Style configuration for the player position marker.
 * The player marker is a circle that indicates the current player position on the map.
 */
export type PlayerMarkerStyle = {
    /**
     * Hex color for the marker's stroke/border (e.g., "#00e5b2" for cyan-green).
     */
    strokeColor: string;

    /**
     * Opacity for the stroke/border (0.0 = fully transparent, 1.0 = fully opaque).
     */
    strokeAlpha: number;

    /**
     * Hex color for the marker's fill (e.g., "#00e5b2" for cyan-green).
     */
    fillColor: string;

    /**
     * Opacity for the fill (0.0 = fully transparent, 1.0 = fully opaque).
     * Setting this to 0 creates a hollow circle effect.
     */
    fillAlpha: number;

    /**
     * Width of the marker's stroke/border in map units (typically 0.01-0.3).
     */
    strokeWidth: number;

    /**
     * Size multiplier relative to the room size.
     * - 1.0 = marker radius equals room radius (matches room size)
     * - Values > 1.0 make the marker larger than rooms
     * - Values < 1.0 make the marker smaller than rooms
     *
     * Note: Room circles have radius = roomSize / 2, so sizeFactor is applied to that radius.
     */
    sizeFactor: number;

    /**
     * Dash pattern for the stroke as an array of [dash length, gap length].
     * Example: [0.05, 0.05] creates evenly spaced dashes.
     * Only applied when dashEnabled is true.
     */
    dash?: number[];

    /**
     * Whether to apply the dash pattern to the stroke.
     * When false, the stroke is solid regardless of the dash property.
     */
    dashEnabled: boolean;
};

/**
 * Global settings for map rendering.
 * All properties are static and can be modified at runtime to change the map's appearance and behavior.
 */
export class Settings {
    /**
     * Size of each room in map units (width/height for rectangles, diameter for circles).
     * Typical values: 0.2 - 1.5
     * Default: 0.6
     */
    static roomSize = defaultRoomSize;

    /**
     * Width of lines (exit connections, room borders) in map units.
     * Typical values: 0.01 - 0.1
     * Default: 0.025
     */
    static lineWidth = defaultLineWidth;

    /**
     * Color of exit connection lines as RGB string.
     * Example: 'rgb(225, 255, 225)' for light green
     */
    static lineColor = lineColor;

    /**
     * When true, map instantly jumps to the new position when the current room changes.
     * When false, the map smoothly animates/pans to the new position.
     * Default: false (animated movement)
     */
    static instantMapMove = false;

    /**
     * When true, highlights the current room and its exits with an overlay.
     * The overlay uses a semi-transparent color to emphasize the current position.
     * Default: true
     */
    static highlightCurrentRoom = true;

    /**
     * Legacy flag for enabling/disabling culling (prefer using cullingMode instead).
     * Default: true
     */
    static cullingEnabled = true;

    /**
     * Determines how off-screen elements are culled to improve performance:
     * - "none": No culling, render everything (worst performance, best accuracy)
     * - "basic": Classic viewport-based culling (good performance)
     * - "indexed": Spatial index culling using R-tree (best performance)
     *
     * Default: "indexed"
     */
    static cullingMode: CullingMode = "indexed";

    /**
     * Custom culling bounds for manually specifying the visible area.
     * When set, only elements within these bounds are rendered.
     * Format: { x, y, width, height } in map coordinates.
     * Default: null (uses viewport bounds)
     */
    static cullingBounds: { x: number; y: number; width: number; height: number } | null = null;

    /**
     * How to render room labels:
     * - "image": Render labels as images (better performance for many labels)
     * - "data": Render labels as text data (better for dynamic content)
     *
     * Default: "image"
     */
    static labelRenderMode: LabelRenderMode = "image";

    /**
     * When true, room labels have transparent backgrounds.
     * When false, labels have opaque backgrounds for better readability.
     */
    static transparentLabels: boolean;

    /**
     * Shape used to render rooms:
     * - "rectangle": Rooms are drawn as squares/rectangles
     * - "circle": Rooms are drawn as circles
     *
     * Default: "rectangle"
     *
     * Note: Exit line calculations automatically adjust based on room shape.
     * Circle mode calculates exact tangent points on the circle's edge.
     */
    static roomShape: RoomShape = "rectangle";

    /**
     * Style configuration for the player position marker.
     * See PlayerMarkerStyle type for details on individual properties.
     *
     * Default configuration creates a cyan-green dashed circle that's 1.7x the room size.
     */
    static playerMarker: PlayerMarkerStyle = {
        strokeColor: "#00e5b2",
        strokeAlpha: 1.0,
        fillColor: "#00e5b2",
        fillAlpha: 0.0,
        strokeWidth: 0.1,
        sizeFactor: 1.7,
        dash: [0.05, 0.05],
        dashEnabled: true,
    };

    /**
     * Whether to render a subtle background grid behind the map.
     * Default: false
     */
    static gridEnabled: boolean = false;

    /**
     * Grid line spacing in map units (1 = every integer coordinate).
     * Default: 1
     */
    static gridSize: number = 1;

    /**
     * Color of the grid lines as a CSS color string.
     * Default: 'rgba(255, 255, 255, 0.07)' (very subtle white)
     */
    static gridColor: string = 'rgba(255, 255, 255, 0.07)';

    /**
     * Width of grid lines in map units.
     * Default: 0.02
     */
    static gridLineWidth: number = 0.02;

    /**
     * Performance monitoring callback. When set, receives averaged PerfSnapshot
     * every 60 culling frames (~1 second at 60fps) with timing breakdowns.
     *
     * Set to a function to enable, null to disable.
     * Example: Settings.perfCallback = (stats) => console.log(stats);
     */
    static perfCallback: ((stats: PerfSnapshot) => void) | null = null;
}

type HighlightData = {
    color: string;
    area: number;
    z: number;
    shape?: Konva.Shape;
};

type RoomNodeEntry = { room: MapData.Room; group: Konva.Group };
type Bounds = { x: number; y: number; width: number; height: number };
type StandaloneExitEntry = { data: ExitDrawData; bounds: Bounds };

export class Renderer {

    private readonly stage: Konva.Stage;
    private readonly gridLayer: Konva.Layer;
    private readonly roomLayer: Konva.Layer;
    private readonly linkLayer: Konva.Layer;
    private readonly overlayLayer: Konva.Layer;
    private readonly positionLayer: Konva.Layer;
    private mapReader: MapReader;
    private exitRenderer: ExitRenderer;
    private pathRenderer: PathRenderer;
    private highlights: Map<number, HighlightData> = new Map();
    private currentArea?: number;
    private currentAreaInstance?: Area;
    private currentZIndex?: number;
    private currentAreaVersion?: number;
    private currentRoomId?: number;
    private positionRender?: Konva.Circle;
    private currentTransition?: Konva.Tween;
    private currentZoom: number = 1;
    private currentRoomOverlay: Konva.Node[] = [];
    private roomNodes: Map<number, RoomNodeEntry> = new Map();

    /** When true, resizing the container will center on the current room. Set to false for static map views. */
    public centerOnResize: boolean = true;
    private standaloneExitNodes: StandaloneExitEntry[] = [];
    private spatialBucketSize = 5;
    private roomSpatialIndex: Map<number, Set<RoomNodeEntry>> = new Map();
    private exitSpatialIndex: Map<number, Set<StandaloneExitEntry>> = new Map();
    private visibleRooms: Set<RoomNodeEntry> = new Set();
    private visibleStandaloneExitNodes: Set<StandaloneExitEntry> = new Set();
    // Reusable buffer Sets to avoid per-frame allocation in culling loop
    private bufferRoomSet: Set<RoomNodeEntry> = new Set();
    private bufferExitSet: Set<StandaloneExitEntry> = new Set();
    private bufferRoomCandidates: Set<RoomNodeEntry> = new Set();
    private bufferExitCandidates: Set<StandaloneExitEntry> = new Set();
    private standaloneExitBoundsRoomSize?: number;
    private cullingScheduled = false;
    private perfMonitor = new PerfMonitor();
    private exitBatchShape?: Konva.Shape;
    private visibleExitDrawData: ExitDrawData[] = [];
    private cachedGridBounds: { left: number; right: number; top: number; bottom: number } | null = null;

    constructor(container: HTMLDivElement, mapReader: MapReader) {
        this.stage = new Konva.Stage({
            container: container,
            width: container.clientWidth,
            height: container.clientHeight,
            draggable: true
        });
        window.addEventListener('resize', () => {
            this.onResize(container);
        })
        container.addEventListener('resize', () => {
            this.onResize(container);
        })
        this.gridLayer = new Konva.Layer({ listening: false, hitGraphEnabled: false });
        this.stage.add(this.gridLayer);
        this.linkLayer = new Konva.Layer({
            listening: false,
            hitGraphEnabled: false,
        });
        this.stage.add(this.linkLayer);
        this.roomLayer = new Konva.Layer({ hitGraphEnabled: false });
        this.stage.add(this.roomLayer);
        this.positionLayer = new Konva.Layer({
            listening: false,
            hitGraphEnabled: false,
        });
        this.stage.add(this.positionLayer);
        this.overlayLayer = new Konva.Layer({
            listening: false,
            hitGraphEnabled: false,
        })
        this.stage.add(this.overlayLayer);
        this.mapReader = mapReader;
        this.exitRenderer = new ExitRenderer(mapReader, this);
        this.pathRenderer = new PathRenderer(mapReader, this.overlayLayer);

        const scaleBy = 1.1;
        this.initScaling(scaleBy);

        this.stage.on('dragmove', () => this.scheduleRoomCulling());
        this.stage.on('dragend', () => this.scheduleRoomCulling());
        this.initRoomHitDetection();
    }

    private clientToMapPoint(clientX: number, clientY: number) {
        const container = this.stage.container();
        const rect = container.getBoundingClientRect();
        const stageX = clientX - rect.left;
        const stageY = clientY - rect.top;
        const scale = this.stage.scaleX();
        if (!scale) return null;
        const pos = this.stage.position();
        return {
            x: (stageX - pos.x) / scale,
            y: (stageY - pos.y) / scale,
        };
    }

    private findRoomAtClientPoint(clientX: number, clientY: number): MapData.Room | null {
        const mapPoint = this.clientToMapPoint(clientX, clientY);
        if (!mapPoint) return null;
        const halfSize = Settings.roomSize / 2;
        // Check the single bucket at this point
        const key = this.getBucketKey(
            Math.floor(mapPoint.x / this.spatialBucketSize),
            Math.floor(mapPoint.y / this.spatialBucketSize),
        );
        const bucket = this.roomSpatialIndex.get(key);
        if (!bucket) return null;
        for (const entry of bucket) {
            const dx = mapPoint.x - entry.room.x;
            const dy = mapPoint.y - entry.room.y;
            if (dx >= -halfSize && dx <= halfSize && dy >= -halfSize && dy <= halfSize) {
                return entry.room;
            }
        }
        return null;
    }

    private initRoomHitDetection() {
        const container = this.stage.container();
        let hoveredRoom: MapData.Room | null = null;

        container.addEventListener('mousemove', (e) => {
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room !== hoveredRoom) {
                hoveredRoom = room;
                container.style.cursor = room ? 'pointer' : 'auto';
            }
        });

        container.addEventListener('mouseleave', () => {
            hoveredRoom = null;
            container.style.cursor = 'auto';
        });

        container.addEventListener('contextmenu', (e) => {
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room) {
                e.preventDefault();
                this.emitRoomContextEvent(room.id, e.clientX, e.clientY);
            }
        });

        // Long-press support for touch
        let longPressTimeout: number | undefined;
        let longPressStart: { clientX: number; clientY: number } | undefined;
        let stageDraggableBeforeLongPress: boolean | undefined;

        const restoreStageDraggable = () => {
            if (stageDraggableBeforeLongPress !== undefined) {
                this.stage.draggable(stageDraggableBeforeLongPress);
                stageDraggableBeforeLongPress = undefined;
            }
        };

        const clearLongPress = () => {
            if (longPressTimeout !== undefined) {
                window.clearTimeout(longPressTimeout);
                longPressTimeout = undefined;
            }
            longPressStart = undefined;
            restoreStageDraggable();
        };

        container.addEventListener('touchstart', (e) => {
            clearLongPress();
            if (e.touches.length > 1) return;
            const touch = e.touches[0];
            if (!touch) return;
            const room = this.findRoomAtClientPoint(touch.clientX, touch.clientY);
            if (!room) return;
            longPressStart = { clientX: touch.clientX, clientY: touch.clientY };
            stageDraggableBeforeLongPress = this.stage.draggable();
            this.stage.draggable(false);
            longPressTimeout = window.setTimeout(() => {
                if (longPressStart) {
                    const roomAtPoint = this.findRoomAtClientPoint(longPressStart.clientX, longPressStart.clientY);
                    if (roomAtPoint) {
                        this.emitRoomContextEvent(roomAtPoint.id, longPressStart.clientX, longPressStart.clientY);
                    }
                }
                clearLongPress();
            }, 500);
        }, { passive: true });

        container.addEventListener('touchend', () => clearLongPress(), { passive: true });
        container.addEventListener('touchcancel', () => clearLongPress(), { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!longPressStart) return;
            const touch = e.touches[0];
            if (!touch) {
                clearLongPress();
                return;
            }
            const dx = touch.clientX - longPressStart.clientX;
            const dy = touch.clientY - longPressStart.clientY;
            if (dx * dx + dy * dy > 100) {
                const wasDraggable = stageDraggableBeforeLongPress;
                clearLongPress();
                if (wasDraggable) {
                    this.stage.startDrag();
                }
            }
        }, { passive: true });
    }

    private onResize(container: HTMLDivElement) {
        this.stage.width(container.clientWidth);
        this.stage.height(container.clientHeight);
        if (this.centerOnResize && this.currentRoomId) {
            this.centerOnRoom(this.mapReader.getRoom(this.currentRoomId)!, false);
        }
        this.stage.batchDraw();
        this.scheduleRoomCulling();
    }

    private initScaling(scaleBy: number) {
        let lastPinchDistance: number | undefined;
        let dragStopped = false;
        let multiTouchActive = false;

        this.stage.on('touchstart', (e) => {
            const touches = e.evt.touches;
            if (touches && touches.length > 1) {
                multiTouchActive = true;
                if (this.stage.isDragging()) {
                    this.stage.stopDrag();
                    dragStopped = true;
                }
                this.stage.draggable(false);
            } else {
                multiTouchActive = false;
                this.stage.draggable(true);
            }
        });

        this.stage.on('touchend touchcancel', (e) => {
            lastPinchDistance = undefined;
            const touches = e.evt.touches;
            if (!touches || touches.length <= 1) {
                multiTouchActive = false;
                this.stage.draggable(true);
            }
        });

        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();

            const oldScale = this.stage.scaleX();
            const pointer = this.stage.getPointerPosition();
            if (!pointer) {
                return;
            }

            const mousePointTo = {
                x: (pointer.x - this.stage.x()) / oldScale,
                y: (pointer.y - this.stage.y()) / oldScale,
            };

            let direction = e.evt.deltaY > 0 ? -1 : 1;

            if (e.evt.ctrlKey) {
                direction = -direction;
            }

            const newZoom = direction > 0 ? this.currentZoom * scaleBy : this.currentZoom / scaleBy;
            const newScale = newZoom * defaultZoom;
            const zoomChanged = this.setZoom(newZoom);

            const newPos = {
                x: pointer.x - mousePointTo.x * newScale,
                y: pointer.y - mousePointTo.y * newScale,
            };

            this.stage.position(newPos);

            this.scheduleRoomCulling();

            if (zoomChanged) {
                this.emitZoomChangeEvent();
            }
        });

        this.stage.on('touchmove', (e) => {
            const touches = e.evt.touches;
            const touch1 = touches?.[0];
            const touch2 = touches?.[1];

            if (!touch2) {
                if (multiTouchActive) {
                    multiTouchActive = false;
                    this.stage.draggable(true);
                }
            }

            if (touch1 && !touch2 && dragStopped && !this.stage.isDragging()) {
                this.stage.startDrag();
                dragStopped = false;
            }

            if (!touch1 || !touch2) {
                lastPinchDistance = undefined;
                return;
            }

            e.evt.preventDefault();

            if (this.stage.isDragging()) {
                this.stage.stopDrag();
                dragStopped = true;
            }

            if (!multiTouchActive) {
                multiTouchActive = true;
                this.stage.draggable(false);
            }

            const rect = this.stage.container().getBoundingClientRect();
            const p1 = {
                x: touch1.clientX - rect.left,
                y: touch1.clientY - rect.top,
            };
            const p2 = {
                x: touch2.clientX - rect.left,
                y: touch2.clientY - rect.top,
            };

            const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);

            if (lastPinchDistance === undefined) {
                lastPinchDistance = distance;
                return;
            }

            if (lastPinchDistance === 0) {
                return;
            }

            const oldScale = this.stage.scaleX();
            const stageX = this.stage.x();
            const stageY = this.stage.y();

            const centerPointer = {
                x: this.stage.width() / 2,
                y: this.stage.height() / 2,
            };

            const centerMapPoint = {
                x: (centerPointer.x - stageX) / oldScale,
                y: (centerPointer.y - stageY) / oldScale,
            };

            const newZoom = this.currentZoom * (distance / lastPinchDistance);

            const zoomChanged = this.setZoom(newZoom);

            const newScale = this.stage.scaleX();
            const newPos = {
                x: centerPointer.x - centerMapPoint.x * newScale,
                y: centerPointer.y - centerMapPoint.y * newScale,
            };

            this.stage.position(newPos);
            this.stage.batchDraw();

            this.scheduleRoomCulling();

            lastPinchDistance = distance;

            if (zoomChanged) {
                this.emitZoomChangeEvent();
            }
        });
    }

    drawArea(id: number, zIndex: number) {
        const area = this.mapReader.getArea(id);
        if (!area) {
            return;
        }
        const plane = area.getPlane(zIndex);
        if (!plane) {
            return;
        }
        this.currentArea = id;
        this.currentAreaInstance = area;
        this.currentZIndex = zIndex;
        this.currentAreaVersion = area.getVersion();
        this.clearCurrentRoomOverlay();
        this.gridLayer.destroyChildren();
        this.invalidateGridCache();
        this.roomLayer.destroyChildren();
        this.linkLayer.destroyChildren();
        this.roomNodes.clear();
        this.standaloneExitNodes = [];
        this.standaloneExitBoundsRoomSize = undefined;
        this.roomSpatialIndex.clear();
        this.exitSpatialIndex.clear();
        this.visibleRooms.clear();
        this.visibleStandaloneExitNodes.clear();
        this.visibleExitDrawData.length = 0;
        this.exitBatchShape = undefined;
        this.spatialBucketSize = this.computeSpatialBucketSize();

        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});

        this.renderGrid();
        this.renderLabels(plane.getLabels());
        this.renderExits(area.getLinkExits(zIndex));
        this.renderRooms(plane.getRooms() ?? []);
        this.refreshHighlights();
        this.stage.batchDraw();
        this.scheduleRoomCulling();
    }

    private computeSpatialBucketSize() {
        return Math.max(Settings.roomSize * 10, 5);
    }

    private getBucketKey(bucketX: number, bucketY: number) {
        // Numeric hash avoids string allocation. Uses a large prime to separate axes.
        return bucketX * 1000003 + bucketY;
    }

    private forEachBucket(minX: number, minY: number, maxX: number, maxY: number, callback: (key: number) => void) {
        const bucketSize = this.spatialBucketSize;
        const safeMinX = Math.min(minX, maxX);
        const safeMaxX = Math.max(minX, maxX);
        const safeMinY = Math.min(minY, maxY);
        const safeMaxY = Math.max(minY, maxY);
        const minBucketX = Math.floor(safeMinX / bucketSize);
        const maxBucketX = Math.floor(safeMaxX / bucketSize);
        const minBucketY = Math.floor(safeMinY / bucketSize);
        const maxBucketY = Math.floor(safeMaxY / bucketSize);

        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
            for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
                callback(this.getBucketKey(bucketX, bucketY));
            }
        }
    }

    private addRoomToSpatialIndex(entry: RoomNodeEntry) {
        const halfSize = Settings.roomSize / 2;
        const minX = entry.room.x - halfSize;
        const maxX = entry.room.x + halfSize;
        const minY = entry.room.y - halfSize;
        const maxY = entry.room.y + halfSize;

        this.forEachBucket(minX, minY, maxX, maxY, key => {
            let bucket = this.roomSpatialIndex.get(key);
            if (!bucket) {
                bucket = new Set();
                this.roomSpatialIndex.set(key, bucket);
            }
            bucket.add(entry);
        });
    }

    private addStandaloneExitToSpatialIndex(entry: StandaloneExitEntry) {
        const {bounds} = entry;
        const minX = bounds.x;
        const maxX = bounds.x + bounds.width;
        const minY = bounds.y;
        const maxY = bounds.y + bounds.height;

        this.forEachBucket(minX, minY, maxX, maxY, key => {
            let bucket = this.exitSpatialIndex.get(key);
            if (!bucket) {
                bucket = new Set();
                this.exitSpatialIndex.set(key, bucket);
            }
            bucket.add(entry);
        });
    }

    private collectRoomCandidates(minX: number, minY: number, maxX: number, maxY: number) {
        const result = this.bufferRoomCandidates;
        result.clear();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            const bucket = this.roomSpatialIndex.get(key);
            bucket?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private collectStandaloneExitCandidates(minX: number, minY: number, maxX: number, maxY: number) {
        const result = this.bufferExitCandidates;
        result.clear();
        this.forEachBucket(minX, minY, maxX, maxY, key => {
            const bucket = this.exitSpatialIndex.get(key);
            bucket?.forEach(entry => result.add(entry));
        });
        return result;
    }

    private refreshStandaloneExitBoundsIfNeeded() {
        if (this.standaloneExitBoundsRoomSize === Settings.roomSize) {
            return;
        }

        // Rebuild spatial index from stored bounds
        this.exitSpatialIndex.clear();
        this.standaloneExitNodes.forEach(entry => {
            this.addStandaloneExitToSpatialIndex(entry);
        });
        this.standaloneExitBoundsRoomSize = Settings.roomSize;
    }

    private emitRoomContextEvent(roomId: number, clientX: number, clientY: number) {
        const container = this.stage.container();
        const bounds = container.getBoundingClientRect();
        const detail: RoomContextMenuEventDetail = {
            roomId,
            position: {
                x: clientX - bounds.left,
                y: clientY - bounds.top,
            },
        };
        const event = new CustomEvent<RoomContextMenuEventDetail>('roomcontextmenu', {detail});
        container.dispatchEvent(event);
    }

    private emitZoomChangeEvent() {
        const event = new CustomEvent<ZoomChangeEventDetail>('zoom', {
            detail: {zoom: this.currentZoom},
        });
        this.stage.container().dispatchEvent(event);
    }

    setZoom(zoom: number): boolean {
        if (this.currentZoom === zoom) {
            return false;
        }

        this.currentZoom = zoom;
        this.stage.scale({x: defaultZoom * zoom, y: defaultZoom * zoom});
        this.scheduleRoomCulling();

        return true;
    }

    /**
     * Zooms relative to the center of the viewport.
     * Use this for UI controls (buttons, menus) where there's no mouse position.
     */
    zoomToCenter(zoom: number): boolean {
        if (this.currentZoom === zoom) {
            return false;
        }

        const oldScale = this.stage.scaleX();
        const stageWidth = this.stage.width();
        const stageHeight = this.stage.height();

        // Center point in screen coordinates
        const centerX = stageWidth / 2;
        const centerY = stageHeight / 2;

        // Convert center to map coordinates using old scale
        const centerMapPoint = {
            x: (centerX - this.stage.x()) / oldScale,
            y: (centerY - this.stage.y()) / oldScale,
        };

        // Apply new zoom
        this.currentZoom = zoom;
        const newScale = defaultZoom * zoom;
        this.stage.scale({ x: newScale, y: newScale });

        // Calculate new position to keep center point at center
        const newPos = {
            x: centerX - centerMapPoint.x * newScale,
            y: centerY - centerMapPoint.y * newScale,
        };

        this.stage.position(newPos);
        this.stage.batchDraw();
        this.scheduleRoomCulling();

        return true;
    }

    getZoom() {
        return this.currentZoom;
    }

    setCullingMode(mode: CullingMode) {
        Settings.cullingMode = mode;
        Settings.cullingEnabled = mode !== "none";
        this.scheduleRoomCulling();
    }

    getCullingMode() {
        return Settings.cullingMode;
    }

    getCurrentArea() {
        return this.currentArea ? this.mapReader.getArea(this.currentArea) : undefined
    }

    /**
     * Refreshes the current room overlay to reflect any changes to Settings.
     * Call this after modifying Settings properties (like roomSize, roomShape, lineWidth, etc.)
     * to update the visual appearance of the current room and its exits without changing position.
     */
    refreshCurrentRoomOverlay() {
        if (this.currentRoomId !== undefined) {
            const room = this.mapReader.getRoom(this.currentRoomId);
            if (room) {
                this.updateCurrentRoomOverlay(room);
            }
        }
    }

    /**
     * Completely refreshes the map to reflect changes to Settings.
     * This re-renders the entire current area and updates the player position marker.
     * Call this after changing Settings properties like roomSize, roomShape, lineWidth, etc.
     *
     * Note: This is more expensive than refreshCurrentRoomOverlay() but ensures everything is updated.
     */
    refresh() {
        if (this.currentRoomId !== undefined && this.currentArea !== undefined && this.currentZIndex !== undefined) {
            // Re-render the current area
            this.drawArea(this.currentArea, this.currentZIndex);

            // Update the player position (which also updates the overlay)
            this.setPosition(this.currentRoomId);
        }
    }

    /**
     * Updates the player position marker without centering the view.
     * Use this when you want to show where the player is without moving the viewport.
     */
    updatePositionMarker(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;

        // Only show marker if player is in the currently displayed area/level
        if (room.area !== this.currentArea || room.z !== this.currentZIndex) {
            // Hide the marker if player is not on current area/level
            if (this.positionRender) {
                this.positionRender.hide();
                this.positionLayer.batchDraw();
            }
            return;
        }

        this.currentRoomId = roomId;
        this.updateCurrentRoomOverlay(room);

        const strokeColor = hexToRgba(Settings.playerMarker.strokeColor, Settings.playerMarker.strokeAlpha);
        const fillColor = hexToRgba(Settings.playerMarker.fillColor, Settings.playerMarker.fillAlpha);
        const markerRadius = (Settings.roomSize / 2) * Settings.playerMarker.sizeFactor;

        if (!this.positionRender) {
            this.positionRender = new Konva.Circle({
                x: room.x,
                y: room.y,
                radius: markerRadius,
                stroke: strokeColor,
                fill: fillColor,
                strokeWidth: Settings.playerMarker.strokeWidth,
                dash: Settings.playerMarker.dash,
                dashEnabled: Settings.playerMarker.dashEnabled,
            })
            this.positionLayer.add(this.positionRender);
        } else {
            this.positionRender.position({ x: room.x, y: room.y });
            this.positionRender.radius(markerRadius);
            this.positionRender.stroke(strokeColor);
            this.positionRender.fill(fillColor);
            this.positionRender.strokeWidth(Settings.playerMarker.strokeWidth);
            this.positionRender.dash(Settings.playerMarker.dash ?? []);
            this.positionRender.dashEnabled(Settings.playerMarker.dashEnabled);
            this.positionRender.show();
        }
        this.positionLayer.batchDraw();
    }

    setPosition(roomId: number, center: boolean = true) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        let instant = this.currentArea !== room.area || this.currentZIndex !== room.z
        if (
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        ) {
            this.drawArea(room.area, room.z);
        }
        if (center) {
            this.centerOnRoom(room, instant);
        } else {
            this.currentRoomId = roomId;
        }
        this.updateCurrentRoomOverlay(room);

        const strokeColor = hexToRgba(Settings.playerMarker.strokeColor, Settings.playerMarker.strokeAlpha);
        const fillColor = hexToRgba(Settings.playerMarker.fillColor, Settings.playerMarker.fillAlpha);
        // Player marker radius: at sizeFactor 1.0, it should match room size
        // Room circles have radius = roomSize / 2, so we use (roomSize / 2) * sizeFactor
        const markerRadius = (Settings.roomSize / 2) * Settings.playerMarker.sizeFactor;

        if (!this.positionRender) {
            this.positionRender = new Konva.Circle({
                x: room.x,
                y: room.y,
                radius: markerRadius,
                stroke: strokeColor,
                fill: fillColor,
                strokeWidth: Settings.playerMarker.strokeWidth,
                dash: Settings.playerMarker.dash,
                dashEnabled: Settings.playerMarker.dashEnabled,
            })
            this.positionLayer.add(this.positionRender);
        } else {
            // Update the marker style when settings change
            this.positionRender.radius(markerRadius);
            this.positionRender.stroke(strokeColor);
            this.positionRender.fill(fillColor);
            this.positionRender.strokeWidth(Settings.playerMarker.strokeWidth);
            this.positionRender.dash(Settings.playerMarker.dash ?? []);
            this.positionRender.dashEnabled(Settings.playerMarker.dashEnabled);
        }
    }

    centerOn(roomId: number) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) return;
        const area = this.mapReader.getArea(room.area);
        const areaVersion = area?.getVersion();
        let instant = this.currentArea !== room.area || this.currentZIndex !== room.z
        if (
            this.currentArea !== room.area ||
            this.currentZIndex !== room.z ||
            (areaVersion !== undefined && this.currentAreaVersion !== areaVersion) ||
            (area !== undefined && this.currentAreaInstance !== area)
        ) {
            this.drawArea(room.area, room.z);
        }
        this.centerOnRoomView(room, instant);
    }

    renderPath(locations: number[], color?: string) {
        return this.pathRenderer.renderPath(locations, this.currentArea, this.currentZIndex, color);
    }

    clearPaths() {
        this.pathRenderer.clearPaths();
    }

    renderHighlight(roomId: number, color: string) {
        const room = this.mapReader.getRoom(roomId);
        if (!room) {
            return;
        }

        const existing = this.highlights.get(roomId);
        if (existing?.shape) {
            existing.shape.destroy();
            delete existing.shape;
        }

        const highlightData: HighlightData = {color, area: room.area, z: room.z};

        this.highlights.set(roomId, highlightData);

        if (room.area === this.currentArea && room.z === this.currentZIndex) {
            const shape = this.createHighlightShape(room, color);
            this.overlayLayer.add(shape);
            highlightData.shape = shape;
            this.overlayLayer.batchDraw();
            return shape;
        }

        return highlightData.shape;
    }

    clearHighlights() {
        this.highlights.forEach(({shape}) => shape?.destroy());
        this.highlights.clear();
        this.overlayLayer.batchDraw();
    }

    private refreshHighlights() {
        this.highlights.forEach((highlight, roomId) => {
            highlight.shape?.destroy();
            delete highlight.shape;

            if (highlight.area !== this.currentArea || highlight.z !== this.currentZIndex) {
                return;
            }

            const room = this.mapReader.getRoom(roomId);
            if (!room) {
                return;
            }

            const shape = this.createHighlightShape(room, highlight.color);
            this.overlayLayer.add(shape);
            highlight.shape = shape;
        });

        this.overlayLayer.batchDraw();
    }

    private createHighlightShape(room: MapData.Room, color: string) {
        const highlightFactor = 1.5;
        return Settings.roomShape === "circle"
            ? new Konva.Circle({
                x: room.x,
                y: room.y,
                radius: Settings.roomSize / 2 * highlightFactor,
                stroke: color,
                strokeWidth: 0.1,
                dash: [0.05, 0.05],
                dashEnabled: true,
                listening: false,
            })
            : new Konva.Rect({
                x: room.x - Settings.roomSize / 2 * highlightFactor,
                y: room.y - Settings.roomSize / 2 * highlightFactor,
                width: Settings.roomSize * highlightFactor,
                height: Settings.roomSize * highlightFactor,
                stroke: color,
                strokeWidth: 0.1,
                dash: [0.05, 0.05],
                dashEnabled: true,
                cornerRadius: Settings.roomShape === "roundedRectangle" ? Settings.roomSize * highlightFactor * 0.2 : 0,
                listening: false,
            });
    }

    private centerOnRoom(room: MapData.Room, instant: boolean = false) {
        this.currentRoomId = room.id;
        const roomCenter = {x: room.x, y: room.y};

        this.positionRender?.position(room)

        const abs = this.stage.getAbsoluteTransform()
        const screenPoint = abs.point(roomCenter);

        const target = {
            x: this.stage.width() / 2,
            y: this.stage.height() / 2,
        };

        const dx = target.x - screenPoint.x;
        const dy = target.y - screenPoint.y;

        if (this.currentTransition) {
            this.currentTransition.pause()
            this.currentTransition.destroy()
            delete this.currentTransition;
        }

        if (instant || Settings.instantMapMove) {
            this.stage.position({
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
            })
            this.scheduleRoomCulling();
        } else {
            this.currentTransition = new Konva.Tween({
                node: this.stage,
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
                duration: 0.2,
                easing: Konva.Easings.EaseInOut,
                onUpdate: () => this.scheduleRoomCulling(),
                onFinish: () => this.scheduleRoomCulling(),
            })
            this.currentTransition.play()
        }
    }

    private centerOnRoomView(room: MapData.Room, instant: boolean = false) {
        const roomCenter = {x: room.x, y: room.y};

        const abs = this.stage.getAbsoluteTransform()
        const screenPoint = abs.point(roomCenter);

        const target = {
            x: this.stage.width() / 2,
            y: this.stage.height() / 2,
        };

        const dx = target.x - screenPoint.x;
        const dy = target.y - screenPoint.y;

        if (this.currentTransition) {
            this.currentTransition.pause()
            this.currentTransition.destroy()
            delete this.currentTransition;
        }

        if (instant || Settings.instantMapMove) {
            this.stage.position({
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
            })
            this.scheduleRoomCulling();
        } else {
            this.currentTransition = new Konva.Tween({
                node: this.stage,
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
                duration: 0.2,
                easing: Konva.Easings.EaseInOut,
                onUpdate: () => this.scheduleRoomCulling(),
                onFinish: () => this.scheduleRoomCulling(),
            })
            this.currentTransition.play()
        }
    }

    private renderRooms(rooms: MapData.Room[]) {
        rooms.forEach(room => {
            const roomRender = new Konva.Group({
                x: room.x - Settings.roomSize / 2,
                y: room.y - Settings.roomSize / 2,
                listening: false,
            });

            const fillColor = this.mapReader.getColorValue(room.env);
            const strokeColor = Settings.lineColor;

            const roomShape = Settings.roomShape === "circle"
                ? new Konva.Circle({
                    x: Settings.roomSize / 2,
                    y: Settings.roomSize / 2,
                    radius: Settings.roomSize / 2,
                    fill: fillColor,
                    strokeWidth: Settings.lineWidth,
                    stroke: strokeColor,
                    perfectDrawEnabled: false,
                    listening: false,
                })
                : new Konva.Rect({
                    x: 0,
                    y: 0,
                    width: Settings.roomSize,
                    height: Settings.roomSize,
                    fill: fillColor,
                    strokeWidth: Settings.lineWidth,
                    stroke: strokeColor,
                    cornerRadius: Settings.roomShape === "roundedRectangle" ? Settings.roomSize * 0.2 : 0,
                    perfectDrawEnabled: false,
                    listening: false,
                });

            roomRender.add(roomShape);

            this.renderSymbol(room, roomRender);
            this.roomLayer.add(roomRender);

            // Special exits stored as draw data for batch rendering
            this.exitRenderer.renderSpecialExits(room).forEach(render => {
                this.linkLayer.add(render);
            })
            // Stubs and inner exits nested in room group for automatic culling
            const gx = room.x - Settings.roomSize / 2;
            const gy = room.y - Settings.roomSize / 2;
            this.exitRenderer.renderStubs(room).forEach(render => {
                // Offset absolute points to group-relative coordinates
                const pts = render.points();
                for (let i = 0; i < pts.length; i += 2) {
                    pts[i] -= gx;
                    pts[i + 1] -= gy;
                }
                render.points(pts);
                roomRender.add(render);
            })
            this.exitRenderer.renderInnerExits(room).forEach(render => {
                render.position({ x: -gx, y: -gy });
                roomRender.add(render);
            })

            const entry: RoomNodeEntry = {room, group: roomRender};
            this.roomNodes.set(room.id, entry);
            this.addRoomToSpatialIndex(entry);
        })
    }

    private scheduleRoomCulling() {
        if (this.cullingScheduled) {
            return;
        }
        this.cullingScheduled = true;
        window.requestAnimationFrame(() => {
            this.cullingScheduled = false;
            this.updateRoomCulling();
        });
    }

    private updateRoomCulling() {
        if (this.roomNodes.size === 0 && this.standaloneExitNodes.length === 0) {
            return;
        }

        const scale = this.stage.scaleX();
        if (!scale) {
            return;
        }

        this.syncPerfMonitor();
        const perfStart = Settings.perfCallback ? performance.now() : 0;

        const stagePosition = this.stage.position();
        const halfSize = Settings.roomSize / 2;
        const bounds = Settings.cullingBounds;
        const viewportMinX = bounds ? bounds.x : 0;
        const viewportMaxX = bounds ? bounds.x + bounds.width : this.stage.width();
        const viewportMinY = bounds ? bounds.y : 0;
        const viewportMaxY = bounds ? bounds.y + bounds.height : this.stage.height();
        const minViewportX = Math.min(viewportMinX, viewportMaxX);
        const maxViewportX = Math.max(viewportMinX, viewportMaxX);
        const minViewportY = Math.min(viewportMinY, viewportMaxY);
        const maxViewportY = Math.max(viewportMinY, viewportMaxY);
        const minX = (minViewportX - stagePosition.x) / scale;
        const maxX = (maxViewportX - stagePosition.x) / scale;
        const minY = (minViewportY - stagePosition.y) / scale;
        const maxY = (maxViewportY - stagePosition.y) / scale;

        let roomLayerNeedsDraw = false;
        let linkLayerNeedsDraw = false;

        const mode: CullingMode = Settings.cullingEnabled ? Settings.cullingMode ?? "indexed" : "none";
        const searchMinX = minX - halfSize;
        const searchMaxX = maxX + halfSize;
        const searchMinY = minY - halfSize;
        const searchMaxY = maxY + halfSize;

        this.refreshStandaloneExitBoundsIfNeeded();

        if (mode === "none") {
            this.roomNodes.forEach(entry => {
                if (!entry.group.visible()) {
                    entry.group.visible(true);
                    roomLayerNeedsDraw = true;
                }
            });

            // All exits visible in "none" mode
            if (this.visibleExitDrawData.length !== this.standaloneExitNodes.length) {
                this.visibleExitDrawData.length = 0;
                for (const entry of this.standaloneExitNodes) {
                    this.visibleExitDrawData.push(entry.data);
                }
                linkLayerNeedsDraw = true;
            }

            if (roomLayerNeedsDraw) {
                this.roomLayer.batchDraw();
            }
            if (linkLayerNeedsDraw) {
                this.linkLayer.batchDraw();
            }

            this.visibleRooms.clear();
            this.roomNodes.forEach(entry => this.visibleRooms.add(entry));
            this.visibleStandaloneExitNodes.clear();
            this.standaloneExitNodes.forEach(entry => this.visibleStandaloneExitNodes.add(entry));
            return;
        }

        if (mode === "basic") {
            const nextVisibleRooms = this.bufferRoomSet;
            nextVisibleRooms.clear();

            this.roomNodes.forEach(entry => {
                const roomMinX = entry.room.x - halfSize;
                const roomMaxX = entry.room.x + halfSize;
                const roomMinY = entry.room.y - halfSize;
                const roomMaxY = entry.room.y + halfSize;

                const isVisible =
                    roomMaxX >= minX &&
                    roomMinX <= maxX &&
                    roomMaxY >= minY &&
                    roomMinY <= maxY;

                if (entry.group.visible() !== isVisible) {
                    entry.group.visible(isVisible);
                    roomLayerNeedsDraw = true;
                }

                if (isVisible) {
                    nextVisibleRooms.add(entry);
                }
            });

            const nextVisibleStandaloneExitNodes = this.bufferExitSet;
            nextVisibleStandaloneExitNodes.clear();
            let exitSetChanged = false;

            this.standaloneExitNodes.forEach(entry => {
                const {bounds} = entry;
                const nodeMinX = bounds.x;
                const nodeMaxX = bounds.x + bounds.width;
                const nodeMinY = bounds.y;
                const nodeMaxY = bounds.y + bounds.height;

                const isVisible =
                    nodeMaxX >= minX &&
                    nodeMinX <= maxX &&
                    nodeMaxY >= minY &&
                    nodeMinY <= maxY;

                if (isVisible) {
                    nextVisibleStandaloneExitNodes.add(entry);
                    if (!this.visibleStandaloneExitNodes.has(entry)) exitSetChanged = true;
                }
            });

            if (!exitSetChanged && nextVisibleStandaloneExitNodes.size !== this.visibleStandaloneExitNodes.size) {
                exitSetChanged = true;
            }

            // Swap buffers
            this.bufferRoomSet = this.visibleRooms;
            this.visibleRooms = nextVisibleRooms;
            this.bufferExitSet = this.visibleStandaloneExitNodes;
            this.visibleStandaloneExitNodes = nextVisibleStandaloneExitNodes;

            if (exitSetChanged) {
                this.visibleExitDrawData.length = 0;
                this.visibleStandaloneExitNodes.forEach(e => this.visibleExitDrawData.push(e.data));
                linkLayerNeedsDraw = true;
            }

            if (roomLayerNeedsDraw) {
                this.roomLayer.batchDraw();
            }
            if (linkLayerNeedsDraw) {
                this.linkLayer.batchDraw();
            }

            return;
        }

        // "indexed" mode: use spatial index to find candidates
        const roomCandidates = this.collectRoomCandidates(searchMinX, searchMinY, searchMaxX, searchMaxY);
        const nextVisibleRooms = this.bufferRoomSet;
        nextVisibleRooms.clear();

        roomCandidates.forEach(entry => {
            const roomMinX = entry.room.x - halfSize;
            const roomMaxX = entry.room.x + halfSize;
            const roomMinY = entry.room.y - halfSize;
            const roomMaxY = entry.room.y + halfSize;

            const isVisible =
                roomMaxX >= minX &&
                roomMinX <= maxX &&
                roomMaxY >= minY &&
                roomMinY <= maxY;

            if (entry.group.visible() !== isVisible) {
                entry.group.visible(isVisible);
                roomLayerNeedsDraw = true;
            }

            if (isVisible) {
                nextVisibleRooms.add(entry);
            }
        });

        // Hide rooms that were visible but are no longer candidates
        this.visibleRooms.forEach(entry => {
            if (!roomCandidates.has(entry)) {
                if (entry.group.visible()) {
                    entry.group.visible(false);
                    roomLayerNeedsDraw = true;
                }
            }
        });

        // Swap room buffers
        this.bufferRoomSet = this.visibleRooms;
        this.visibleRooms = nextVisibleRooms;

        const exitCandidates = this.collectStandaloneExitCandidates(searchMinX, searchMinY, searchMaxX, searchMaxY);
        const nextVisibleStandaloneExitNodes = this.bufferExitSet;
        nextVisibleStandaloneExitNodes.clear();
        let exitSetChanged = false;

        exitCandidates.forEach(entry => {
            const {bounds} = entry;
            const nodeMinX = bounds.x;
            const nodeMaxX = bounds.x + bounds.width;
            const nodeMinY = bounds.y;
            const nodeMaxY = bounds.y + bounds.height;

            const isVisible =
                nodeMaxX >= minX &&
                nodeMinX <= maxX &&
                nodeMaxY >= minY &&
                nodeMinY <= maxY;

            if (isVisible) {
                nextVisibleStandaloneExitNodes.add(entry);
                if (!this.visibleStandaloneExitNodes.has(entry)) exitSetChanged = true;
            }
        });

        if (!exitSetChanged && nextVisibleStandaloneExitNodes.size !== this.visibleStandaloneExitNodes.size) {
            exitSetChanged = true;
        }

        // Swap exit buffers
        this.bufferExitSet = this.visibleStandaloneExitNodes;
        this.visibleStandaloneExitNodes = nextVisibleStandaloneExitNodes;

        if (exitSetChanged) {
            this.visibleExitDrawData.length = 0;
            this.visibleStandaloneExitNodes.forEach(e => this.visibleExitDrawData.push(e.data));
            linkLayerNeedsDraw = true;
        }

        if (roomLayerNeedsDraw) {
            this.roomLayer.batchDraw();
        }
        if (linkLayerNeedsDraw) {
            this.linkLayer.batchDraw();
        }

        const gridStart = Settings.perfCallback ? performance.now() : 0;
        this.renderGrid();
        if (Settings.perfCallback) {
            const gridMs = performance.now() - gridStart;
            const cullingMs = performance.now() - perfStart;
            this.perfMonitor.record({
                cullingMs,
                gridMs,
                visibleRooms: this.visibleRooms.size,
                totalRooms: this.roomNodes.size,
                visibleExits: this.visibleStandaloneExitNodes.size,
                fps: this.perfMonitor.computeFps(),
            });
        }
    }

    private syncPerfMonitor() {
        this.perfMonitor.setCallback(Settings.perfCallback);
    }

    private invalidateGridCache() {
        this.cachedGridBounds = null;
    }

    private renderGrid() {
        if (!Settings.gridEnabled) {
            if (this.cachedGridBounds !== null) {
                this.gridLayer.destroyChildren();
                this.gridLayer.batchDraw();
                this.cachedGridBounds = null;
            }
            return;
        }

        const scale = this.stage.scaleX();
        if (!scale) {
            return;
        }

        const stagePosition = this.stage.position();
        const stageWidth = this.stage.width();
        const stageHeight = this.stage.height();

        // Calculate visible bounds in map coordinates
        const minX = (0 - stagePosition.x) / scale;
        const maxX = (stageWidth - stagePosition.x) / scale;
        const minY = (0 - stagePosition.y) / scale;
        const maxY = (stageHeight - stagePosition.y) / scale;

        // Expand bounds slightly for buffer
        const buffer = Settings.gridSize * 2;
        const left = Math.floor((Math.min(minX, maxX) - buffer) / Settings.gridSize) * Settings.gridSize;
        const right = Math.ceil((Math.max(minX, maxX) + buffer) / Settings.gridSize) * Settings.gridSize;
        const top = Math.floor((Math.min(minY, maxY) - buffer) / Settings.gridSize) * Settings.gridSize;
        const bottom = Math.ceil((Math.max(minY, maxY) + buffer) / Settings.gridSize) * Settings.gridSize;

        // Skip recreation if grid bounds haven't changed
        const cached = this.cachedGridBounds;
        if (cached && cached.left === left && cached.right === right && cached.top === top && cached.bottom === bottom) {
            return;
        }

        this.gridLayer.destroyChildren();

        // Draw vertical lines
        for (let x = left; x <= right; x += Settings.gridSize) {
            this.gridLayer.add(new Konva.Line({
                points: [x, top, x, bottom],
                stroke: Settings.gridColor,
                strokeWidth: Settings.gridLineWidth,
                listening: false,
                perfectDrawEnabled: false,
            }));
        }

        // Draw horizontal lines
        for (let y = top; y <= bottom; y += Settings.gridSize) {
            this.gridLayer.add(new Konva.Line({
                points: [left, y, right, y],
                stroke: Settings.gridColor,
                strokeWidth: Settings.gridLineWidth,
                listening: false,
                perfectDrawEnabled: false,
            }));
        }

        this.cachedGridBounds = { left, right, top, bottom };
        this.gridLayer.batchDraw();
    }

    private clearCurrentRoomOverlay() {
        this.currentRoomOverlay.forEach(node => node.destroy());
        this.currentRoomOverlay = [];
        this.positionLayer.batchDraw();
    }

    private updateCurrentRoomOverlay(room: MapData.Room) {
        this.clearCurrentRoomOverlay();

        if (room.area !== this.currentArea || room.z !== this.currentZIndex) {
            this.positionLayer.batchDraw();
            return;
        }

        const roomsToRedraw = new Map<number, MapData.Room>();
        roomsToRedraw.set(room.id, room);

        const preRoomNodes: Array<Konva.Group | Konva.Shape> = [];

        const explorationArea =
            this.currentAreaInstance instanceof ExplorationArea ? this.currentAreaInstance : undefined;

        if (this.currentAreaInstance && this.currentZIndex !== undefined) {
            const exits = this.currentAreaInstance
                .getLinkExits(this.currentZIndex)
                .filter(exit => exit.a === room.id || exit.b === room.id);
            exits.forEach(exit => {
                const render = Settings.highlightCurrentRoom
                    ? this.exitRenderer.renderWithColor(exit, currentRoomColor, this.currentZIndex!)
                    : this.exitRenderer.render(exit, this.currentZIndex!);
                if (render) {
                    preRoomNodes.push(render);
                }
            });
        }

        const highlightColor = Settings.highlightCurrentRoom ? currentRoomColor : undefined;


        this.exitRenderer.renderSpecialExits(room, highlightColor).forEach(render => {
            preRoomNodes.push(render);
        });

        const stubs = Settings.highlightCurrentRoom
            ? this.exitRenderer.renderStubs(room, currentRoomColor)
            : this.exitRenderer.renderStubs(room);
        stubs.forEach(render => {
            preRoomNodes.push(render);
        });

        [...Object.values(room.exits), ...Object.values(room.specialExits)].forEach(id => {
            const otherRoom = this.mapReader.getRoom(id);
            const canRenderOtherRoom =
                !explorationArea || explorationArea.hasVisitedRoom(id);

            if (
                otherRoom &&
                otherRoom.area === this.currentArea &&
                otherRoom.z === this.currentZIndex &&
                canRenderOtherRoom) {
                roomsToRedraw.set(id, otherRoom)
            }
        })

        preRoomNodes.forEach(node => {
            this.positionLayer.add(node);
            this.currentRoomOverlay.push(node);
        });

        roomsToRedraw.forEach((roomToRedraw, id) => {
            const isCurrent = id === room.id;
            const overlayRoom = this.createOverlayRoomGroup(
                roomToRedraw,
                {
                    stroke: isCurrent && Settings.highlightCurrentRoom ? currentRoomColor : Settings.lineColor,
                }
            );
            this.positionLayer.add(overlayRoom);
            this.currentRoomOverlay.push(overlayRoom);

            this.exitRenderer.renderInnerExits(roomToRedraw).forEach(render => {
                this.positionLayer.add(render);
                this.currentRoomOverlay.push(render);
            });
        });

        // Move the position circle to the top so it draws over the overlay
        if (this.positionRender) {
            this.positionRender.moveToTop();
        }

        this.positionLayer.batchDraw();
    }

    private createOverlayRoomGroup(room: MapData.Room, options: {
        stroke: string;
    }) {
        const roomGroup = new Konva.Group({
            x: room.x - Settings.roomSize / 2,
            y: room.y - Settings.roomSize / 2,
            listening: false,
        });

        const fillColor = this.mapReader.getColorValue(room.env);
        const strokeColor = options.stroke;

        const roomShape = Settings.roomShape === "circle"
            ? new Konva.Circle({
                x: Settings.roomSize / 2,
                y: Settings.roomSize / 2,
                radius: Settings.roomSize / 2,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: Settings.lineWidth,
            })
            : new Konva.Rect({
                x: 0,
                y: 0,
                width: Settings.roomSize,
                height: Settings.roomSize,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: Settings.lineWidth,
                cornerRadius: Settings.roomShape === "roundedRectangle" ? Settings.roomSize * 0.2 : 0,
            });

        roomGroup.add(roomShape);
        this.renderSymbol(room, roomGroup);

        return roomGroup;
    }

    private renderSymbol(room: MapData.Room, roomRender: Konva.Group) {
        if (room.roomChar !== undefined) {
            // Font size scales with room size: 0.75 is the ratio (at default roomSize 0.6, fontSize is 0.45)
            const fontSize = Settings.roomSize * 0.75;
            const roomChar = new Konva.Text({
                x: 0,
                y: 0,
                text: room.roomChar,
                fontSize: fontSize,
                fontStyle: "bold",
                fill: this.mapReader.getSymbolColor(room.env),
                align: "center",
                verticalAlign: "middle",
                width: Settings.roomSize,
                height: Settings.roomSize,
                perfectDrawEnabled: false,
                listening: false,
            })
            roomRender.add(roomChar);
        }
    }

    private renderExits(exits: Exit[]) {
        exits.forEach(exit => {
            const data = this.exitRenderer.renderData(exit, this.currentZIndex!);
            if (!data) {
                return;
            }
            const entry: StandaloneExitEntry = { data, bounds: data.bounds };
            this.standaloneExitNodes.push(entry);
            this.addStandaloneExitToSpatialIndex(entry);
        });

        this.standaloneExitBoundsRoomSize = Settings.roomSize;

        // Create a single batched shape for drawing all visible exits
        this.exitBatchShape = new Konva.Shape({
            listening: false,
            perfectDrawEnabled: false,
            sceneFunc: (context) => {
                const ctx = context._context;
                for (const data of this.visibleExitDrawData) {
                    this.drawExitData(ctx, data);
                }
            },
        });
        this.linkLayer.add(this.exitBatchShape);
    }

    private drawExitData(ctx: CanvasRenderingContext2D, data: ExitDrawData) {
        for (const line of data.lines) {
            ctx.beginPath();
            ctx.moveTo(line.points[0], line.points[1]);
            for (let i = 2; i < line.points.length; i += 2) {
                ctx.lineTo(line.points[i], line.points[i + 1]);
            }
            ctx.strokeStyle = line.stroke;
            ctx.lineWidth = line.strokeWidth;
            if (line.dash) {
                ctx.setLineDash(line.dash);
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }

        for (const arrow of data.arrows) {
            // Draw the line part
            ctx.beginPath();
            ctx.moveTo(arrow.points[0], arrow.points[1]);
            for (let i = 2; i < arrow.points.length; i += 2) {
                ctx.lineTo(arrow.points[i], arrow.points[i + 1]);
            }
            ctx.strokeStyle = arrow.stroke;
            ctx.lineWidth = arrow.strokeWidth;
            if (arrow.dash) {
                ctx.setLineDash(arrow.dash);
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();

            // Draw the arrowhead
            const lastIdx = arrow.points.length - 2;
            const tipX = arrow.points[lastIdx];
            const tipY = arrow.points[lastIdx + 1];
            const prevX = arrow.points[lastIdx - 2];
            const prevY = arrow.points[lastIdx - 1];
            const angle = Math.atan2(tipY - prevY, tipX - prevX);
            const pl = arrow.pointerLength;
            const pw = arrow.pointerWidth / 2;
            ctx.beginPath();
            ctx.setLineDash([]);
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - pl * Math.cos(angle - Math.atan2(pw, pl)), tipY - pl * Math.sin(angle - Math.atan2(pw, pl)));
            ctx.lineTo(tipX - pl * Math.cos(angle + Math.atan2(pw, pl)), tipY - pl * Math.sin(angle + Math.atan2(pw, pl)));
            ctx.closePath();
            ctx.fillStyle = arrow.fill;
            ctx.fill();
        }

        for (const door of data.doors) {
            ctx.beginPath();
            ctx.rect(door.x, door.y, door.width, door.height);
            ctx.strokeStyle = door.stroke;
            ctx.lineWidth = door.strokeWidth;
            ctx.setLineDash([]);
            ctx.stroke();
        }
    }

    private renderLabels(Labels: MapData.Label[]) {
        Labels.forEach(label => {
            if (Settings.labelRenderMode === "image") {
                if (!label.pixMap) {
                    return;
                }

                const image = new Image();
                image.src = `data:image/png;base64,${label.pixMap}`;
                const labelRender = new Konva.Image({
                    x: label.X,
                    y: -label.Y,
                    width: label.Width,
                    height: label.Height,
                    image: image,
                    listening: false,
                });
                this.linkLayer.add(labelRender);
                return;
            }

            this.renderLabelAsData(label);
        });
    }

    private renderLabelAsData(label: MapData.Label) {
        const labelRender = new Konva.Group({
            listening: false,
        });

        const background = new Konva.Rect({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            listening: false,
        });

        if ((label.BgColor?.alpha ?? 0) > 0 && !Settings.transparentLabels) {
            background.fill(this.getLabelColor(label.BgColor));
        } else {
            background.fillEnabled(false);
        }

        labelRender.add(background);

        const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
        const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));

        const text = new Konva.Text({
            x: label.X,
            y: -label.Y,
            width: label.Width,
            height: label.Height,
            text: label.Text,
            fontSize,
            fillEnabled: true,
            fill: this.getLabelColor(label.FgColor),
            align: "center",
            verticalAlign: "middle",
            listening: false,
        });

        labelRender.add(text);

        this.linkLayer.add(labelRender);
    }

    private getLabelColor(color: MapData.Color): string {
        const alpha = (color?.alpha ?? 255) / 255;
        const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
        return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
    }


}