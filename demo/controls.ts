import {MapRenderer, CullingMode, RoomShape, PathFinder} from "@src";
import type {Settings, LabelRenderMode, PerfSnapshot, PathFindingAlgorithm} from "@src";

function rgbToHex(rgb: string): string {
    const match = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) return rgb;
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function parseRgba(rgba: string): { hex: string; alpha: number } {
    const match = rgba.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,?\s*([\d.]*)/);
    if (!match) return { hex: '#cccccc', alpha: 0.15 };
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const a = match[4] ? parseFloat(match[4]) : 1;
    return { hex: `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`, alpha: a };
}

function describeCullingMode(mode: CullingMode) {
    switch (mode) {
        case "none": return "No culling";
        case "basic": return "Classic culling";
        case "indexed":
        default: return "Spatial index culling";
    }
}

export function initControls(settings: Settings, renderer: MapRenderer, getCurrentRoomId: () => number, pathFinder?: PathFinder, onAlgorithmChange?: () => void, onPathColorChange?: (color: string) => void) {
    const explorationToggle = document.getElementById("exploration-toggle") as HTMLInputElement | null;
    const instantMoveToggle = document.getElementById("instant-move-toggle") as HTMLInputElement | null;
    const highlightToggle = document.getElementById("highlight-toggle") as HTMLInputElement | null;
    const gridToggle = document.getElementById("grid-toggle") as HTMLInputElement | null;
    const gridColorInput = document.getElementById("grid-color") as HTMLInputElement | null;
    const gridOpacity = document.getElementById("grid-opacity") as HTMLInputElement | null;
    const gridOpacityValue = document.getElementById("grid-opacity-value") as HTMLSpanElement | null;
    const roomShapeSelect = document.getElementById("room-shape") as HTMLSelectElement | null;
    const cullingModeSelect = document.getElementById("culling-mode") as HTMLSelectElement | null;
    const backgroundColorInput = document.getElementById("background-color") as HTMLInputElement | null;
    const lineColorInput = document.getElementById("line-color") as HTMLInputElement | null;
    const labelRenderModeSelect = document.getElementById("label-render-mode") as HTMLSelectElement | null;
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
    const pathfindingAlgorithmSelect = document.getElementById("pathfinding-algorithm") as HTMLSelectElement | null;
    const pathColorInput = document.getElementById("path-color") as HTMLInputElement | null;
    const playerMarkerDashEnabled = document.getElementById("player-marker-dash-enabled") as HTMLInputElement | null;
    const renderModeSelect = document.getElementById("render-mode") as HTMLSelectElement | null;
    const playerMarkerMatchShape = document.getElementById("player-marker-match-shape") as HTMLInputElement | null;
    const embossToggle = document.getElementById("emboss-toggle") as HTMLInputElement | null;
    const areaNameToggle = document.getElementById("area-name-toggle") as HTMLInputElement | null;
    const uniformLevelSizeToggle = document.getElementById("uniform-level-size-toggle") as HTMLInputElement | null;
    const ambientLightToggle = document.getElementById("ambient-light-toggle") as HTMLInputElement | null;
    const ambientLightColor = document.getElementById("ambient-light-color") as HTMLInputElement | null;
    const ambientLightRadius = document.getElementById("ambient-light-radius") as HTMLInputElement | null;
    const ambientLightRadiusValue = document.getElementById("ambient-light-radius-value") as HTMLSpanElement | null;
    const ambientLightIntensity = document.getElementById("ambient-light-intensity") as HTMLInputElement | null;
    const ambientLightIntensityValue = document.getElementById("ambient-light-intensity-value") as HTMLSpanElement | null;
    const savePngBtn = document.getElementById("save-png-btn") as HTMLButtonElement | null;
    const saveSvgBtn = document.getElementById("save-svg-btn") as HTMLButtonElement | null;

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
    const parsedGrid = parseRgba(settings.gridColor);
    if (gridColorInput) gridColorInput.value = parsedGrid.hex;
    if (gridOpacity && gridOpacityValue) {
        gridOpacity.value = parsedGrid.alpha.toString();
        gridOpacityValue.textContent = parsedGrid.alpha.toFixed(2);
    }
    if (backgroundColorInput) backgroundColorInput.value = settings.backgroundColor;
    if (lineColorInput) lineColorInput.value = rgbToHex(settings.lineColor);
    if (labelRenderModeSelect) {
        if (settings.labelRenderMode === "data" && settings.transparentLabels) {
            labelRenderModeSelect.value = "data-transparent";
        } else {
            labelRenderModeSelect.value = settings.labelRenderMode;
        }
    }

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
    if (playerMarkerMatchShape) playerMarkerMatchShape.checked = settings.playerMarker.matchRoomShape;
    if (pathfindingAlgorithmSelect && pathFinder) pathfindingAlgorithmSelect.value = pathFinder.algorithm;
    if (renderModeSelect) {
        if (settings.frameMode) renderModeSelect.value = "frame";
        else if (settings.coloredMode) renderModeSelect.value = "colored";
        else renderModeSelect.value = "normal";
    }
    if (embossToggle) embossToggle.checked = settings.emboss;
    if (areaNameToggle) areaNameToggle.checked = settings.areaName;
    if (uniformLevelSizeToggle) uniformLevelSizeToggle.checked = settings.uniformLevelSize;
    if (ambientLightToggle) ambientLightToggle.checked = settings.ambientLight.enabled;
    if (ambientLightColor) ambientLightColor.value = settings.ambientLight.color;
    if (ambientLightRadius && ambientLightRadiusValue) {
        ambientLightRadius.value = settings.ambientLight.radius.toString();
        ambientLightRadiusValue.textContent = settings.ambientLight.radius.toString();
    }
    if (ambientLightIntensity && ambientLightIntensityValue) {
        ambientLightIntensity.value = settings.ambientLight.intensity.toString();
        ambientLightIntensityValue.textContent = settings.ambientLight.intensity.toFixed(2);
    }
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

    const updateGridColor = () => {
        const hex = gridColorInput?.value ?? parsedGrid.hex;
        const alpha = gridOpacity ? parseFloat(gridOpacity.value) : parsedGrid.alpha;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        settings.gridColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        renderer.refresh();
    };

    gridColorInput?.addEventListener("input", updateGridColor);

    gridOpacity?.addEventListener("input", () => {
        if (gridOpacityValue) gridOpacityValue.textContent = parseFloat(gridOpacity.value).toFixed(2);
        updateGridColor();
    });

    roomShapeSelect?.addEventListener("change", () => {
        settings.roomShape = (roomShapeSelect.value ?? "rectangle") as RoomShape;
        renderer.refresh();
    });

    cullingModeSelect?.addEventListener("change", () => {
        renderer.setCullingMode((cullingModeSelect.value ?? "indexed") as CullingMode);
        updateCullingStatus();
    });

    pathfindingAlgorithmSelect?.addEventListener("change", () => {
        if (pathFinder) {
            pathFinder.setAlgorithm((pathfindingAlgorithmSelect.value ?? "bfs") as PathFindingAlgorithm);
            onAlgorithmChange?.();
        }
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
        const val = labelRenderModeSelect.value;
        if (val === "data-transparent") {
            settings.labelRenderMode = "data" as LabelRenderMode;
            settings.transparentLabels = true;
        } else {
            settings.labelRenderMode = val as LabelRenderMode;
            settings.transparentLabels = false;
        }
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

    playerMarkerMatchShape?.addEventListener("change", () => {
        settings.playerMarker.matchRoomShape = playerMarkerMatchShape.checked;
        renderer.setPosition(getCurrentRoomId());
    });

    pathColorInput?.addEventListener("input", () => {
        onPathColorChange?.(pathColorInput.value);
    });

    renderModeSelect?.addEventListener("change", () => {
        const mode = renderModeSelect.value;
        settings.frameMode = mode === "frame";
        settings.coloredMode = mode === "colored";
        renderer.refresh();
    });

    embossToggle?.addEventListener("change", () => {
        settings.emboss = embossToggle.checked;
        renderer.refresh();
    });

    areaNameToggle?.addEventListener("change", () => {
        settings.areaName = areaNameToggle.checked;
        renderer.refresh();
    });

    uniformLevelSizeToggle?.addEventListener("change", () => {
        settings.uniformLevelSize = uniformLevelSizeToggle.checked;
        renderer.refresh();
    });


    // --- Ambient Lighting ---

    ambientLightToggle?.addEventListener("change", () => {
        settings.ambientLight.enabled = ambientLightToggle.checked;
        renderer.setPosition(getCurrentRoomId());
    });

    ambientLightColor?.addEventListener("input", () => {
        settings.ambientLight.color = ambientLightColor.value;
        renderer.setPosition(getCurrentRoomId());
    });

    ambientLightRadius?.addEventListener("input", () => {
        const value = parseFloat(ambientLightRadius.value);
        settings.ambientLight.radius = value;
        if (ambientLightRadiusValue) ambientLightRadiusValue.textContent = value.toString();
        renderer.setPosition(getCurrentRoomId());
    });

    ambientLightIntensity?.addEventListener("input", () => {
        const value = parseFloat(ambientLightIntensity.value);
        settings.ambientLight.intensity = value;
        if (ambientLightIntensityValue) ambientLightIntensityValue.textContent = value.toFixed(2);
        renderer.setPosition(getCurrentRoomId());
    });

    savePngBtn?.addEventListener("click", async () => {
        const blob = renderer.exportPngBlob({ pixelRatio: 2 });
        if (!blob) return;
        const resolved = await blob;
        const url = URL.createObjectURL(resolved);
        const a = document.createElement("a");
        a.href = url;
        a.download = `map-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    });

    saveSvgBtn?.addEventListener("click", () => {
        const svg = renderer.exportSvg();
        if (!svg) return;
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `map-${Date.now()}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // --- Panel collapse/expand ---

    const hud = document.getElementById("hud");
    const panelToggle = document.getElementById("panel-toggle") as HTMLButtonElement | null;

    panelToggle?.addEventListener("click", () => {
        hud?.classList.toggle("collapsed");
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
