/**
 * Lightweight typed event emitter.
 * Also dispatches DOM CustomEvents on an optional container element
 * for backwards compatibility.
 */
export class TypedEventEmitter<EventMap extends Record<string, unknown>> {

    private listeners = new Map<keyof EventMap, Set<(detail: any) => void>>();
    private container?: HTMLElement;

    /**
     * @param container Optional DOM element to also dispatch CustomEvents on (for backwards compat)
     */
    constructor(container?: HTMLElement) {
        this.container = container;
    }

    on<K extends keyof EventMap>(event: K, handler: (detail: EventMap[K]) => void): void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(handler);
    }

    off<K extends keyof EventMap>(event: K, handler: (detail: EventMap[K]) => void): void {
        this.listeners.get(event)?.delete(handler);
    }

    removeAllListeners(): void {
        this.listeners.clear();
    }

    emit<K extends keyof EventMap>(event: K, detail: EventMap[K]): void {
        // Typed listeners
        this.listeners.get(event)?.forEach(handler => handler(detail));

        // DOM CustomEvent for backwards compat
        if (this.container) {
            this.container.dispatchEvent(
                new CustomEvent(event as string, {detail}),
            );
        }
    }
}
