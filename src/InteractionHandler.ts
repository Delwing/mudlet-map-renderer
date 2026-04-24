import type {Settings, RendererEventMap} from "./types/Settings";
import type {TypedEventEmitter} from "./TypedEventEmitter";
import type {Camera} from "./Camera";
import type {MapState} from "./MapState";

type Bounds = { x: number; y: number; width: number; height: number };
type AreaExitHitZone = { bounds: Bounds; targetRoomId: number };

export type HitTestCallbacks = {
    clientToMapPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
    findRoomAtPoint: (mapX: number, mapY: number) => MapData.Room | null;
    getAreaExitHitZones: () => AreaExitHitZone[];
    /**
     * Inverse of the drawing backend's coordinate transform — maps a point from
     * rendered space (what `clientToMapPoint` returns) back to untransformed map
     * space. Needed for hit tests that compare against map-space bounds (e.g.
     * area-exit hit zones) under decorators like IsometricStyle.
     */
    renderedToMapPoint: (x: number, y: number) => { x: number; y: number };
};

/**
 * Handles all DOM interaction on the map container:
 * - Viewport: drag (mouse + touch), wheel zoom, pinch zoom, resize
 * - Map: hover cursor, click, right-click, long-press, area exit clicks
 *
 * No Konva dependency — works with any rendering backend.
 */
export class InteractionHandler {

    private readonly container: HTMLDivElement;
    private readonly settings: Settings;
    private readonly camera: Camera;
    private readonly state: MapState;
    private readonly hitTest: HitTestCallbacks;
    private readonly events: TypedEventEmitter<RendererEventMap>;

    private lastPinchDistance?: number;
    private readonly cleanupFns: (() => void)[] = [];
    private destroyed = false;
    private animationId?: number;

    /** Skip cursor changes when an external consumer (e.g. the editor) owns cursor management. */
    private setCursor(value: string) {
        if (this.container.dataset.editorCursor) return;
        this.container.style.cursor = value;
    }

    constructor(
        container: HTMLDivElement,
        viewport: Camera,
        state: MapState,
        settings: Settings,
        hitTest: HitTestCallbacks,
        events: TypedEventEmitter<RendererEventMap>,
    ) {
        this.container = container;
        this.camera = viewport;
        this.state = state;
        this.settings = settings;
        this.hitTest = hitTest;
        this.events = events;

        this.initViewportEvents();
        this.initMapEvents();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.cancelAnimation();
        for (const cleanup of this.cleanupFns) {
            cleanup();
        }
        this.cleanupFns.length = 0;
    }

    cancelAnimation(): void {
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
    }

    animatePanTo(x: number, y: number, durationMs = 200): void {
        this.cancelAnimation();
        const startPos = { ...this.camera.position };
        const scale = this.camera.getScale();
        const targetPos = {
            x: this.camera.width / 2 - x * scale,
            y: this.camera.height / 2 - y * scale,
        };

        const start = performance.now();
        const raf = typeof requestAnimationFrame !== 'undefined'
            ? requestAnimationFrame
            : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

        const step = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / durationMs, 1);
            const t = this.easeInOut(progress);
            this.camera.position = {
                x: startPos.x + (targetPos.x - startPos.x) * t,
                y: startPos.y + (targetPos.y - startPos.y) * t,
            };
            this.camera.onChange?.();

