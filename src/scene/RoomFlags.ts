/**
 * Per-room flags Mudlet stores in {@link MapData.Room.userData}.
 *
 * Mudlet keeps a handful of newer room properties in `userData` (rather than as
 * typed binary fields) so older map files stay forward-compatible. This module
 * is the single place that knows those key strings, so adding a typed source
 * later (e.g. the binary `hidden` field from map format v21+) is a one-line
 * change here rather than a hunt across the renderer.
 */

import type {HiddenRoomMode} from "../types/Settings";

/**
 * userData key Mudlet uses for a room's hidden state on pre-v21 map formats
 * (case-insensitive `"true"`). On v21+ formats Mudlet stores this as a binary
 * `hidden` field instead — which the JSON pipeline does not currently surface,
 * so only maps carrying this fallback key are detected as hidden here.
 */
export const ROOM_UI_HIDDEN = "system.fallback_hidden";

/** userData key for a room's custom border colour. */
export const ROOM_UI_BORDER_COLOR = "room.ui_borderColor";

/** userData key for a room's custom border thickness (Mudlet clamps it to 1..10). */
export const ROOM_UI_BORDER_THICKNESS = "room.ui_borderThickness";

/** Whether Mudlet has marked this room hidden on the 2D map. */
export function isRoomHidden(room: MapData.Room): boolean {
    const v = room.userData?.[ROOM_UI_HIDDEN];
    return typeof v === "string" && v.toLowerCase() === "true";
}

/**
 * Convert a Mudlet QColor string to a CSS colour. Mudlet stores colours via
 * Qt's `QColor::name(HexArgb)` — i.e. `#AARRGGBB` (alpha first), which CSS would
 * misread as `#RRGGBBAA`. Reorder to `#RRGGBB` (dropping a fully-opaque alpha)
 * or `#RRGGBBAA`. Anything else (`#rrggbb`, named, `rgb(...)`) passes through.
 */
function qtColorToCss(value: string): string {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{6})$/.exec(value.trim());
    if (!m) return value;
    const [, alpha, rgb] = m;
    return alpha.toLowerCase() === "ff" ? `#${rgb}` : `#${rgb}${alpha}`;
}

/**
 * The room's custom border colour as a CSS colour, or `undefined` when none is
 * set. Mudlet stores it as a Qt `#AARRGGBB` string (see {@link qtColorToCss}).
 */
export function getRoomBorderColor(room: MapData.Room): string | undefined {
    const v = room.userData?.[ROOM_UI_BORDER_COLOR];
    return v ? qtColorToCss(v) : undefined;
}

/** Opacity applied to hidden rooms in {@link HiddenRoomMode} `"faded"`. */
export const HIDDEN_ROOM_FADE = 0.35;

/**
 * The {@link layoutRoom} options that render a room's hidden state for the given
 * mode (`{}` when the room isn't hidden / the mode draws it normally). Shared by
 * the scene build and the current-room overlay so a redrawn hidden room keeps
 * its fade / dashed border.
 */
export function hiddenRoomLayoutOptions(
    room: MapData.Room,
    mode: HiddenRoomMode,
): {fade?: number; dashedBorder?: boolean} {
    if (!isRoomHidden(room)) return {};
    if (mode === "faded") return {fade: HIDDEN_ROOM_FADE};
    if (mode === "dashed") return {dashedBorder: true};
    return {};
}

/**
 * The room's custom border thickness clamped to Mudlet's 1..10 range, or
 * `undefined` when unset or unparseable.
 */
export function getRoomBorderThickness(room: MapData.Room): number | undefined {
    const raw = room.userData?.[ROOM_UI_BORDER_THICKNESS];
    if (raw === undefined) return undefined;
    const t = parseInt(raw, 10);
    if (!Number.isFinite(t)) return undefined;
    return Math.min(10, Math.max(1, t));
}
