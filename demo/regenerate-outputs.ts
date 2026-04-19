import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const headlessScript = path.join(__dirname, "headless.ts");
const tsconfig = path.join(__dirname, "tsconfig.json");

type Render = { name: string; args: string[] };

const renders: Render[] = [
    // PNG – room centered on 3287 (Verden)
    { name: "default.png",         args: ["--format", "png", "--room", "3287"] },
    { name: "room_closeup.png",    args: ["--format", "png", "--room", "3287", "--padding", "1"] },
    { name: "room_padded.png",     args: ["--format", "png", "--room", "3287", "--padding", "5"] },
    { name: "circles.png",         args: ["--format", "png", "--room", "3287", "--room-shape", "circle"] },
    { name: "rounded.png",         args: ["--format", "png", "--room", "3287", "--room-shape", "roundedRectangle"] },
    { name: "rounded_emboss.png",  args: ["--format", "png", "--room", "3287", "--room-shape", "roundedRectangle", "--emboss"] },
    { name: "frame_mode.png",      args: ["--format", "png", "--room", "3287", "--frame-mode"] },
    { name: "grid.png",            args: ["--format", "png", "--room", "3287", "--grid"] },
    { name: "grid_custom_bg.png",  args: ["--format", "png", "--room", "3287", "--grid", "--bg-color", "#1a1a2e"] },

    // PNG – hi-res full area (Pozostale wyspy Skellige)
    { name: "area_hires.png",      args: ["--format", "png", "--area", "57", "--width", "3840", "--height", "2160", "--label-mode", "data"] },

    // SVG
    { name: "area_full.svg",          args: ["--format", "svg", "--area", "57"] },
    { name: "grid.svg",               args: ["--format", "svg", "--room", "3287", "--grid"] },
    { name: "frame_circle_grid.svg",  args: ["--format", "svg", "--room", "3287", "--frame-mode", "--room-shape", "circle", "--grid"] },
    { name: "room_centered.svg",      args: ["--format", "svg", "--room", "3287"] },
    { name: "pathfinding.svg",        args: ["--format", "svg", "--path", "3287,3300"] },
];

const outputDir = path.join(__dirname, "output");

let failures = 0;
for (const { name, args } of renders) {
    const outputPath = path.join(outputDir, name);
    console.log(`\n→ ${name}`);
    const result = spawnSync(
        "tsx",
        ["--tsconfig", tsconfig, headlessScript, ...args, "--output", outputPath],
        { stdio: "inherit", shell: true },
    );
    if (result.status !== 0) {
        failures++;
        console.error(`  ✗ failed (exit ${result.status})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures}/${renders.length} renders failed.`);
    process.exit(1);
}
console.log(`\nAll ${renders.length} demo outputs regenerated.`);
