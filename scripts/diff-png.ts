import "konva/canvas-backend";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.log("Usage: tsx scripts/diff-png.ts <a.png> <b.png>"); process.exit(1); }

async function compare(pathA: string, pathB: string) {
    const imgA = await loadImage(fs.readFileSync(path.resolve(pathA)));
    const imgB = await loadImage(fs.readFileSync(path.resolve(pathB)));
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        console.log(`Size mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`);
        return;
    }
    const w = imgA.width, h = imgA.height;
    const cA = createCanvas(w, h); cA.getContext("2d").drawImage(imgA, 0, 0);
    const cB = createCanvas(w, h); cB.getContext("2d").drawImage(imgB, 0, 0);
    const dA = cA.getContext("2d").getImageData(0, 0, w, h).data;
    const dB = cB.getContext("2d").getImageData(0, 0, w, h).data;
    let diff = 0;
    for (let i = 0; i < dA.length; i += 4) {
        if (dA[i] !== dB[i] || dA[i+1] !== dB[i+1] || dA[i+2] !== dB[i+2] || dA[i+3] !== dB[i+3]) diff++;
    }
    console.log(`${w}x${h}: ${diff === 0 ? "IDENTICAL" : `${diff} diff pixels (${(diff/(w*h)*100).toFixed(4)}%)`}`);
}
compare(fileA, fileB).catch(console.error);
