export type SvgOverlays = {
    position?: { roomId: number };
    highlights?: Array<{ roomId: number; color: string | string[] }>;
    paths?: Array<{ locations: number[]; color: string }>;
};

export type SvgExportOptions = {
    /** Room ID to center the export on. If omitted, exports the full area. */
    roomId?: number;
    /** Padding in map units around the exported region. Default: 3 */
    padding?: number;
    /** Overlay data (position marker, highlights, paths) to include in the export. */
    overlays?: SvgOverlays;
};
