/**
 * Shape-based {@link Style} implementations — geometry transformers per the
 * new {@link Style} interface in `../Style.ts`. Each style takes a
 * {@link Shape} and returns one or more transformed shapes; no backend
 * coupling.
 *
 * These coexist with the legacy {@link DrawingBackend}-decorator versions in
 * the parent directory until step 11 of the refactor deletes the old ones.
 *
 * Usage (pre-wired via DrawCommandBuilder + KonvaRenderer in step 5/8):
 * ```ts
 * import {compose} from "../Style";
 * import {parchmentShapeStyle, sketchyShapeStyle} from "./shape";
 *
 * const style = compose(parchmentShapeStyle, sketchyShapeStyle({
 *     jitter: 0.012,
 *     color: '#4a3728',
 * }));
 * ```
 */

export {parchmentShapeStyle} from "./ParchmentStyle";
export {blueprintShapeStyle} from "./BlueprintStyle";
export {neonShapeStyle} from "./NeonStyle";
export {sketchyShapeStyle} from "./SketchyStyle";
export type {SketchyOptions} from "./SketchyStyle";
export {isometricShapeStyle} from "./IsometricStyle";
export type {IsometricOptions, IsometricRotation} from "./IsometricStyle";
