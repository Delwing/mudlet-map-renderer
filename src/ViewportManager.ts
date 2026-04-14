import Konva from "konva";
import type {Settings, ViewportBounds, ZoomChangeEventDetail, PanEventDetail} from "./Renderer";

const defaultZoom = 75;

export type ViewportCallbacks = {
    scheduleCulling: () => void;
    onResize: () => void;
};

export class ViewportManager {

    private readonly stage: Konva.Stage;
    private readonly container: HTMLDivElement;
    private readonly settings: Settings;
    private readonly callbacks: ViewportCallbacks;

    private currentZoom: number = 1;
    private currentTransition?: Konva.Tween;

    /** Minimum zoom level, updated by fitToMapBounds() to prevent zooming out beyond the full area view. */
    public minZoom: number = 0.05;
    /** When true, resizing the container will trigger the onResize callback. Set to false for static map views. */
    public centerOnResize: boolean = true;

    constructor(
        stage: Konva.Stage,
        container: HTMLDivElement,
        settings: Settings,
        callbacks: ViewportCallbacks,
    ) {
        this.stage = stage;
        this.container = container;
        this.settings = settings;
        this.callbacks = callbacks;

        this.initScaling(1.1);

        window.addEventListener('resize', () => this.handleResize());
        container.addEventListener('resize', () => this.handleResize());

        this.stage.on('dragmove', () => {
            this.callbacks.scheduleCulling();
            this.emitPanEvent();
        });
        this.stage.on('dragend', () => {
            this.callbacks.scheduleCulling();
            this.emitPanEvent();
        });
    }

    private handleResize() {
        this.stage.width(this.container.clientWidth);
        this.stage.height(this.container.clientHeight);
        if (this.centerOnResize) {
            this.callbacks.onResize();
        }
        this.stage.batchDraw();
        this.callbacks.scheduleCulling();
    }

