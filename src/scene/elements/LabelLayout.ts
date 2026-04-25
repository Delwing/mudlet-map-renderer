import type {Settings} from "../../types/Settings";
import type {GroupShape, Shape} from "../Shape";

function getLabelColor(color: MapData.Color): string {
    const alpha = (color?.alpha ?? 255) / 255;
    const clamp = (value: number) => Math.min(255, Math.max(0, value ?? 0));
    return `rgba(${clamp(color?.r)}, ${clamp(color?.g)}, ${clamp(color?.b)}, ${alpha})`;
}

/**
 * Pure layout for one user-defined label. Returns a {@link GroupShape}, or
 * `null` when the label is suppressed by `labelRenderMode === "none"`.
 *
 * `noScaling` labels are anchored at (X, -Y) with content at (0,0) so the
 * RecordingLayerNode can cancel out stage zoom for those groups only — the
 * group origin / child origin split mirrors that requirement.
 */
export function labelToShape(label: MapData.Label, settings: Settings): GroupShape | null {
    if (settings.labelRenderMode === "none") return null;

    const lx = label.X;
    const ly = -label.Y;
    const noScaling = !!label.noScaling;
    const gx = noScaling ? lx : 0;
    const gy = noScaling ? ly : 0;
    const cx = noScaling ? 0 : lx;
    const cy = noScaling ? 0 : ly;

    if (settings.labelRenderMode === "image" && label.pixMap) {
        return {
            type: "group",
            x: gx,
            y: gy,
            layer: label.showOnTop ? "top" : "link",
            noScale: noScaling,
            hit: {kind: "label", payload: label},
            children: [{
                type: "image",
                x: cx,
                y: cy,
                width: label.Width,
                height: label.Height,
                src: `data:image/png;base64,${label.pixMap}`,
            }],
        };
    }

    const children: Shape[] = [];

    if ((label.BgColor?.alpha ?? 0) > 0 && !settings.transparentLabels) {
        children.push({
            type: "rect",
            x: cx,
            y: cy,
            width: label.Width,
            height: label.Height,
            paint: {fill: getLabelColor(label.BgColor)},
        });
    }

    if (label.Text) {
        const ratio = Math.min(0.75, label.Width / Math.max(label.Text.length / 2, 1));
        const fontSize = Math.max(0.1, Math.min(ratio, Math.max(label.Height * 0.9, 0.1)));
        children.push({
            type: "text",
            x: cx,
            y: cy,
            width: label.Width,
            height: label.Height,
            text: label.Text,
            fontSize,
            fill: getLabelColor(label.FgColor),
            align: "center",
            verticalAlign: "middle",
        });
    }

    return {
        type: "group",
        x: gx,
        y: gy,
        layer: label.showOnTop ? "top" : "link",
        noScale: noScaling,
        hit: {kind: "label", payload: label},
        children,
    };
}
