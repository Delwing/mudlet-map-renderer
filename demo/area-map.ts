import {AreaMapRenderer, DomainFilter, AreaDomainInfo} from "@src";
import MapReader from "@src/reader/MapReader";

const stageElement = document.getElementById("stage") as HTMLDivElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const areaInfoElement = document.getElementById("area-info") as HTMLDivElement;
const fitViewButton = document.getElementById("fit-view") as HTMLButtonElement;
const resetZoomButton = document.getElementById("reset-zoom") as HTMLButtonElement;
const domainSelect = document.getElementById("domain-select") as HTMLSelectElement;
const bgScaleSlider = document.getElementById("bg-scale-slider") as HTMLInputElement;
const bgScaleValue = document.getElementById("bg-scale-value") as HTMLSpanElement;
const bgXSlider = document.getElementById("bg-x-slider") as HTMLInputElement;
const bgXValue = document.getElementById("bg-x-value") as HTMLSpanElement;
const bgYSlider = document.getElementById("bg-y-slider") as HTMLInputElement;
const bgYValue = document.getElementById("bg-y-value") as HTMLSpanElement;
const bgOpacitySlider = document.getElementById("bg-opacity-slider") as HTMLInputElement;
const bgOpacityValue = document.getElementById("bg-opacity-value") as HTMLSpanElement;
const dotsModeToggle = document.getElementById("dots-mode-toggle") as HTMLInputElement;

const mapDataUrl = new URL("./mapExport.json", import.meta.url).href;
const colorDataUrl = new URL("./colors.json", import.meta.url).href;

let mapReader: MapReader;
let areaRenderer: AreaMapRenderer;
let selectedAreaId: number | undefined;

const areaDomains: Record<number, AreaDomainInfo> = {
    1: {isIshtar: true, isEmpire: false}, // Wyzima
    2: {isIshtar: true, isEmpire: false}, // Poludniowa Redania
    3: {isIshtar: true, isEmpire: false}, // Lyria i Rivia
    4: {isIshtar: true, isEmpire: false}, // Poludniowy Mahakam
    5: {isIshtar: true, isEmpire: false}, // Poludniowa Temeria
    6: {isIshtar: true, isEmpire: false}, // Brugge
    7: {isIshtar: true, isEmpire: false}, // Oxenfurt
    8: {isIshtar: true, isEmpire: false}, // Okolice Novigradu
    9: {isIshtar: true, isEmpire: false}, // Novigrad
    10: {isIshtar: true, isEmpire: false}, // Scala
    11: {isIshtar: true, isEmpire: false}, // Wschodni Mahakam
    12: {isIshtar: true, isEmpire: false}, // Zachodni Mahakam
    13: {isIshtar: true, isEmpire: false}, // Twierdza pod Gora Carbon
    14: {isIshtar: true, isEmpire: false}, // Hagge
    15: {isIshtar: true, isEmpire: false}, // Wschodnia Redania
    16: {isIshtar: true, isEmpire: false}, // Tretogor
    17: {isIshtar: true, isEmpire: false}, // Verden
    18: {isIshtar: true, isEmpire: false}, // Zachodnia Temeria
    19: {isIshtar: true, isEmpire: false}, // Polnocna Redania
    20: {isIshtar: true, isEmpire: false}, // Poludniowe Kaedwen
    21: {isIshtar: true, isEmpire: false}, // Aedirn
    22: {isIshtar: true, isEmpire: false}, // Ard Carraigh
    23: {isIshtar: true, isEmpire: false}, // Daevon
    25: {isIshtar: false, isEmpire: true}, // Quenelles
    26: {isIshtar: false, isEmpire: true}, // Salignac
    27: {isIshtar: false, isEmpire: true}, // Wissenland
    28: {isIshtar: false, isEmpire: true}, // Polnocna Tilea
    29: {isIshtar: false, isEmpire: true}, // Ebino
    30: {isIshtar: false, isEmpire: true}, // Campogrotta
    31: {isIshtar: false, isEmpire: true}, // Scorcio
    32: {isIshtar: false, isEmpire: true}, // Viadaza
    33: {isIshtar: false, isEmpire: true}, // Urbimo
    34: {isIshtar: false, isEmpire: true}, // Averland
    35: {isIshtar: false, isEmpire: true}, // Stirland
    36: {isIshtar: false, isEmpire: true}, // Kraina Zgromadzenia
    37: {isIshtar: false, isEmpire: true}, // Nuln
    38: {isIshtar: false, isEmpire: true}, // Reikland
    39: {isIshtar: false, isEmpire: true}, // Parravon
    40: {isIshtar: false, isEmpire: true}, // Masyw Orcal
    41: {isIshtar: true, isEmpire: false}, // Gory Sine
    42: {isIshtar: true, isEmpire: false}, // Baccala
    43: {isIshtar: true, isEmpire: false}, // Ard Skellig
    44: {isIshtar: false, isEmpire: true}, // Varieno
    45: {isIshtar: false, isEmpire: false}, // Wyspa Slubow
    46: {isIshtar: false, isEmpire: true}, // Okolice KZ
    47: {isIshtar: false, isEmpire: true}, // Gory Czarne
    48: {isIshtar: false, isEmpire: true}, // Karak Varn
    49: {isIshtar: false, isEmpire: true}, // Las obok Salignac
    50: {isIshtar: false, isEmpire: true}, // Pustkowia Chaosu
    51: {isIshtar: false, isEmpire: true}, // Gory Kranca Swiata
    52: {isIshtar: false, isEmpire: true}, // Ziemie Czaszki
    53: {isIshtar: false, isEmpire: true}, // Karak Kadrin
    55: {isIshtar: true, isEmpire: false}, // Pustynia Zerrikanska
    56: {isIshtar: true, isEmpire: false}, // Val'kare
    57: {isIshtar: true, isEmpire: false}, // Pozostale wyspy Skellige
    59: {isIshtar: false, isEmpire: true}, // Athel Loren
    60: {isIshtar: true, isEmpire: false}, // Mahakam - OHM
    61: {isIshtar: false, isEmpire: false}, // Statki
    62: {isIshtar: false, isEmpire: true}, // Pustkowia - okolice
    63: {isIshtar: false, isEmpire: false}, // Sterowiec SGW
};

