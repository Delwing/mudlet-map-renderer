import data from "./mapExport.json"
import colors from "./colors.json"
import {Renderer} from "../src";
import MapReader from "../src/reader/MapReader";

const el = document.getElementById("stage") as HTMLDivElement

const renderer = new Renderer(el, new MapReader(data as MapData.Map, colors as MapData.Env[]))
renderer.drawArea(1, 0)
let position = 1;
setInterval(() => {
    renderer.setPosition(position++);
}, 300)
