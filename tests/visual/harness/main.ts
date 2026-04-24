import { MapRenderer, KonvaLayerManager, createSettings } from '../../../src';
import MapReader from '../../../src/reader/MapReader';
import testMap from '../../fixtures/test-map.json';
import testEnvs from '../../fixtures/test-envs.json';

const params = new URLSearchParams(window.location.search);

function param(key: string): string | null {
    return params.get(key);
}

function boolParam(key: string): boolean {
    return param(key) === '1' || param(key) === 'true';
}

// Build MapReader (deep clone since it mutates)
const map = JSON.parse(JSON.stringify(testMap)) as MapData.Map;
const envs = JSON.parse(JSON.stringify(testEnvs)) as MapData.Env[];
const mapReader = new MapReader(map, envs);

// Settings from query params
const settings = createSettings();
if (param('roomShape')) settings.roomShape = param('roomShape') as any;
if (boolParam('frameMode')) settings.frameMode = true;
if (boolParam('coloredMode')) settings.coloredMode = true;
if (boolParam('emboss')) settings.emboss = true;
if (boolParam('grid')) settings.gridEnabled = true;
if (param('borders') === '0') settings.borders = false;
if (boolParam('areaName')) settings.areaName = true;
if (param('bg')) settings.backgroundColor = param('bg')!;

const areaId = parseInt(param('area') ?? '1');
const zIndex = parseInt(param('z') ?? '0');
const roomId = param('room') ? parseInt(param('room')!) : undefined;
const positionId = param('position') ? parseInt(param('position')!) : undefined;
const highlightsRaw = param('highlights'); // format: "roomId:color,roomId:color"
const pathRaw = param('path'); // format: "roomId,roomId,roomId"
const pathColor = param('pathColor') ?? '#66E64D';
const zoom = param('zoom') ? parseFloat(param('zoom')!) : undefined;
const fitAreaMode = boolParam('fitArea');
const centerOnId = param('centerOn') ? parseInt(param('centerOn')!) : undefined;

// Create renderer
const container = document.getElementById('stage') as HTMLDivElement;
const renderer = new MapRenderer(mapReader, settings);
new KonvaLayerManager(container, renderer);

// Draw area
renderer.drawArea(areaId, zIndex);

// If a specific room is given, center on it
if (roomId !== undefined) {
    renderer.setPosition(roomId, true);
}

// Position marker (can differ from centered room)
if (positionId !== undefined && positionId !== roomId) {
    renderer.setPosition(positionId, false);
}

// Highlights
if (highlightsRaw) {
    highlightsRaw.split(',').forEach(entry => {
        const [rid, color] = entry.split(':');
        if (rid && color) {
            renderer.renderHighlight(parseInt(rid), color);
        }
    });
}

// Path
if (pathRaw) {
    const locations = pathRaw.split(',').map(Number);
    renderer.renderPath(locations, pathColor);
}

// Viewport controls
if (fitAreaMode) {
    renderer.fitArea();
}

if (zoom !== undefined) {
    renderer.zoomToCenter(zoom);
}

if (centerOnId !== undefined) {
    renderer.centerOn(centerOnId, true);
}

// Signal to Playwright that rendering is complete
(window as any).__HARNESS_READY__ = true;
window.dispatchEvent(new Event('harness-ready'));