async function loadJson<T>(url: string, label: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${label}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}


// Background config state
const bgConfig = {
    baseWidth: 1600,
    baseHeight: 1200,
    scale: 1.0,
    x: -400,
    y: -300,
    opacity: 0.25,
};

async function initialize() {
    try {
        const [mapData, colorData] = await Promise.all([
            loadJson<MapData.Map>(mapDataUrl, "mapExport.json"),
            loadJson<MapData.Env[]>(colorDataUrl, "colors.json"),
        ]);
        mapReader = new MapReader(mapData, colorData);
    } catch (error) {
        console.error("Failed to load map data", error);
        statusElement.textContent = "Failed to load map data.";
        return;
    }

    areaRenderer = new AreaMapRenderer(stageElement, mapReader);
    areaRenderer.setDomainInfo(areaDomains);
    areaRenderer.setDomainFilter("empire"); // Default to Empire
    areaRenderer.render();

    // Set the select element to match
    if (domainSelect) {
        domainSelect.value = "empire";
    }

    updateStatus();
    attachEventListeners();
}

function updateStatus() {
    const connectionGroups = areaRenderer.getConnectionGroups();
    const totalConnections = connectionGroups.reduce((sum, g) => sum + g.connections.length, 0);
    const filter = areaRenderer.getDomainFilter();
    const domainName = filter === "ishtar" ? "Ishtar" : filter === "empire" ? "Empire" : "Interdomain";

    statusElement.innerHTML = `
        <strong>${domainName}</strong> domain<br/>
        <strong>${(areaRenderer as any).areaNodes?.size ?? 0}</strong> areas<br/>
        <strong>${connectionGroups.length}</strong> area pairs connected<br/>
        <strong>${totalConnections}</strong> total cross-area exits
    `;
}

