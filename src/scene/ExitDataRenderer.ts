import type {ExitDrawData, ExitDrawLine, ExitDrawArrow, ExitDrawDoor} from "../ExitRenderer";

/**
 * Render ExitDrawData to a Canvas2D context.
 * Shared by the Konva batch shape sceneFunc and the CanvasExporter.
 */
export function drawExitDataToCanvas(ctx: CanvasRenderingContext2D, data: ExitDrawData) {
    for (const line of data.lines) {
        drawLineToCanvas(ctx, line);
    }
    for (const arrow of data.arrows) {
        drawArrowToCanvas(ctx, arrow);
    }
    for (const door of data.doors) {
        drawDoorToCanvas(ctx, door);
    }
}

function drawLineToCanvas(ctx: CanvasRenderingContext2D, line: ExitDrawLine) {
    ctx.beginPath();
    ctx.moveTo(line.points[0], line.points[1]);
    for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i], line.points[i + 1]);
    }
    ctx.strokeStyle = line.stroke;
    ctx.lineWidth = line.strokeWidth;
    ctx.setLineDash(line.dash ?? []);
    ctx.stroke();
}

function drawArrowToCanvas(ctx: CanvasRenderingContext2D, arrow: ExitDrawArrow) {
    // Line part
    ctx.beginPath();
    ctx.moveTo(arrow.points[0], arrow.points[1]);
    for (let i = 2; i < arrow.points.length; i += 2) {
        ctx.lineTo(arrow.points[i], arrow.points[i + 1]);
    }
    ctx.strokeStyle = arrow.stroke;
    ctx.lineWidth = arrow.strokeWidth;
    ctx.setLineDash(arrow.dash ?? []);
    ctx.stroke();

    // Arrowhead
    const lastIdx = arrow.points.length - 2;
    const tipX = arrow.points[lastIdx], tipY = arrow.points[lastIdx + 1];
    const prevX = arrow.points[lastIdx - 2], prevY = arrow.points[lastIdx - 1];
    const angle = Math.atan2(tipY - prevY, tipX - prevX);
    const pl = arrow.pointerLength, pw = arrow.pointerWidth / 2;
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - pl * Math.cos(angle - Math.atan2(pw, pl)), tipY - pl * Math.sin(angle - Math.atan2(pw, pl)));
    ctx.lineTo(tipX - pl * Math.cos(angle + Math.atan2(pw, pl)), tipY - pl * Math.sin(angle + Math.atan2(pw, pl)));
    ctx.closePath();
    ctx.fillStyle = arrow.fill;
    ctx.fill();
    ctx.strokeStyle = arrow.stroke;
    ctx.lineWidth = arrow.strokeWidth;
    ctx.stroke();
}

function drawDoorToCanvas(ctx: CanvasRenderingContext2D, door: ExitDrawDoor) {
    ctx.beginPath();
    ctx.rect(door.x, door.y, door.width, door.height);
    ctx.strokeStyle = door.stroke;
    ctx.lineWidth = door.strokeWidth;
    ctx.setLineDash([]);
    ctx.stroke();
}

/**
 * Render ExitDrawData to SVG string lines.
 * Shared by the SvgExporter.
 */
export function drawExitDataToSvgLines(lines: string[], data: ExitDrawData) {
    for (const line of data.lines) {
        if (line.points.length < 4) continue;
        const points = line.points.map(p => p.toString()).join(' ');
        const dash = line.dash ? ` stroke-dasharray="${line.dash.join(' ')}"` : '';
        lines.push(`<polyline points="${points}" stroke="${escapeXml(line.stroke)}" stroke-width="${line.strokeWidth}" fill="none"${dash}/>`);
    }
    for (const arrow of data.arrows) {
        if (arrow.points.length < 4) continue;
        const points = arrow.points.map(p => p.toString()).join(' ');
        const dash = arrow.dash ? ` stroke-dasharray="${arrow.dash.join(' ')}"` : '';
        lines.push(`<polyline points="${points}" stroke="${escapeXml(arrow.stroke)}" stroke-width="${arrow.strokeWidth}" fill="none"${dash}/>`);

        const lastIdx = arrow.points.length - 2;
        const tipX = arrow.points[lastIdx], tipY = arrow.points[lastIdx + 1];
        const prevX = arrow.points[lastIdx - 2], prevY = arrow.points[lastIdx - 1];
        const angle = Math.atan2(tipY - prevY, tipX - prevX);
        const pl = arrow.pointerLength, pw = arrow.pointerWidth / 2;
        const x1 = tipX - pl * Math.cos(angle - Math.atan2(pw, pl));
        const y1 = tipY - pl * Math.sin(angle - Math.atan2(pw, pl));
        const x2 = tipX - pl * Math.cos(angle + Math.atan2(pw, pl));
        const y2 = tipY - pl * Math.sin(angle + Math.atan2(pw, pl));
        lines.push(`<polygon points="${tipX},${tipY} ${x1},${y1} ${x2},${y2}" fill="${escapeXml(arrow.fill)}" stroke="${escapeXml(arrow.stroke)}" stroke-width="${arrow.strokeWidth}"/>`);
    }
    for (const door of data.doors) {
        lines.push(`<rect x="${door.x}" y="${door.y}" width="${door.width}" height="${door.height}" stroke="${escapeXml(door.stroke)}" stroke-width="${door.strokeWidth}" fill="none"/>`);
    }
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
