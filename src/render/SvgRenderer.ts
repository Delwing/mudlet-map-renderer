/**
 * SvgRenderer — flushes {@link DrawCommandBatch}es to a list of SVG element
 * strings.
 *
 * Coordinates in commands are already in render space (camera transform
 * applied), so primitives map directly to SVG attributes. Stack commands
 * (`pushTransform`/`popTransform`, `pushClip`/`popClip`) wrap the elements
 * emitted between them in `<g transform=…>` / `<g clip-path=…>` groups.
 */

import type {
    DrawCommand,
    DrawCommandBatch,
    PrimitiveDrawCommand,
} from "../draw/DrawCommand";
import type {FillStyle, LinearGradient, RadialGradient} from "../scene/Shape";

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function attr(name: string, value: string | number | undefined): string {
    if (value === undefined) return "";
    return ` ${name}="${typeof value === "string" ? escapeXml(value) : value}"`;
}

function dashAttr(dash: number[] | undefined): string {
    if (!dash || dash.length === 0) return "";
    return ` stroke-dasharray="${dash.join(" ")}"`;
}

/**
 * Monotonically increasing id source for gradient `<linearGradient>` /
 * `<radialGradient>` elements emitted by {@link svgFromBatches}. The
 * exporter can call `svgFromBatches` many times per document; using a
 * module-level counter keeps ids unique across calls without forcing
 * callers to manage state.
 */
let _gradId = 0;
function nextGradientId(): string {
    return `mmr-grad-${++_gradId}`;
}

function emitLinearGradient(id: string, g: LinearGradient): string {
    const stops = g.stops
        .map(s => `<stop offset="${s.offset}" stop-color="${escapeXml(s.color)}"/>`)
        .join("");
    return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x0}" y1="${g.y0}" x2="${g.x1}" y2="${g.y1}">${stops}</linearGradient></defs>`;
}

function emitRadialGradient(id: string, g: RadialGradient): string {
    const stops = g.stops
        .map(s => `<stop offset="${s.offset}" stop-color="${escapeXml(s.color)}"/>`)
        .join("");
    const focalAttrs =
        (g.fx !== undefined ? ` fx="${g.fx}"` : "") +
        (g.fy !== undefined ? ` fy="${g.fy}"` : "") +
        (g.fr !== undefined ? ` fr="${g.fr}"` : "");
    return `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${g.cx}" cy="${g.cy}" r="${g.r}"${focalAttrs}>${stops}</radialGradient></defs>`;
}

/**
 * Resolve a {@link FillStyle} for an SVG `fill=` attribute. Strings pass
 * through. Gradients allocate an id, emit a `<defs>` block into `out`, and
 * return the `url(#id)` reference for the caller to plug into the attribute.
 */
function resolveSvgFill(fill: FillStyle | undefined, out: string[]): string | undefined {
    if (fill === undefined) return undefined;
    if (typeof fill === "string") return fill;
    const id = nextGradientId();
    out.push(fill.type === "linear" ? emitLinearGradient(id, fill) : emitRadialGradient(id, fill));
    return `url(#${id})`;
}

/**
 * Convert one or more {@link DrawCommandBatch}es into SVG element strings, in
 * the order they appear. Caller wraps the result in `<svg viewBox=…>` /
 * `</svg>` and inserts a background rect.
 */
export function svgFromBatches(batches: DrawCommandBatch[]): string[] {
    const lines: string[] = [];
    for (const batch of batches) {
        emitCommands(batch.commands, lines);
    }
    return lines;
}

function emitCommands(commands: DrawCommand[], out: string[]): void {
    // Walk commands sequentially. Stack commands open/close `<g>` wrappers,
    // tracked via a stack of insertion indices so the closing `</g>` is
    // appended in the correct position.
    const groupStack: string[] = [];

    for (const cmd of commands) {
        switch (cmd.type) {
            case "pushTransform": {
                const [a, b, c, d, e, f] = cmd.matrix;
                out.push(`<g transform="matrix(${a},${b},${c},${d},${e},${f})">`);
                groupStack.push("</g>");
                break;
            }
            case "pushClip": {
                // No clipPath element emitted yet — most Mudlet exporters don't
                // need it. Fall back to a transparent group so the corresponding
                // pop balances correctly.
                out.push(`<g>`);
                groupStack.push("</g>");
                break;
            }
            case "popTransform":
            case "popClip": {
                const close = groupStack.pop();
                if (close) out.push(close);
                break;
            }
            default: {
                emitPrimitive(cmd, out);
                break;
            }
        }
    }

    while (groupStack.length > 0) {
        out.push(groupStack.pop()!);
    }
}

