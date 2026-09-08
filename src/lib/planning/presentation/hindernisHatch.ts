/**
 * Output-space spacing for the Hindernis cross-hatch. The previous canvas
 * implementation stepped by 18 image units; two output pixels/points makes
 * the pattern approximately nine times denser without tying it to map zoom.
 */
export const HINDERNIS_HATCH_SPACING = 2;
export const HINDERNIS_HATCH_STROKE_WIDTH = 0.32;
export const HINDERNIS_HATCH_OPACITY = 0.14;
export const HINDERNIS_HATCH_SOURCE_CELL_SIZE = 4;

export function resolveHindernisHatchPatternScale(stageScale: number): number {
  const safeStageScale = Number.isFinite(stageScale) && stageScale > 0 ? stageScale : 0.01;
  return HINDERNIS_HATCH_SPACING / HINDERNIS_HATCH_SOURCE_CELL_SIZE / safeStageScale;
}