            if (progress < 1) {
                this.animationId = raf(step);
            } else {
                this.camera.position = targetPos;
                this.camera.onChange?.();
                this.animationId = undefined;
            }
        };

        this.animationId = raf(step);
    }

    private easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    private listen<K extends keyof HTMLElementEventMap>(
        target: EventTarget,
        event: K,
        handler: (e: HTMLElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
    ): void;
    private listen(
        target: EventTarget,
        event: string,
        handler: EventListener,
        options?: AddEventListenerOptions,
    ): void;
    private listen(
        target: EventTarget,
        event: string,
        handler: EventListener,
        options?: AddEventListenerOptions,
    ) {
        target.addEventListener(event, handler, options);
        this.cleanupFns.push(() => target.removeEventListener(event, handler, options));
    }

    // ===== Viewport events (drag, zoom, resize) =====

    private initViewportEvents() {
        const container = this.container;
        const viewport = this.camera;
        const scaleBy = 1.1;

        // --- Resize ---
        const handleResize = () => {
            viewport.setSize(container.clientWidth, container.clientHeight);
            if (viewport.centerOnResize && this.state.positionRoomId) {
                const room = this.state.mapReader.getRoom(this.state.positionRoomId);
                if (room) viewport.panToMapPoint(room.x, room.y);
            }
        };

        if (typeof window !== 'undefined') {
            this.listen(window, 'resize', handleResize);
        }
        this.listen(container, 'resize', handleResize);

        // --- Mouse drag (pointer events) ---
        let pointerDown = false;
        let pointerId: number | undefined;

        this.listen(container, 'pointerdown', (e) => {
            if (e.button !== 0 || e.pointerType === 'touch') return;
            this.cancelAnimation();
            pointerDown = true;
            pointerId = e.pointerId;
            container.setPointerCapture(e.pointerId);
            const rect = container.getBoundingClientRect();
            viewport.startDrag(e.clientX - rect.left, e.clientY - rect.top);
        });

        this.listen(container, 'pointermove', (e) => {
            if (!pointerDown || e.pointerId !== pointerId) return;
            const rect = container.getBoundingClientRect();
            viewport.updateDrag(e.clientX - rect.left, e.clientY - rect.top);
            this.events.emit('pan', viewport.getViewportBounds());
        });

        this.listen(container, 'pointerup', (e) => {
            if (e.pointerId !== pointerId) return;
            pointerDown = false;
            pointerId = undefined;
            viewport.endDrag();
            this.events.emit('pan', viewport.getViewportBounds());
        });

        this.listen(container, 'pointercancel', (e) => {
            if (e.pointerId !== pointerId) return;
            pointerDown = false;
            pointerId = undefined;
            viewport.endDrag();
        });

        // --- Touch drag (single finger) + pinch zoom (two fingers) ---
        let touchDragId: number | undefined;

        this.listen(container, 'touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
                this.cancelAnimation();
                const touch = e.touches[0];
                touchDragId = touch.identifier;
                const rect = container.getBoundingClientRect();
                viewport.startDrag(touch.clientX - rect.left, touch.clientY - rect.top);
            } else {
                if (viewport.isDragging()) viewport.endDrag();
                touchDragId = undefined;
            }
        }, {passive: true});

        this.listen(container, 'touchmove', (e: TouchEvent) => {
            const touches = e.touches;

            // Pinch zoom (two fingers)
            if (touches.length >= 2) {
                e.preventDefault();
                if (viewport.isDragging()) viewport.endDrag();
                touchDragId = undefined;

                const rect = container.getBoundingClientRect();
                const p1 = {x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top};
                const p2 = {x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top};
                this.handlePinch(p1, p2);
                return;
            }

            // Single finger drag
            if (touches.length === 1 && touchDragId === touches[0].identifier) {
                const touch = touches[0];
                const rect = container.getBoundingClientRect();
                viewport.updateDrag(touch.clientX - rect.left, touch.clientY - rect.top);
                this.events.emit('pan', viewport.getViewportBounds());
            }
        });

        this.listen(container, 'touchend', (e: TouchEvent) => {
            this.lastPinchDistance = undefined;
            if (e.touches.length === 0) {
                if (viewport.isDragging()) {
                    viewport.endDrag();
                    this.events.emit('pan', viewport.getViewportBounds());
                }
                touchDragId = undefined;
            } else if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchDragId = touch.identifier;
                const rect = container.getBoundingClientRect();
                viewport.startDrag(touch.clientX - rect.left, touch.clientY - rect.top);
            }
        }, {passive: true});

        this.listen(container, 'touchcancel', () => {
            this.lastPinchDistance = undefined;
            if (viewport.isDragging()) viewport.endDrag();
            touchDragId = undefined;
        }, {passive: true});

        // --- Wheel zoom ---
        this.listen(container, 'wheel', (e: WheelEvent) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            let direction = e.deltaY > 0 ? -1 : 1;
            if (e.ctrlKey) direction = -direction;

            const newZoom = direction > 0 ? viewport.zoom * scaleBy : viewport.zoom / scaleBy;
            if (viewport.zoomToPoint(newZoom, screenX, screenY)) {
                this.events.emit('zoom', {zoom: viewport.zoom});
                this.events.emit('pan', viewport.getViewportBounds());
            }
        }, {passive: false});
    }

    private handlePinch(p1: {x: number; y: number}, p2: {x: number; y: number}) {
        const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);

        if (this.lastPinchDistance === undefined || this.lastPinchDistance === 0 || distance === 0) {
            this.lastPinchDistance = distance;
            return;
        }

        const centerX = (p1.x + p2.x) / 2;
        const centerY = (p1.y + p2.y) / 2;
        const newZoom = this.camera.zoom * (distance / this.lastPinchDistance);

        if (this.camera.zoomToPoint(newZoom, centerX, centerY)) {
            this.events.emit('zoom', {zoom: this.camera.zoom});
            this.events.emit('pan', this.camera.getViewportBounds());
        }

        this.lastPinchDistance = distance;
    }

    // ===== Map events (click, hover, context menu) =====

    private initMapEvents() {
        const container = this.container;
        let hoveredRoom: MapData.Room | null = null;
        let hoveredAreaExit = false;

        this.listen(container, 'mousemove', (e: MouseEvent) => {
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room !== hoveredRoom) {
                hoveredRoom = room;
                if (room) {
                    hoveredAreaExit = false;
                    this.setCursor('pointer');
                    return;
                }
            }
            if (!hoveredRoom) {
                const exitZone = this.findAreaExitAtClientPoint(e.clientX, e.clientY);
                const overExit = exitZone !== null;
                hoveredAreaExit = overExit;
                this.setCursor(overExit ? 'pointer' : 'auto');
            }
        });

        this.listen(container, 'mouseleave', () => {
            hoveredRoom = null;
            hoveredAreaExit = false;
            this.setCursor('auto');
        });

        let clickStart: { x: number; y: number } | null = null;

        this.listen(container, 'mousedown', (e: MouseEvent) => {
            if (e.button === 0) {
                clickStart = { x: e.clientX, y: e.clientY };
            }
        });

        this.listen(container, 'mouseup', (e: MouseEvent) => {
            if (e.button !== 0 || !clickStart) return;
            const dx = e.clientX - clickStart.x;
            const dy = e.clientY - clickStart.y;
            clickStart = null;
            if (dx * dx + dy * dy > 25) return;
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room) {
                this.emitRoomClickEvent(room.id, e.clientX, e.clientY);
                return;
            }
            const exitZone = this.findAreaExitAtClientPoint(e.clientX, e.clientY);
            if (exitZone) {
                this.emitAreaExitClickEvent(exitZone.targetRoomId, e.clientX, e.clientY);
                return;
            }
            this.emitMapClickEvent();
        });

        this.listen(container, 'contextmenu', (e: MouseEvent) => {
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room) {
                e.preventDefault();
                this.emitRoomContextEvent(room.id, e.clientX, e.clientY);
            }
        });

        // Long-press support for touch
        let longPressTimeout: number | undefined;
        let longPressStart: { clientX: number; clientY: number } | undefined;
        let dragSuppressed = false;

        const clearLongPress = () => {
            if (longPressTimeout !== undefined) {
                window.clearTimeout(longPressTimeout);
                longPressTimeout = undefined;
            }
            longPressStart = undefined;
            dragSuppressed = false;
        };

        this.listen(container, 'touchstart', (e: TouchEvent) => {
            clearLongPress();
            if (e.touches.length > 1) return;
            const touch = e.touches[0];
            if (!touch) return;
            const room = this.findRoomAtClientPoint(touch.clientX, touch.clientY);
            if (!room) return;
            longPressStart = { clientX: touch.clientX, clientY: touch.clientY };
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

        this.listen(container, 'touchend', () => clearLongPress(), { passive: true });
        this.listen(container, 'touchcancel', () => clearLongPress(), { passive: true });

        this.listen(container, 'touchmove', (e: TouchEvent) => {
            if (!longPressStart) return;
            const touch = e.touches[0];
            if (!touch) {
                clearLongPress();
                return;
            }
            const dx = touch.clientX - longPressStart.clientX;
            const dy = touch.clientY - longPressStart.clientY;
            if (dx * dx + dy * dy > 100) {
                clearLongPress();
            }
        }, { passive: true });
    }

    // --- Hit testing helpers ---

    private findRoomAtClientPoint(clientX: number, clientY: number): MapData.Room | null {
        const mapPoint = this.hitTest.clientToMapPoint(clientX, clientY);
        if (!mapPoint) return null;
        return this.hitTest.findRoomAtPoint(mapPoint.x, mapPoint.y);
    }

    private findAreaExitAtClientPoint(clientX: number, clientY: number): AreaExitHitZone | null {
        const renderedPoint = this.hitTest.clientToMapPoint(clientX, clientY);
        if (!renderedPoint) return null;
        // Zone bounds are stored in pre-transform map space; click comes in as
        // rendered space (iso-projected under IsometricStyle). Undo the decorator
        // transform so AABB comparison works in both flat and iso modes.
        const mapPoint = this.hitTest.renderedToMapPoint(renderedPoint.x, renderedPoint.y);
        const pad = this.settings.roomSize * 0.5;
        for (const zone of this.hitTest.getAreaExitHitZones()) {
            const b = zone.bounds;
            if (mapPoint.x >= b.x - pad && mapPoint.x <= b.x + b.width + pad &&
                mapPoint.y >= b.y - pad && mapPoint.y <= b.y + b.height + pad) {
                return zone;
            }
        }
        return null;
    }

    // --- Event emitters ---

    private emitRoomClickEvent(roomId: number, clientX: number, clientY: number) {
        const bounds = this.container.getBoundingClientRect();
        this.events.emit('roomclick', {
            roomId,
            position: { x: clientX - bounds.left, y: clientY - bounds.top },
        });
    }

    private emitRoomContextEvent(roomId: number, clientX: number, clientY: number) {
        const bounds = this.container.getBoundingClientRect();
        this.events.emit('roomcontextmenu', {
            roomId,
            position: { x: clientX - bounds.left, y: clientY - bounds.top },
        });
    }

    private emitAreaExitClickEvent(targetRoomId: number, clientX: number, clientY: number) {
        const bounds = this.container.getBoundingClientRect();
        this.events.emit('areaexitclick', {
            targetRoomId,
            position: { x: clientX - bounds.left, y: clientY - bounds.top },
        });
    }

    private emitMapClickEvent() {
        this.events.emit('mapclick', undefined);
    }
}
