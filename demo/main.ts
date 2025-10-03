import data from "./mapExport.json"
import colors from "./colors.json"
import {Renderer} from "@src";
import MapReader from "@src/reader/MapReader";

const el = document.getElementById("stage") as HTMLDivElement

const renderer = new Renderer(el, new MapReader(data as MapData.Map, colors as MapData.Env[]))
let index = 1;
renderer.setPosition(1)
const path = renderer.renderPath([1,2,3])
setTimeout(() => {
    renderer.clearPaths()
}, 1000)