function emitPrimitive(cmd: PrimitiveDrawCommand, out: string[]): void {
    switch (cmd.type) {
        case "rect": {
            const fill = resolveSvgFill(cmd.fill, out) ?? "none";
            const corner = cmd.cr > 0 ? `${attr("rx", cmd.cr)}${attr("ry", cmd.cr)}` : "";
            out.push(`<rect${attr("x", cmd.x)}${attr("y", cmd.y)}${attr("width", cmd.w)}${attr("height", cmd.h)}${attr("fill", fill)}${attr("stroke", cmd.stroke)}${cmd.sw ? attr("stroke-width", cmd.sw) : ""}${corner}${dashAttr(cmd.dash)}/>`);
            return;
        }
        case "circle": {
            const fill = resolveSvgFill(cmd.fill, out) ?? "none";
            out.push(`<circle${attr("cx", cmd.cx)}${attr("cy", cmd.cy)}${attr("r", cmd.r)}${attr("fill", fill)}${attr("stroke", cmd.stroke)}${cmd.sw ? attr("stroke-width", cmd.sw) : ""}${dashAttr(cmd.dash)}/>`);
            return;
        }
        case "line": {
            const points = cmd.points;
            if (points.length < 2) return;
            const svgPoints: string[] = [];
            for (let i = 0; i < points.length; i += 2) {
                svgPoints.push(`${points[i]},${points[i + 1]}`);
            }
            out.push(`<polyline points="${svgPoints.join(" ")}"${attr("stroke", cmd.stroke)}${cmd.sw ? attr("stroke-width", cmd.sw) : ""}${dashAttr(cmd.dash)}${attr("stroke-linecap", cmd.lineCap)}${attr("stroke-linejoin", cmd.lineJoin)}${attr("opacity", cmd.alpha)} fill="none"/>`);
            return;
        }
        case "polygon": {
            const verts = cmd.vertices;
            if (verts.length < 4) return;
            const svgPoints: string[] = [];
            for (let i = 0; i < verts.length; i += 2) {
                svgPoints.push(`${verts[i]},${verts[i + 1]}`);
            }
            const fill = resolveSvgFill(cmd.fill, out);
            out.push(`<polygon points="${svgPoints.join(" ")}"${attr("fill", fill)}${attr("stroke", cmd.stroke)}${cmd.sw ? attr("stroke-width", cmd.sw) : ""}/>`);
            return;
        }
        case "text": {
            // SVG text positioning matches the legacy SvgBackend: alignment
            // collapses width into an anchor (left/middle/end), vertical
            // centering uses either an explicit baseline ratio or the SVG
            // `dominant-baseline="central"` shortcut.
            let x = cmd.x;
            let y = cmd.y;
            let anchor = "start";
            let baseline = "auto";

            if (cmd.w > 0) {
                if (cmd.align === "center") {
                    x = cmd.x + cmd.w / 2;
                    anchor = "middle";
                } else if (cmd.align === "right") {
                    x = cmd.x + cmd.w;
                    anchor = "end";
                }
            }
            if (cmd.h > 0 && cmd.vAlign === "middle") {
                if (cmd.baselineRatio !== undefined) {
                    y = cmd.y + cmd.h / 2 + cmd.baselineRatio * cmd.fontSize;
                } else {
                    y = cmd.y + cmd.h / 2;
                    baseline = "central";
                }
            }

            const transformAttr = cmd.transform
                ? ` transform="matrix(${cmd.transform.join(",")})"`
                : "";
            const weight = cmd.fontStyle === "bold" ? ` font-weight="bold"` : "";
            const strokeAttr = cmd.stroke && cmd.sw > 0
                ? ` stroke="${cmd.stroke}" stroke-width="${cmd.sw}" paint-order="stroke fill"`
                : "";
            out.push(`<text${attr("x", x)}${attr("y", y)}${attr("font-size", cmd.fontSize)}${cmd.fontFamily ? attr("font-family", cmd.fontFamily) : ""}${weight}${attr("fill", cmd.fill)}${strokeAttr} text-anchor="${anchor}" dominant-baseline="${baseline}"${transformAttr}>${escapeXml(cmd.text)}</text>`);
            return;
        }
        case "image": {
            if (cmd.transform) {
                const [a, b, c, d, e, f] = cmd.transform;
                out.push(`<image${attr("width", cmd.w)}${attr("height", cmd.h)} href="${escapeXml(cmd.src)}" transform="matrix(${a},${b},${c},${d},${e},${f})"/>`);
                return;
            }
            out.push(`<image${attr("x", cmd.x)}${attr("y", cmd.y)}${attr("width", cmd.w)}${attr("height", cmd.h)} href="${escapeXml(cmd.src)}"/>`);
            return;
        }
    }
}
