/**
 * Shape-based {@link Style} implementations — geometry transformers per the
 * {@link Style} interface in `../Style.ts`. Each style takes a {@link Shape}
 * and returns one or more transformed shapes; no backend coupling.
 *
 * Usage:
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
export {constructionShapeStyle} from "./ConstructionStyle";
export {scifiShapeStyle} from "./SciFiStyle";
export {gradientRoomsStyle} from "./GradientRoomsStyle";
export type {GradientRoomsOptions} from "./GradientRoomsStyle";
export {stainedGlassShapeStyle} from "./StainedGlassStyle";
export {graphPaperShapeStyle} from "./GraphPaperStyle";
export {topographicShapeStyle} from "./TopographicStyle";
export {watercolorShapeStyle} from "./WatercolorStyle";
export type {WatercolorOptions} from "./WatercolorStyle";
export {darkModernShapeStyle} from "./DarkModernStyle";
export {treasureMapShapeStyle, treasureMapDecorations} from "./TreasureMapStyle";
export {transitShapeStyle} from "./TransitStyle";
export {circuitShapeStyle, circuitBoardColor} from "./CircuitStyle";
export {terminalShapeStyle} from "./TerminalStyle";
export {pixelArtShapeStyle} from "./PixelStyle";
export type {PixelArtOptions} from "./PixelStyle";
