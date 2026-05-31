import {MapRenderer, CullingMode, RoomShape, PathFinder, SvgExporter, PngBlobExporter, AmbientLightOverlay} from "@src";
import type {Settings, LabelRenderMode, PathFindingAlgorithm, ExplorationLens} from "@src";
import type MapReader from "@src/reader/MapReader";
import {WeatherOverlay} from "./WeatherOverlay";
import type {WeatherType} from "./WeatherOverlay";
import {TerrainOverlay} from "./TerrainOverlay";
import type {TerrainEffectType, TerrainRoom} from "./TerrainOverlay";
import {FogOfWarOverlay} from "./FogOfWarOverlay";
import {HitAreaOverlay} from "./HitAreaOverlay";
import {SpotlightOverlay} from "./SpotlightOverlay";

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

export function initControls(settings: Settings, renderer: MapRenderer, getCurrentRoomId: () => number, pathFinder?: PathFinder, onAlgorithmChange?: () => void, onPathColorChange?: (color: string) => void, onRenderModeChange?: (mode: string) => void, mapReader?: MapReader, explorationLens?: ExplorationLens) {
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
    const locationStyleSelect = document.getElementById("location-style") as HTMLSelectElement | null;
    const playerMarkerMatchShape = document.getElementById("player-marker-match-shape") as HTMLInputElement | null;
    const highlightStrokeAlpha = document.getElementById("highlight-stroke-alpha") as HTMLInputElement | null;
    const highlightStrokeAlphaValue = document.getElementById("highlight-stroke-alpha-value") as HTMLSpanElement | null;
    const highlightFillAlpha = document.getElementById("highlight-fill-alpha") as HTMLInputElement | null;
    const highlightFillAlphaValue = document.getElementById("highlight-fill-alpha-value") as HTMLSpanElement | null;
    const highlightStrokeWidth = document.getElementById("highlight-stroke-width") as HTMLInputElement | null;
    const highlightStrokeWidthValue = document.getElementById("highlight-stroke-width-value") as HTMLSpanElement | null;
    const highlightSize = document.getElementById("highlight-size") as HTMLInputElement | null;
    const highlightSizeValue = document.getElementById("highlight-size-value") as HTMLSpanElement | null;
    const highlightDashEnabled = document.getElementById("highlight-dash-enabled") as HTMLInputElement | null;
    const highlightShape = document.getElementById("highlight-shape") as HTMLSelectElement | null;
    const embossToggle = document.getElementById("emboss-toggle") as HTMLInputElement | null;
    const areaNameToggle = document.getElementById("area-name-toggle") as HTMLInputElement | null;
    const areaExitLabelsToggle = document.getElementById("area-exit-labels-toggle") as HTMLInputElement | null;
    const areaExitLabelSizeSlider = document.getElementById("area-exit-label-size-slider") as HTMLInputElement | null;
    const areaExitLabelSizeValue = document.getElementById("area-exit-label-size-value") as HTMLSpanElement | null;
    const uniformLevelSizeToggle = document.getElementById("uniform-level-size-toggle") as HTMLInputElement | null;
    const bordersToggle = document.getElementById("borders-toggle") as HTMLInputElement | null;
    const ambientLightToggle = document.getElementById("ambient-light-toggle") as HTMLInputElement | null;
    const ambientLightColor = document.getElementById("ambient-light-color") as HTMLInputElement | null;
    const ambientLightRadius = document.getElementById("ambient-light-radius") as HTMLInputElement | null;
    const ambientLightRadiusValue = document.getElementById("ambient-light-radius-value") as HTMLSpanElement | null;
    const ambientLightIntensity = document.getElementById("ambient-light-intensity") as HTMLInputElement | null;
    const ambientLightIntensityValue = document.getElementById("ambient-light-intensity-value") as HTMLSpanElement | null;
    const spotlightToggle = document.getElementById("spotlight-toggle") as HTMLInputElement | null;
    const spotlightColor = document.getElementById("spotlight-color") as HTMLInputElement | null;
    const spotlightRadius = document.getElementById("spotlight-radius") as HTMLInputElement | null;
    const spotlightRadiusValue = document.getElementById("spotlight-radius-value") as HTMLSpanElement | null;
    const spotlightIntensity = document.getElementById("spotlight-intensity") as HTMLInputElement | null;
    const spotlightIntensityValue = document.getElementById("spotlight-intensity-value") as HTMLSpanElement | null;
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
    if (highlightStrokeAlpha && highlightStrokeAlphaValue) {
        highlightStrokeAlpha.value = settings.highlight.strokeAlpha.toString();
        highlightStrokeAlphaValue.textContent = settings.highlight.strokeAlpha.toFixed(2);
    }
    if (highlightFillAlpha && highlightFillAlphaValue) {
        highlightFillAlpha.value = settings.highlight.fillAlpha.toString();
        highlightFillAlphaValue.textContent = settings.highlight.fillAlpha.toFixed(2);
    }
    if (highlightStrokeWidth && highlightStrokeWidthValue) {
        highlightStrokeWidth.value = settings.highlight.strokeWidth.toString();
        highlightStrokeWidthValue.textContent = settings.highlight.strokeWidth.toFixed(2);
    }
    if (highlightSize && highlightSizeValue) {
        highlightSize.value = settings.highlight.sizeFactor.toString();
        highlightSizeValue.textContent = settings.highlight.sizeFactor.toFixed(2);
    }
    if (highlightDashEnabled) highlightDashEnabled.checked = settings.highlight.dashEnabled;
    if (highlightShape) highlightShape.value = settings.highlight.shape ?? 'match';
    if (pathfindingAlgorithmSelect && pathFinder) pathfindingAlgorithmSelect.value = pathFinder.algorithm;
    const sketchColorLabel = document.getElementById("sketch-color-label") as HTMLElement | null;
    const sketchColorInput = document.getElementById("sketch-color") as HTMLInputElement | null;

    if (locationStyleSelect) {
        if (settings.frameMode) locationStyleSelect.value = "frame";
        else if (settings.coloredMode) locationStyleSelect.value = "colored";
        else locationStyleSelect.value = "normal";
    }
    if (renderModeSelect) renderModeSelect.value = "normal";
    if (embossToggle) embossToggle.checked = settings.emboss;
    if (areaNameToggle) areaNameToggle.checked = settings.areaName;
    if (areaExitLabelsToggle) areaExitLabelsToggle.checked = settings.areaExitLabels;
    if (areaExitLabelSizeSlider && areaExitLabelSizeValue) {
        areaExitLabelSizeSlider.value = settings.areaExitLabelFontSize.toString();
        areaExitLabelSizeValue.textContent = settings.areaExitLabelFontSize.toFixed(2);
    }
    if (uniformLevelSizeToggle) uniformLevelSizeToggle.checked = settings.uniformLevelSize;
    if (bordersToggle) bordersToggle.checked = settings.borders;
    const ambientLight = new AmbientLightOverlay();
    let ambientLightEnabled = false;
    const ambientParams = ambientLight.getOptions();
    if (ambientLightToggle) ambientLightToggle.checked = ambientLightEnabled;
    if (ambientLightColor) ambientLightColor.value = ambientParams.color;
    if (ambientLightRadius && ambientLightRadiusValue) {
        ambientLightRadius.value = ambientParams.radius.toString();
        ambientLightRadiusValue.textContent = ambientParams.radius.toString();
    }
    if (ambientLightIntensity && ambientLightIntensityValue) {
        ambientLightIntensity.value = ambientParams.intensity.toString();
        ambientLightIntensityValue.textContent = ambientParams.intensity.toFixed(2);
    }

    // --- Spotlight (gradient demo) ---
    const spotlight = new SpotlightOverlay();
    let spotlightEnabled = false;
    const spotlightParams = spotlight.getOptions();
    if (spotlightToggle) spotlightToggle.checked = spotlightEnabled;
    if (spotlightColor) spotlightColor.value = spotlightParams.color;
    if (spotlightRadius && spotlightRadiusValue) {
        spotlightRadius.value = spotlightParams.radius.toString();
        spotlightRadiusValue.textContent = spotlightParams.radius.toString();
    }
    if (spotlightIntensity && spotlightIntensityValue) {
        spotlightIntensity.value = spotlightParams.intensity.toString();
        spotlightIntensityValue.textContent = spotlightParams.intensity.toFixed(2);
    }
    updateCullingStatus();

    // --- Event listeners ---

    instantMoveToggle?.addEventListener("change", () => {
        settings.instantMapMove = instantMoveToggle.checked;
    });

    highlightToggle?.addEventListener("change", () => {
        settings.highlightCurrentRoom = highlightToggle.checked;
        renderer.setPosition(getCurrentRoomId(), false);
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
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerStrokeAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeAlpha.value);
        settings.playerMarker.strokeAlpha = value;
        if (playerMarkerStrokeAlphaValue) playerMarkerStrokeAlphaValue.textContent = value.toFixed(2);
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerFillColor?.addEventListener("input", () => {
        settings.playerMarker.fillColor = playerMarkerFillColor.value;
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerFillAlpha?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerFillAlpha.value);
        settings.playerMarker.fillAlpha = value;
        if (playerMarkerFillAlphaValue) playerMarkerFillAlphaValue.textContent = value.toFixed(2);
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerStrokeWidth?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerStrokeWidth.value);
        settings.playerMarker.strokeWidth = value;
        if (playerMarkerStrokeWidthValue) playerMarkerStrokeWidthValue.textContent = value.toFixed(2);
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerSize?.addEventListener("input", () => {
        const value = parseFloat(playerMarkerSize.value);
        settings.playerMarker.sizeFactor = value;
        if (playerMarkerSizeValue) playerMarkerSizeValue.textContent = value.toFixed(2);
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerDashEnabled?.addEventListener("change", () => {
        settings.playerMarker.dashEnabled = playerMarkerDashEnabled.checked;
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    playerMarkerMatchShape?.addEventListener("change", () => {
        settings.playerMarker.matchRoomShape = playerMarkerMatchShape.checked;
        renderer.updatePositionMarker(getCurrentRoomId());
    });

    highlightStrokeAlpha?.addEventListener("input", () => {
        const value = parseFloat(highlightStrokeAlpha.value);
        settings.highlight.strokeAlpha = value;
        if (highlightStrokeAlphaValue) highlightStrokeAlphaValue.textContent = value.toFixed(2);
        renderer.refresh();
    });

    highlightFillAlpha?.addEventListener("input", () => {
        const value = parseFloat(highlightFillAlpha.value);
        settings.highlight.fillAlpha = value;
        if (highlightFillAlphaValue) highlightFillAlphaValue.textContent = value.toFixed(2);
        renderer.refresh();
    });

    highlightStrokeWidth?.addEventListener("input", () => {
        const value = parseFloat(highlightStrokeWidth.value);
        settings.highlight.strokeWidth = value;
        if (highlightStrokeWidthValue) highlightStrokeWidthValue.textContent = value.toFixed(2);
        renderer.refresh();
    });

    highlightSize?.addEventListener("input", () => {
        const value = parseFloat(highlightSize.value);
        settings.highlight.sizeFactor = value;
        if (highlightSizeValue) highlightSizeValue.textContent = value.toFixed(2);
        renderer.refresh();
    });

    highlightDashEnabled?.addEventListener("change", () => {
        settings.highlight.dashEnabled = highlightDashEnabled.checked;
        renderer.refresh();
    });

    highlightShape?.addEventListener("change", () => {
        settings.highlight.shape = highlightShape.value as typeof settings.highlight.shape;
        renderer.refresh();
    });

    pathColorInput?.addEventListener("input", () => {
        onPathColorChange?.(pathColorInput.value);
    });

    locationStyleSelect?.addEventListener("change", () => {
        const style = locationStyleSelect.value;
        settings.frameMode = style === "frame";
        settings.coloredMode = style === "colored";
        renderer.refresh();
    });

    renderModeSelect?.addEventListener("change", () => {
        const mode = renderModeSelect.value;
        const showPencilColor = mode === "pencil" || mode === "parchment-pencil";
        if (sketchColorLabel) sketchColorLabel.style.display = showPencilColor ? '' : 'none';
        onRenderModeChange?.(mode);
        if (!onRenderModeChange) renderer.refresh();
    });

    sketchColorInput?.addEventListener("input", () => {
        const mode = renderModeSelect?.value;
        if (mode === "pencil" || mode === "parchment-pencil") {
            onRenderModeChange?.(mode);
        }
    });

    const isoRotationSlider = document.getElementById("iso-rotation") as HTMLInputElement | null;
    const isoRotationValue = document.getElementById("iso-rotation-value") as HTMLSpanElement | null;
    isoRotationSlider?.addEventListener("input", () => {
        if (isoRotationValue) isoRotationValue.textContent = isoRotationSlider.value;
        const mode = renderModeSelect?.value;
        if (mode?.startsWith("isometric")) {
            onRenderModeChange?.(mode);
        }
    });

    embossToggle?.addEventListener("change", () => {
        settings.emboss = embossToggle.checked;
        renderer.refresh();
    });

    areaNameToggle?.addEventListener("change", () => {
        settings.areaName = areaNameToggle.checked;
        renderer.refresh();
    });

    areaExitLabelsToggle?.addEventListener("change", () => {
        settings.areaExitLabels = areaExitLabelsToggle.checked;
        renderer.refresh();
    });

    areaExitLabelSizeSlider?.addEventListener("input", () => {
        const v = parseFloat(areaExitLabelSizeSlider.value);
        settings.areaExitLabelFontSize = v;
        if (areaExitLabelSizeValue) areaExitLabelSizeValue.textContent = v.toFixed(2);
        renderer.refresh();
    });

    uniformLevelSizeToggle?.addEventListener("change", () => {
        settings.uniformLevelSize = uniformLevelSizeToggle.checked;
        renderer.refresh();
    });

    bordersToggle?.addEventListener("change", () => {
        settings.borders = bordersToggle.checked;
        renderer.refresh();
    });


    // --- Ambient Lighting ---

    ambientLightToggle?.addEventListener("change", () => {
        if (ambientLightToggle.checked && !ambientLightEnabled) {
            renderer.addSceneOverlay("ambient-light", ambientLight);
            ambientLightEnabled = true;
        } else if (!ambientLightToggle.checked && ambientLightEnabled) {
            renderer.removeSceneOverlay("ambient-light");
            ambientLightEnabled = false;
        }
    });

    ambientLightColor?.addEventListener("input", () => {
        ambientLight.setOptions({color: ambientLightColor.value});
    });

    ambientLightRadius?.addEventListener("input", () => {
        const value = parseFloat(ambientLightRadius.value);
        ambientLight.setOptions({radius: value});
        if (ambientLightRadiusValue) ambientLightRadiusValue.textContent = value.toString();
    });

    ambientLightIntensity?.addEventListener("input", () => {
        const value = parseFloat(ambientLightIntensity.value);
        ambientLight.setOptions({intensity: value});
        if (ambientLightIntensityValue) ambientLightIntensityValue.textContent = value.toFixed(2);
    });

    // --- Spotlight (radial gradient overlay) ---
    spotlightToggle?.addEventListener("change", () => {
        if (spotlightToggle.checked && !spotlightEnabled) {
            renderer.addSceneOverlay("spotlight", spotlight);
            spotlightEnabled = true;
        } else if (!spotlightToggle.checked && spotlightEnabled) {
            renderer.removeSceneOverlay("spotlight");
            spotlightEnabled = false;
        }
    });

    spotlightColor?.addEventListener("input", () => {
        spotlight.setOptions({color: spotlightColor.value});
    });

    spotlightRadius?.addEventListener("input", () => {
        const value = parseFloat(spotlightRadius.value);
        spotlight.setOptions({radius: value});
        if (spotlightRadiusValue) spotlightRadiusValue.textContent = value.toString();
    });

    spotlightIntensity?.addEventListener("input", () => {
        const value = parseFloat(spotlightIntensity.value);
        spotlight.setOptions({intensity: value});
        if (spotlightIntensityValue) spotlightIntensityValue.textContent = value.toFixed(2);
    });

    // --- Weather (overlay plugin) ---

    const weather = new WeatherOverlay();
    renderer.addLiveEffect('weather', weather);

    const weatherType = document.getElementById("weather-type") as HTMLSelectElement | null;
    const weatherIntensity = document.getElementById("weather-intensity") as HTMLInputElement | null;
    const weatherIntensityValue = document.getElementById("weather-intensity-value") as HTMLSpanElement | null;
    const weatherWindAngle = document.getElementById("weather-wind-angle") as HTMLInputElement | null;
    const weatherWindAngleValue = document.getElementById("weather-wind-angle-value") as HTMLSpanElement | null;
    const weatherWindStrength = document.getElementById("weather-wind-strength") as HTMLInputElement | null;
    const weatherWindStrengthValue = document.getElementById("weather-wind-strength-value") as HTMLSpanElement | null;

    const applyWeather = () => {
        weather.setStyle({
            type: (weatherType?.value ?? "none") as WeatherType,
            intensity: weatherIntensity ? parseFloat(weatherIntensity.value) : 0.5,
            windAngle: weatherWindAngle ? parseFloat(weatherWindAngle.value) : 10,
            windStrength: weatherWindStrength ? parseFloat(weatherWindStrength.value) : 1.0,
        });
    };

    weatherType?.addEventListener("change", applyWeather);
    weatherIntensity?.addEventListener("input", () => {
        if (weatherIntensityValue) weatherIntensityValue.textContent = parseFloat(weatherIntensity!.value).toFixed(2);
        applyWeather();
    });
    weatherWindAngle?.addEventListener("input", () => {
        if (weatherWindAngleValue) weatherWindAngleValue.textContent = weatherWindAngle!.value;
        applyWeather();
    });
    weatherWindStrength?.addEventListener("input", () => {
        if (weatherWindStrengthValue) weatherWindStrengthValue.textContent = parseFloat(weatherWindStrength!.value).toFixed(2);
        applyWeather();
    });

    // --- Terrain effects (overlay plugin) ---

    let terrain = new TerrainOverlay();
    const terrainToggle = document.getElementById("terrain-effects-toggle") as HTMLInputElement | null;

    function classifyEnvColor(rgb: string): TerrainEffectType | null {
        const m = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!m) return null;
        const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
        const max = Math.max(r, g, b);
        if (max === 0) return null;
        // Dominant channel classification
        if (b >= 80 && b === max && b > r + 20 && b > g + 20) return "water";
        if (g >= 80 && g === max && g > r + 20 && g > b + 20) return "forest";
        if (r >= 120 && r === max && r > g * 1.5 && r > b * 1.5) return "lava";
        if (r > 160 && g > 160 && b > 160 && Math.abs(r - b) < 60 && Math.abs(r - g) < 60) return "ice";
        return null;
    }

    function updateTerrainRooms() {
        if (!mapReader || !terrainToggle?.checked) {
            terrain.setRooms([]);
            return;
        }
        // Use area/level selectors as source of truth (they're always up to date)
        const areaEl = document.getElementById("area-select") as HTMLSelectElement | null;
        const levelEl = document.getElementById("level-select") as HTMLSelectElement | null;
        let areaId = areaEl ? parseInt(areaEl.value, 10) : NaN;
        let z = levelEl ? parseInt(levelEl.value, 10) : NaN;
        // Fall back to current room if selectors not available
        if (isNaN(areaId) || isNaN(z)) {
            const currentRoom = mapReader.getRoom(getCurrentRoomId());
            if (!currentRoom) { terrain.setRooms([]); return; }
            areaId = currentRoom.area;
            z = currentRoom.z;
        }
        const area = mapReader.getArea(areaId);
        const plane = area?.getPlane(z);
        const planeRooms = plane?.getRooms() ?? [];
        const rooms: TerrainRoom[] = [];
        for (const room of planeRooms) {
            const color = mapReader.getColorValue(room.env);
            const effect = classifyEnvColor(color);
            if (effect) {
                rooms.push({x: room.x, y: room.y, effect, size: settings.roomSize});
            }
        }
        terrain.setRooms(rooms);
    }

    terrainToggle?.addEventListener("change", () => {
        if (terrainToggle.checked) {
            terrain = new TerrainOverlay();
            renderer.addLiveEffect('terrain', terrain);
            updateTerrainRooms();
        } else {
            renderer.removeLiveEffect('terrain');
        }
    });

    // --- Fog of War (overlay plugin) ---

    let fogOfWar = new FogOfWarOverlay();
    const fogToggle = document.getElementById("fog-of-war-toggle") as HTMLInputElement | null;

    function updateFogOfWar() {
        if (!mapReader || !fogToggle?.checked) return;
        fogOfWar.setStyle({color: settings.backgroundColor});
        const areaEl = document.getElementById("area-select") as HTMLSelectElement | null;
        const levelEl = document.getElementById("level-select") as HTMLSelectElement | null;
        let areaId = areaEl ? parseInt(areaEl.value, 10) : NaN;
        let z = levelEl ? parseInt(levelEl.value, 10) : NaN;
        if (isNaN(areaId) || isNaN(z)) {
            const currentRoom = mapReader.getRoom(getCurrentRoomId());
            if (!currentRoom) return;
            areaId = currentRoom.area;
            z = currentRoom.z;
        }
        const area = mapReader.getArea(areaId);
        const plane = area?.getPlane(z);
        const planeRooms = plane?.getRooms() ?? [];

        // Reveal rooms the player has visited + connections between them
        const visited = explorationLens
            ? new Set(explorationLens.getVisitedRoomIds())
            : undefined;
        const visitedSet = new Set<number>();
        const revealed: { x: number; y: number }[] = [];
        for (const room of planeRooms) {
            if (!visited || visited.has(room.id)) {
                revealed.push({x: room.x, y: room.y});
                visitedSet.add(room.id);
            }
        }
        // Build connections between visited rooms
        const connections: { x1: number; y1: number; x2: number; y2: number }[] = [];
        for (const room of planeRooms) {
            if (!visitedSet.has(room.id)) continue;
            for (const targetId of Object.values(room.exits)) {
                if (!visitedSet.has(targetId)) continue;
                const target = mapReader.getRoom(targetId);
                if (target && target.z === z) {
                    connections.push({x1: room.x, y1: room.y, x2: target.x, y2: target.y});
                }
            }
        }
        fogOfWar.setRevealedRooms(revealed, connections);
    }

    fogToggle?.addEventListener("change", () => {
        if (fogToggle.checked) {
            fogOfWar = new FogOfWarOverlay();
            renderer.addLiveEffect('fog-of-war', fogOfWar);
            updateFogOfWar();
        } else {
            renderer.removeLiveEffect('fog-of-war');
        }
    });

    // --- Hit area debug overlay ---

    const hitAreasToggle = document.getElementById("hit-areas-toggle") as HTMLInputElement | null;

    hitAreasToggle?.addEventListener("change", () => {
        if (hitAreasToggle.checked) {
            renderer.addSceneOverlay("hit-areas", new HitAreaOverlay(renderer.hitTester));
        } else {
            renderer.removeSceneOverlay("hit-areas");
        }
    });

    savePngBtn?.addEventListener("click", async () => {
        const blob = renderer.export(new PngBlobExporter({ pixelRatio: 2 }));
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
        const svg = renderer.export(new SvgExporter());
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

    return { explorationToggle, updateCullingStatus, updateTerrainRooms, updateFogOfWar };
}

