import type {Settings} from "../types/Settings";

const DoorColors: Record<number, string> = {
    1: 'rgb(10, 155, 10)',
    2: 'rgb(226, 205, 59)',
    3: 'rgb(155, 10, 10)',
};

export type SpecialExitLineData = {
    points: number[];
    stroke: string;
    strokeWidth: number;
    dash?: number[];
};

export type SpecialExitArrowData = {
    tipX: number; tipY: number;
    x1: number; y1: number;
    x2: number; y2: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
};

export type SpecialExitDoorData = {
    x: number; y: number;
    width: number; height: number;
    stroke: string;
    strokeWidth: number;
};

export type SpecialExitData = {
    line: SpecialExitLineData;
    arrow?: SpecialExitArrowData;
    door?: SpecialExitDoorData;
};

/**
 * Compute draw data for all custom lines (special exits) on a room.
 */
export function computeSpecialExits(room: MapData.Room, settings: Settings, colorOverride?: string): SpecialExitData[] {
    const results: SpecialExitData[] = [];

    for (const [dir, line] of Object.entries(room.customLines)) {
        const points: number[] = [room.x, room.y];
        for (const pt of line.points) {
            points.push(pt.x, -pt.y);
        }

        const strokeColor = colorOverride ?? `rgb(${line.attributes.color.r}, ${line.attributes.color.g}, ${line.attributes.color.b})`;
        let dash: number[] | undefined;
        if (line.attributes.style === "dot line") {
            dash = [0.05, 0.05];
        } else if (line.attributes.style === "dash line") {
            dash = [0.4, 0.2];
        }

        const lineData: SpecialExitLineData = {
            points,
            stroke: strokeColor,
            strokeWidth: settings.lineWidth,
            dash,
        };

        let arrow: SpecialExitArrowData | undefined;
        if (line.attributes.arrow && points.length >= 4) {
            const li = points.length - 2;
            const tipX = points[li], tipY = points[li + 1];
            const prevX = points[li - 2], prevY = points[li - 1];
            const angle = Math.atan2(tipY - prevY, tipX - prevX);
            const pl = 0.3, pw = 0.1;
            arrow = {
                tipX, tipY,
                x1: tipX - pl * Math.cos(angle - Math.atan2(pw, pl)),
                y1: tipY - pl * Math.sin(angle - Math.atan2(pw, pl)),
                x2: tipX - pl * Math.cos(angle + Math.atan2(pw, pl)),
                y2: tipY - pl * Math.sin(angle + Math.atan2(pw, pl)),
                fill: strokeColor,
                stroke: strokeColor,
                strokeWidth: settings.lineWidth,
            };
        }

        let door: SpecialExitDoorData | undefined;
        const doorType = room.doors[dir];
        if (doorType && points.length >= 4) {
            const dx = points[0] + (points[2] - points[0]) / 2;
            const dy = points[1] + (points[3] - points[1]) / 2;
            const s = settings.roomSize / 2;
            door = {
                x: dx - s / 2, y: dy - s / 2,
                width: s, height: s,
                stroke: DoorColors[doorType] ?? DoorColors[3],
                strokeWidth: settings.lineWidth,
            };
        }

        results.push({line: lineData, arrow, door});
    }

    return results;
}
