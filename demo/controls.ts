import {Renderer, CullingMode, RoomShape} from "@src";
import type {Settings, LabelRenderMode, PerfSnapshot} from "@src";

function rgbToHex(rgb: string): string {
    const match = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) return rgb;
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function describeCullingMode(mode: CullingMode) {
    switch (mode) {
        case "none": return "No culling";
        case "basic": return "Classic culling";
        case "indexed":
        default: return "Spatial index culling";
    }
}

export function initControls(settings: Settings, renderer: Renderer, getCurrentRoomId: () => number) {
    const explorationToggle = document.getElementById("exploration-toggle") as HTMLInputElement | null;
    const instantMoveToggle = document.getElementById("instant-move-toggle") as HTMLInputElement | null;
    const highlightToggle = document.getElementById("highlight-toggle") as HTMLInputElement | null;
    const gridToggle = document.getElementById("grid-toggle") as HTMLInputElement | null;
    const roomShapeSelect = document.getElementById("room-shape") as HTMLSelectElement | null;
    const cullingModeSelect = document.getElementById("culling-mode") as HTMLSelectElement | null;
    const backgroundColorInput = document.getElementById("background-color") as HTMLInputElement | null;
    const lineColorInput = document.getElementById("line-color") as HTMLInputElement | null;
    const labelRenderModeSelect = document.getElementById("label-render-mode") as HTMLSelectElement | null;
    const transparentLabelsToggle = document.getElementById("transparent-labels-toggle") as HTMLInputElement | null;
    const roomSizeSlider = document.getElementById("room-size-slider") as HTMLInputElement | null;
    const roomSizeValue = document.getElementById("room-size-value") as HTMLSpanElement | null;
    const lineWidthSlider = document.getElementById("line-width-slider") as HTMLInputElement | null;
    const lineWidthValue = document.getElementById("line-width-value") as HTMLSpanElement | null;
    const cullingStatusElement = document.getElementById("culling-status") as HTMLDivElement | null;
    const playerMarkerStrokeColor = document.getElementById("player-marker-stroke-color") as HTMLInputElement | null;
    const playerMarkerStrokeAlpha = document.getElementById("player-marker-stroke-alpha") as HTMLInputElement | null;
    const playerMarkerStrokeAlphaValue = document.getElementById("player-marker-stroke-alpha-value") as HTMLSpanElement | null;
    const playerMarkerFillColor = document.getElementById("player-marker-fill-color") as HTMLInputElement | null;
    const playerMarkerFillAlpha = document.getElementById("player-marker-fill-alpha") as HTMLInputElement | null;
    const playerMarkerFillAlphaValue = document.getElementById("player-marker-fill-alpha-value") as HTMLSpanElement | null;
    const playerMarkerStrokeWidth = document.getElementById("player-marker-stroke-width") as HTMLInputElement | null;
    const playerMarkerStrokeWidthValue = document.getElementById("player-marker-stroke-width-value") as HTMLSpanElement | null;
    const playerMarkerSize = document.getElementById("player-marker-size") as HTMLInputElement | null;
    const playerMarkerSizeValue = document.getElementById("player-marker-size-value") as HTMLSpanElement | null;
    const playerMarkerDashEnabled = document.getElementById("player-marker-dash-enabled") as HTMLInputElement | null;

    const updateCullingStatus = () => {
        if (!cullingStatusElement) return;
        cullingStatusElement.textContent = `Culling mode: ${describeCullingMode(renderer.getCullingMode())}`;
    };

    // --- Sync UI to current settings ---

    if (roomShapeSelect) roomShapeSelect.value = settings.roomShape;
    if (cullingModeSelect) cullingModeSelect.value = renderer.getCullingMode();
    if (instantMoveToggle) instantMoveToggle.checked = settings.instantMapMove;
    if (highlightToggle) highlightToggle.checked = settings.highlightCurrentRoom;
    if (gridToggle) gridToggle.checked = settings.gridEnabled;
    if (backgroundColorInput) backgroundColorInput.value = settings.backgroundColor;
    if (lineColorInput) lineColorInput.value = rgbToHex(settings.lineColor);
    if (labelRenderModeSelect) labelRenderModeSelect.value = settings.labelRenderMode;
    if (transparentLabelsToggle) transparentLabelsToggle.checked = settings.transparentLabels;

    if (roomSizeSlider && roomSizeValue) {
        roomSizeSlider.value = settings.roomSize.toString();
        roomSizeValue.textContent = settings.roomSize.toFixed(1);
    }
    if (lineWidthSlider && lineWidthValue) {
        lineWidthSlider.value = settings.lineWidth.toString();
        lineWidthValue.textContent = settings.lineWidth.toFixed(3);
    }
    if (playerMarkerStrokeColor) playerMarkerStrokeColor.value = settings.playerMarker.strokeColor;
    if (playerMarkerStrokeAlpha && playerMarkerStrokeAlphaValue) {
        playerMarkerStrokeAlpha.value = settings.playerMarker.strokeAlpha.toString();
        playerMarkerStrokeAlphaValue.textContent = settings.playerMarker.strokeAlpha.toFixed(2);
    }
    if (playerMarkerFillColor) playerMarkerFillColor.value = settings.playerMarker.fillColor;
    if (playerMarkerFillAlpha && playerMarkerFillAlphaValue) {
        playerMarkerFillAlpha.value = settings.playerMarker.fillAlpha.toString();
        playerMarkerFillAlphaValue.textContent = settings.playerMarker.fillAlpha.toFixed(2);
    }
    if (playerMarkerStrokeWidth && playerMarkerStrokeWidthValue) {
        playerMarkerStrokeWidth.value = settings.playerMarker.strokeWidth.toString();
        playerMarkerStrokeWidthValue.textContent = settings.playerMarker.strokeWidth.toFixed(2);
    }
    if (playerMarkerSize && playerMarkerSizeValue) {
        playerMarkerSize.value = settings.playerMarker.sizeFactor.toString();
        playerMarkerSizeValue.textContent = settings.playerMarker.sizeFactor.toFixed(2);
    }
    if (playerMarkerDashEnabled) playerMarkerDashEnabled.checked = settings.playerMarker.dashEnabled;

    updateCullingStatus();

    // --- Event listeners ---

    instantMoveToggle?.addEventListener("change", () => {
        settings.instantMapMove = instantMoveToggle.checked;
    });

    highlightToggle?.addEventListener("change", () => {
        settings.highlightCurrentRoom = highlightToggle.checked;
        renderer.setPosition(getCurrentRoomId());
    });

    gridToggle?.addEventListener("change", () => {
        settings.gridEnabled = gridToggle.checked;
        renderer.refresh();
    });

    roomShapeSelect?.addEventListener("change", () => {
        settings.roomShape = (roomShapeSelect.value ?? "rectangle") as RoomShape;
        renderer.refresh();
    });

    cullingModeSelect?.addEventListener("change", () => {
        renderer.setCullingMode((cullingModeSelect.value ?? "indexed") as CullingMode);
        updateCullingStatus();
    });

    backgroundColorInput?.addEventListener("input", () => {
        settings.backgroundColor = backgroundColorInput.value;
        renderer.updateBackground();
    });

    lineColorInput?.addEventListener("input", () => {
        settings.lineColor = lineColorInput.value;
        renderer.refresh();
    });

    labelRenderModeSelect?.addEventListener("change", () => {
        settings.labelRenderMode = labelRenderModeSelect.value as LabelRenderMode;
        renderer.refresh();
    });

    transparentLabelsToggle?.addEventListener("change", () => {
        settings.transparentLabels = transparentLabelsToggle.checked;
        renderer.refresh();
    });

    roomSizeSlider?.addEventListener("input", () => {
        const value = parseFloat(roomSizeSlider.value);
        settings.roomSize = value;
        if (roomSizeValue) roomSizeValue.textContent = value.toFixed(1);
        renderer.refresh();
    });

    lineWidthSlider?.addEventListener("input", () => {
        const value = parseFloat(lineWidthSlider.value);
        settings.lineWidth = value;
        if (lineWidthValue) lineWidthValue.textContent = value.toFixed(3);
        renderer.refresh();
    });

    playerMarkerStrokeColor?.addEventListener("input", () => {
        settings.playerMarker.strokeColor = playerMarkerStrokeColor.value;
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerStrokeAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeAlpha.value);
        settings.playerMarker.strokeAlpha = value;
        if (playerMarkerStrokeAlphaValue) playerMarkerStrokeAlphaValue.textContent = value.toFixed(2);
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerFillColor?.addEventListener("input", () => {
        settings.playerMarker.fillColor = playerMarkerFillColor.value;
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerFillAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerFillAlpha.value);
        settings.playerMarker.fillAlpha = value;
        if (playerMarkerFillAlphaValue) playerMarkerFillAlphaValue.textContent = value.toFixed(2);
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerStrokeWidth?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeWidth.value);
        settings.playerMarker.strokeWidth = value;
        if (playerMarkerStrokeWidthValue) playerMarkerStrokeWidthValue.textContent = value.toFixed(2);
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerSize?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerSize.value);
        settings.playerMarker.sizeFactor = value;
        if (playerMarkerSizeValue) playerMarkerSizeValue.textContent = value.toFixed(2);
        renderer.setPosition(getCurrentRoomId());
    });

    playerMarkerDashEnabled?.addEventListener("change", () => {
        settings.playerMarker.dashEnabled = playerMarkerDashEnabled.checked;
        renderer.setPosition(getCurrentRoomId());
    });

    return { explorationToggle, updateCullingStatus };
}

export function initPerfMonitor(settings: Settings) {
    const fpsElement = document.getElementById("fps") as HTMLDivElement | null;
    const perfStatsElement = document.getElementById("perf-stats") as HTMLDivElement | null;

    if (fpsElement) {
        let lastSampleTime = performance.now();
        let frameCount = 0;
        const updateFps = (timestamp: number) => {
            frameCount += 1;
            const elapsed = timestamp - lastSampleTime;
            if (elapsed >= 500) {
                fpsElement.textContent = `FPS: ${((frameCount / elapsed) * 1000).toFixed(1)}`;
                frameCount = 0;
                lastSampleTime = timestamp;
            }
            requestAnimationFrame(updateFps);
        };
        requestAnimationFrame(updateFps);
    }

    if (perfStatsElement) {
        settings.perfCallback = (stats: PerfSnapshot) => {
            perfStatsElement.textContent =
                `cull: ${stats.cullingMs.toFixed(2)}ms  grid: ${stats.gridMs.toFixed(2)}ms\n` +
                `rooms: ${stats.visibleRooms}/${stats.totalRooms}  exits: ${stats.visibleExits}`;
        };
    }
}
