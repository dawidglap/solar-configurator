export const ROOF_LABEL_MIN_ZOOM_RATIO = 1.3;

/** Roof labels are screen-sized, so hide them near the fitted overview scale. */
export function shouldShowRoofLabels(currentScale: number, fitScale: number): boolean {
  if (!Number.isFinite(currentScale) || !Number.isFinite(fitScale) || fitScale <= 0) {
    return true;
  }
  return currentScale / fitScale >= ROOF_LABEL_MIN_ZOOM_RATIO;
}
