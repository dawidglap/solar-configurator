export type SymbolPoint = { x: number; y: number };

export type RightAngleSymbolGeometry = {
  firstSide: { start: SymbolPoint; end: SymbolPoint };
  secondSide: { start: SymbolPoint; end: SymbolPoint };
  arcPath: string;
  arcRadius: number;
  dot: SymbolPoint & { radius: number };
  strokeWidth: number;
};

function scalePoint(point: SymbolPoint, scale: number): SymbolPoint {
  return { x: point.x * scale, y: point.y * scale };
}

// Visual-only sizing. Detection, vertex anchoring, and orientation stay in the
// roof renderer; this marker follows world zoom up to a capped close-up size.
const RIGHT_ANGLE_MARKER_VISUAL_SCALE = 7.5;
export const RIGHT_ANGLE_MARKER_HIDE_ZOOM_RATIO = 1.15;
const RIGHT_ANGLE_MARKER_FULL_SIZE_ZOOM_RATIO = 4;

export function resolveRightAngleMarkerWorldScale(input: {
  currentScale: number;
  fitScale: number;
}): number | null {
  if (
    !Number.isFinite(input.currentScale) ||
    !Number.isFinite(input.fitScale) ||
    input.currentScale <= 0 ||
    input.fitScale <= 0
  ) {
    return null;
  }

  const zoomRatio = input.currentScale / input.fitScale;
  if (zoomRatio <= RIGHT_ANGLE_MARKER_HIDE_ZOOM_RATIO) return null;

  const proportionalWorldScale =
    1 / (input.fitScale * RIGHT_ANGLE_MARKER_FULL_SIZE_ZOOM_RATIO);
  const maxScreenSizeWorldScale = 1 / input.currentScale;
  return Math.min(proportionalWorldScale, maxScreenSizeWorldScale);
}

/**
 * Builds a screen-sized right-angle mark in the local coordinate
 * system of a roof vertex. Both side vectors and the bisector point inward.
 */
export function buildRightAngleSymbolGeometry(input: {
  firstSideUnit: SymbolPoint;
  secondSideUnit: SymbolPoint;
  bisectorUnit: SymbolPoint;
  worldUnitsPerMarkerPx: number;
}): RightAngleSymbolGeometry {
  const scale = input.worldUnitsPerMarkerPx * RIGHT_ANGLE_MARKER_VISUAL_SCALE;
  const sideInnerGap = 1.25 * scale;
  const sideOuterRadius = 8 * scale;
  const arcRadius = 5.5 * scale;
  const dotDistance = 2.8 * scale;
  const dotRadius = 0.65 * scale;
  const firstArcPoint = scalePoint(input.firstSideUnit, arcRadius);
  const secondArcPoint = scalePoint(input.secondSideUnit, arcRadius);
  const sweepFlag =
    input.firstSideUnit.x * input.secondSideUnit.y -
      input.firstSideUnit.y * input.secondSideUnit.x >=
    0
      ? 1
      : 0;

  return {
    firstSide: {
      start: scalePoint(input.firstSideUnit, sideInnerGap),
      end: scalePoint(input.firstSideUnit, sideOuterRadius),
    },
    secondSide: {
      start: scalePoint(input.secondSideUnit, sideInnerGap),
      end: scalePoint(input.secondSideUnit, sideOuterRadius),
    },
    arcPath: [
      `M ${firstArcPoint.x} ${firstArcPoint.y}`,
      `A ${arcRadius} ${arcRadius} 0 0 ${sweepFlag} ${secondArcPoint.x} ${secondArcPoint.y}`,
    ].join(" "),
    arcRadius,
    dot: {
      ...scalePoint(input.bisectorUnit, dotDistance),
      radius: dotRadius,
    },
    strokeWidth: 0.9 * scale,
  };
}
