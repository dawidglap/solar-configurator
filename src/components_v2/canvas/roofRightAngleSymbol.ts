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

/**
 * Builds a compact screen-sized right-angle mark in the local coordinate
 * system of a roof vertex. Both side vectors and the bisector point inward.
 */
export function buildRightAngleSymbolGeometry(input: {
  firstSideUnit: SymbolPoint;
  secondSideUnit: SymbolPoint;
  bisectorUnit: SymbolPoint;
  imagePxPerScreenPx: number;
}): RightAngleSymbolGeometry {
  const scale = input.imagePxPerScreenPx;
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
