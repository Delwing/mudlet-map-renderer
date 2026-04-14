import "konva/canvas-backend";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) { console.log("Usage: tsx scripts/diff-png-detail.ts <a.png> <b.png>"); process.exit(1); }

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
    const regions = new Map<string, number>();
    const samples: string[] = [];

    for (let i = 0; i < dA.length; i += 4) {
        if (dA[i] !== dB[i] || dA[i+1] !== dB[i+1] || dA[i+2] !== dB[i+2] || dA[i+3] !== dB[i+3]) {
            diff++;
            const px = (i / 4) % w;
            const py = Math.floor(i / 4 / w);
            // Group into 100x100 regions
            const rx = Math.floor(px / 100) * 100;
            const ry = Math.floor(py / 100) * 100;
            const key = `${rx},${ry}`;
            regions.set(key, (regions.get(key) ?? 0) + 1);

            if (samples.length < 20) {
                const dr = Math.abs(dA[i] - dB[i]);
                const dg = Math.abs(dA[i+1] - dB[i+1]);
                const db = Math.abs(dA[i+2] - dB[i+2]);
                samples.push(`  (${px},${py}): rgba(${dA[i]},${dA[i+1]},${dA[i+2]},${dA[i+3]}) → rgba(${dB[i]},${dB[i+1]},${dB[i+2]},${dB[i+3]}) Δ=${dr+dg+db}`);
            }
        }
    }

    console.log(`${w}x${h}: ${diff} diff pixels (${(diff/(w*h)*100).toFixed(4)}%)`);
    if (diff === 0) return;

    console.log(`\nDiff regions (100x100 blocks):`);
    const sorted = [...regions.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted.slice(0, 15)) {
        console.log(`  block ${key}: ${count} pixels`);
    }

    console.log(`\nSamples:`);
    samples.forEach(s => console.log(s));
}
compare(fileA, fileB).catch(console.error);
