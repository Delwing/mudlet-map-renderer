/**
 * Forward / inverse 2D coordinate transform. Used by camera-aware code that
 * needs to translate between world space (the map's flat XY) and scene space
 * (whatever the active style projects into — e.g. an isometric diamond).
 *
 * `IDENTITY_TRANSFORM` returns the input unchanged; flat styles (Parchment,
 * Sketchy, plain identity) use it for both the forward and inverse direction.
 */

export type CoordFn = (x: number, y: number) => { x: number; y: number };

export const IDENTITY_TRANSFORM: CoordFn = (x, y) => ({x, y});