    setZoom(zoom: number): boolean {
        const clamped = Math.max(this.minZoom, Math.min(5, zoom));
        if (this.currentZoom === clamped) {
            return false;
        }

        this.currentZoom = clamped;
        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});
        this.callbacks.scheduleCulling();

        return true;
    }

    /**
     * Zooms relative to the center of the viewport.
     * Use this for UI controls (buttons, menus) where there's no mouse position.
     */
    zoomToCenter(zoom: number): boolean {
        const clamped = Math.max(this.minZoom, Math.min(5, zoom));
        if (this.currentZoom === clamped) {
            return false;
        }

        const oldScale = this.stage.scaleX();
        const stageWidth = this.stage.width();
        const stageHeight = this.stage.height();

        const centerX = stageWidth / 2;
        const centerY = stageHeight / 2;

        const centerMapPoint = {
            x: (centerX - this.stage.x()) / oldScale,
            y: (centerY - this.stage.y()) / oldScale,
        };

        this.currentZoom = clamped;
        const newScale = defaultZoom * clamped;
        this.stage.scale({x: newScale, y: newScale});

        const newPos = {
            x: centerX - centerMapPoint.x * newScale,
            y: centerY - centerMapPoint.y * newScale,
        };

        this.stage.position(newPos);
        this.stage.batchDraw();
        this.callbacks.scheduleCulling();
        this.emitZoomChangeEvent();
        this.emitPanEvent();

        return true;
    }

    getZoom() {
        return this.currentZoom;
    }

    /**
     * Returns the current viewport bounds in map coordinates.
     */
    getViewportBounds(): ViewportBounds {
        const scale = this.stage.scaleX();
        const pos = this.stage.position();
        return {
            minX: (0 - pos.x) / scale,
            maxX: (this.stage.width() - pos.x) / scale,
            minY: (0 - pos.y) / scale,
            maxY: (this.stage.height() - pos.y) / scale,
        };
    }

    clientToMapPoint(clientX: number, clientY: number) {
        const rect = this.container.getBoundingClientRect();
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

    /**
     * Pan the viewport to center on a map coordinate, with optional animation.
     */
    panToMapPoint(x: number, y: number, instant: boolean) {
        const roomCenter = {x, y};

        const abs = this.stage.getAbsoluteTransform();
        const screenPoint = abs.point(roomCenter);

        const target = {
            x: this.stage.width() / 2,
            y: this.stage.height() / 2,
        };

        const dx = target.x - screenPoint.x;
        const dy = target.y - screenPoint.y;

        if (this.currentTransition) {
            this.currentTransition.pause();
            this.currentTransition.destroy();
            this.currentTransition = undefined;
        }

        if (instant || this.settings.instantMapMove) {
            this.stage.position({
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
            });
            this.callbacks.scheduleCulling();
            this.emitPanEvent();
        } else {
            this.currentTransition = new Konva.Tween({
                node: this.stage,
                x: this.stage.x() + dx,
                y: this.stage.y() + dy,
                duration: 0.2,
                easing: Konva.Easings.EaseInOut,
                onUpdate: () => this.callbacks.scheduleCulling(),
                onFinish: () => {
                    this.callbacks.scheduleCulling();
                    this.emitPanEvent();
                },
            });
            this.currentTransition.play();
        }
    }

    /**
     * Fit the viewport to show the given map bounds.
     * Sets zoom and position so that the bounds fill the viewport with padding.
     */
    fitToMapBounds(minX: number, maxX: number, minY: number, maxY: number) {
        const mapW = maxX - minX;
        const mapH = maxY - minY;
        if (mapW <= 0 || mapH <= 0) return;

        const stageW = this.stage.width();
        const stageH = this.stage.height();
        const padding = 2;

        const zoomX = stageW / ((mapW + padding * 2) * defaultZoom);
        const zoomY = stageH / ((mapH + padding * 2) * defaultZoom);
        const fitZoom = Math.min(zoomX, zoomY);

        this.currentZoom = Math.max(0.05, Math.min(5, fitZoom));
        this.minZoom = this.currentZoom;
        const scale = defaultZoom * this.currentZoom;
        this.stage.scale({x: scale, y: scale});

        const centerMapX = (minX + maxX) / 2;
        const centerMapY = (minY + maxY) / 2;
        this.stage.position({
            x: stageW / 2 - centerMapX * scale,
            y: stageH / 2 - centerMapY * scale,
        });

        this.stage.batchDraw();
        this.callbacks.scheduleCulling();
    }

    /**
     * Apply the default zoom scale to the stage (called during drawArea).
     */
    applyScale() {
        this.stage.scale({x: defaultZoom * this.currentZoom, y: defaultZoom * this.currentZoom});
    }

    emitPanEvent() {
        const event = new CustomEvent<PanEventDetail>('pan', {
            detail: this.getViewportBounds(),
        });
        this.container.dispatchEvent(event);
    }

    emitZoomChangeEvent() {
        const event = new CustomEvent<ZoomChangeEventDetail>('zoom', {
            detail: {zoom: this.currentZoom},
        });
        this.container.dispatchEvent(event);
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
            const zoomChanged = this.setZoom(newZoom);

            if (zoomChanged) {
                const newScale = this.stage.scaleX();
                const newPos = {
                    x: pointer.x - mousePointTo.x * newScale,
                    y: pointer.y - mousePointTo.y * newScale,
                };

                this.stage.position(newPos);
                this.callbacks.scheduleCulling();
                this.emitZoomChangeEvent();
                this.emitPanEvent();
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

            const rect = this.container.getBoundingClientRect();
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

            if (lastPinchDistance === 0 || distance === 0) {
                lastPinchDistance = distance;
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

            if (zoomChanged) {
                const newScale = this.stage.scaleX();
                const newPos = {
                    x: centerPointer.x - centerMapPoint.x * newScale,
                    y: centerPointer.y - centerMapPoint.y * newScale,
                };

                this.stage.position(newPos);
                this.stage.batchDraw();
                this.callbacks.scheduleCulling();
                this.emitZoomChangeEvent();
                this.emitPanEvent();
            }

            lastPinchDistance = distance;
        });
    }
}
