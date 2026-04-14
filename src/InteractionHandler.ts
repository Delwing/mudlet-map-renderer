import Konva from "konva";
import type {Settings, RendererEventMap} from "./Renderer";
import type {TypedEventEmitter} from "./TypedEventEmitter";

type Bounds = { x: number; y: number; width: number; height: number };
type AreaExitHitZone = { bounds: Bounds; targetRoomId: number };

export type HitTestCallbacks = {
    clientToMapPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
    findRoomAtPoint: (mapX: number, mapY: number) => MapData.Room | null;
    getAreaExitHitZones: () => AreaExitHitZone[];
};

/**
 * Handles mouse/touch interaction on the map container:
 * hover cursor, click, right-click, long-press, and area exit clicks.
 */
export class InteractionHandler {

    private readonly stage: Konva.Stage;
    private readonly container: HTMLDivElement;
    private readonly settings: Settings;
    private readonly hitTest: HitTestCallbacks;
    private readonly events: TypedEventEmitter<RendererEventMap>;

    constructor(
        stage: Konva.Stage,
        container: HTMLDivElement,
        settings: Settings,
        hitTest: HitTestCallbacks,
        events: TypedEventEmitter<RendererEventMap>,
    ) {
        this.stage = stage;
        this.container = container;
        this.settings = settings;
        this.hitTest = hitTest;
        this.events = events;
        this.init();
    }

    private findRoomAtClientPoint(clientX: number, clientY: number): MapData.Room | null {
        const mapPoint = this.hitTest.clientToMapPoint(clientX, clientY);
        if (!mapPoint) return null;
        return this.hitTest.findRoomAtPoint(mapPoint.x, mapPoint.y);
    }

    private findAreaExitAtClientPoint(clientX: number, clientY: number): AreaExitHitZone | null {
        const mapPoint = this.hitTest.clientToMapPoint(clientX, clientY);
        if (!mapPoint) return null;
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

    private init() {
        const container = this.container;
        let hoveredRoom: MapData.Room | null = null;
        let hoveredAreaExit = false;

        container.addEventListener('mousemove', (e) => {
            const room = this.findRoomAtClientPoint(e.clientX, e.clientY);
            if (room !== hoveredRoom) {
                hoveredRoom = room;
                if (room) {
                    hoveredAreaExit = false;
                    container.style.cursor = 'pointer';
                    return;
                }
            }
            if (!hoveredRoom) {
                const exitZone = this.findAreaExitAtClientPoint(e.clientX, e.clientY);
                const overExit = exitZone !== null;
                hoveredAreaExit = overExit;
                container.style.cursor = overExit ? 'pointer' : 'auto';
            }
        });

        container.addEventListener('mouseleave', () => {
            hoveredRoom = null;
            hoveredAreaExit = false;
            container.style.cursor = 'auto';
        });

        let clickStart: { x: number; y: number } | null = null;

        container.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                clickStart = { x: e.clientX, y: e.clientY };
            }
        });

        container.addEventListener('mouseup', (e) => {
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
}
