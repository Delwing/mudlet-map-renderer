import {MapRenderer} from "@src";
import type {RoomContextMenuEventDetail, RoomClickEventDetail} from "@src";
import MapReader from "@src/reader/MapReader";

export interface WaypointMenuControls {
    has(roomId: number): boolean;
    add(roomId: number, label: string): void;
    remove(roomId: number): void;
}

export function initContextMenu(
    stageElement: HTMLDivElement,
    renderer: MapRenderer,
    mapReader: MapReader,
    moveToRoom: (room: MapData.Room) => void,
    updateRoomStatus: (msg: string) => void,
    waypoints?: WaypointMenuControls,
) {
    const contextMenuElement = document.getElementById("context-menu") as HTMLDivElement | null;
    const contextMenuContent = document.getElementById("context-menu-content") as HTMLDivElement | null;

    const hideContextMenu = () => {
        if (!contextMenuElement) return;
        contextMenuElement.classList.remove("visible");
        contextMenuElement.hidden = true;
    };

    // Room click — toggle highlight
    stageElement.addEventListener("roomclick", event => {
        const {roomId} = (event as CustomEvent<RoomClickEventDetail>).detail;
        if (renderer.hasHighlight(roomId)) {
            renderer.removeHighlight(roomId);
        } else {
            renderer.renderHighlight(roomId, 'yellow');
        }
    });

    if (!contextMenuElement || !contextMenuContent) return;

    // Room context menu (right-click / long-press)
    stageElement.addEventListener("roomcontextmenu", event => {
        const {roomId, position} = (event as CustomEvent<RoomContextMenuEventDetail>).detail;

        contextMenuContent.innerHTML = "";
        const title = document.createElement("div");
        title.className = "ctx-title";
        title.textContent = `Room ${roomId}`;
        contextMenuContent.appendChild(title);

        const setCurrentBtn = document.createElement("button");
        setCurrentBtn.textContent = "Set as current room";
        setCurrentBtn.addEventListener("click", () => {
            const room = mapReader.getRoom(roomId);
            if (room) {
                moveToRoom(room);
                updateRoomStatus(`Set room ${roomId} as current.`);
            }
            hideContextMenu();
        });
        contextMenuContent.appendChild(setCurrentBtn);

        const lookBtn = document.createElement("button");
        lookBtn.textContent = "Center on room";
        lookBtn.addEventListener("click", () => {
            renderer.centerOn(roomId);
            hideContextMenu();
        });
        contextMenuContent.appendChild(lookBtn);

        if (waypoints) {
            if (waypoints.has(roomId)) {
                const removeWpBtn = document.createElement("button");
                removeWpBtn.textContent = "Remove waypoint";
                removeWpBtn.addEventListener("click", () => {
                    waypoints.remove(roomId);
                    updateRoomStatus(`Removed waypoint on room ${roomId}.`);
                    hideContextMenu();
                });
                contextMenuContent.appendChild(removeWpBtn);
            } else {
                const addWpBtn = document.createElement("button");
                addWpBtn.textContent = "Add waypoint…";
                addWpBtn.addEventListener("click", () => {
                    const label = window.prompt("Waypoint label:", `Room ${roomId}`);
                    if (label !== null) {
                        waypoints.add(roomId, label.trim() || `Room ${roomId}`);
                        updateRoomStatus(`Added waypoint on room ${roomId}.`);
                    }
                    hideContextMenu();
                });
                contextMenuContent.appendChild(addWpBtn);
            }
        }

        contextMenuElement.style.left = `${position.x}px`;
        contextMenuElement.style.top = `${position.y}px`;
        contextMenuElement.hidden = false;
        requestAnimationFrame(() => contextMenuElement.classList.add("visible"));
    });

    // Dismiss on various interactions
    stageElement.addEventListener("pointerdown", (e) => {
        if (e.button !== 2) hideContextMenu();
    });
    stageElement.addEventListener("wheel", hideContextMenu, {passive: true});
    stageElement.addEventListener("scroll", hideContextMenu);
    window.addEventListener("keydown", e => {
        if (e.key === "Escape") hideContextMenu();
    });
    window.addEventListener("pointerdown", event => {
        if (event.button === 2) return;
        if (event.target instanceof Node && contextMenuElement.contains(event.target)) return;
        hideContextMenu();
    });
}