function attachEventListeners() {
    stageElement.addEventListener("areaclick", (event) => {
        const customEvent = event as CustomEvent<{areaId: number}>;
        const {areaId} = customEvent.detail;

        if (selectedAreaId === areaId) {
            selectedAreaId = undefined;
            areaRenderer.highlightArea(undefined);
            updateAreaInfo(undefined);
        } else {
            selectedAreaId = areaId;
            areaRenderer.highlightArea(areaId);
            areaRenderer.centerOnArea(areaId);
            updateAreaInfo(areaId);
        }
    });

    fitViewButton?.addEventListener("click", () => {
        areaRenderer.render();
        updateStatus();
    });

    resetZoomButton?.addEventListener("click", () => {
        areaRenderer.setZoom(1);
        areaRenderer.render();
        updateStatus();
    });

    domainSelect?.addEventListener("change", () => {
        const filter = domainSelect.value as DomainFilter;
        areaRenderer.setDomainFilter(filter);
        areaRenderer.render();
        selectedAreaId = undefined;
        updateAreaInfo(undefined);
        updateStatus();
    });

    // Background control sliders
    bgScaleSlider?.addEventListener("input", () => {
        bgConfig.scale = parseFloat(bgScaleSlider.value);
        bgScaleValue.textContent = bgConfig.scale.toFixed(1);
    });

    bgXSlider?.addEventListener("input", () => {
        bgConfig.x = parseInt(bgXSlider.value);
        bgXValue.textContent = bgConfig.x.toString();
    });

    bgYSlider?.addEventListener("input", () => {
        bgConfig.y = parseInt(bgYSlider.value);
        bgYValue.textContent = bgConfig.y.toString();
    });

    bgOpacitySlider?.addEventListener("input", () => {
        bgConfig.opacity = parseFloat(bgOpacitySlider.value);
        bgOpacityValue.textContent = bgConfig.opacity.toFixed(2);
    });

    dotsModeToggle?.addEventListener("change", () => {
        areaRenderer.setDotsMode(dotsModeToggle.checked);
        areaRenderer.redraw();
    });
}

function updateAreaInfo(areaId: number | undefined) {
    if (!areaId) {
        areaInfoElement.innerHTML = "";
        return;
    }

    const area = mapReader.getArea(areaId);
    const node = areaRenderer.getAreaNode(areaId);

    if (!area || !node) {
        areaInfoElement.innerHTML = "";
        return;
    }

    // Group connections by target area
    const connectionsByArea = new Map<number, Array<{fromRoom: number; toRoom: number}>>();
    for (const conn of node.connections) {
        if (!connectionsByArea.has(conn.toAreaId)) {
            connectionsByArea.set(conn.toAreaId, []);
        }
        connectionsByArea.get(conn.toAreaId)!.push({
            fromRoom: conn.fromRoomId,
            toRoom: conn.toRoomId,
        });
    }

    // Build list of connected areas with names and room details
    const connectedAreasList = Array.from(connectionsByArea.entries())
        .map(([targetAreaId, connections]) => {
            const targetArea = mapReader.getArea(targetAreaId);
            const name = targetArea?.getAreaName() ?? `Area ${targetAreaId}`;
            const roomList = connections
                .map(c => `${c.fromRoom} → ${c.toRoom}`)
                .join(", ");
            return `<li><strong>${name}</strong> (${connections.length})<br/><span style="color: #8ee7ff; font-size: 0.75rem;">${roomList}</span></li>`;
        })
        .join("");

    areaInfoElement.innerHTML = `
        <div><span class="label">Selected:</span> ${area.getAreaName()}</div>
        <div><span class="label">Area ID:</span> ${areaId}</div>
        <div><span class="label">Rooms:</span> ${node.roomCount}</div>
        <div><span class="label">Connected to:</span> ${connectionsByArea.size} areas</div>
        ${connectedAreasList ? `<ul style="margin: 0.25rem 0 0 0; padding-left: 1.2rem; font-size: 0.8rem; list-style: none;">${connectedAreasList}</ul>` : ''}
    `;
}

void initialize();
