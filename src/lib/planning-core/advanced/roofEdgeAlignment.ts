import { analyzeRectangularRoof } from "../geometry-v2";
import type { MetricPoint } from "../geometry-v2";
import { normalizeGeographicAzimuth } from "./moduleGeometry";

export type RoofEdgeAlignment = {
  /** K2 block-local X axis follows this canvas edge direction. */
  faceAzimuthDeg: number;
  source: "rectangle-main-axis" | "longest-edge";
  edgeIndex: number;
};

function canvasAngleDeg(start: MetricPoint, end: MetricPoint): number {
  return normalizeGeographicAzimuth(
    (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
  ) % 180;
}

/**
 * K2 Dome definitions use face azimuth as block-local +Y. Under the existing
 * Advanced transform, block-local +X has the same numeric canvas direction.
 * Setting the face azimuth to the roof-edge canvas angle therefore aligns the
 * physical row/field axis, rather than merely rotating an arrow.
 */
export function resolveK2ParallelRoofEdgeAlignment(input: {
  roofPointsPx: readonly MetricPoint[];
  mppImage: number;
}): RoofEdgeAlignment | null {
  if (
    input.roofPointsPx.length < 2 ||
    !(input.mppImage > 0) ||
    !Number.isFinite(input.mppImage)
  ) return null;
  const rectangle = analyzeRectangularRoof(input.roofPointsPx, input.mppImage);
  if (rectangle.supported) {
    return {
      faceAzimuthDeg: normalizeGeographicAzimuth(
        rectangle.dimensions.canvasAngleDeg,
      ),
      source: "rectangle-main-axis",
      edgeIndex: rectangle.dimensions.lengthEdgeIndex,
    };
  }

  let longestIndex = -1;
  let longestLength = 0;
  for (let index = 0; index < input.roofPointsPx.length; index += 1) {
    const start = input.roofPointsPx[index];
    const end = input.roofPointsPx[(index + 1) % input.roofPointsPx.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length > longestLength) {
      longestLength = length;
      longestIndex = index;
    }
  }
  if (!(longestLength > 0) || longestIndex < 0) return null;
  return {
    faceAzimuthDeg: canvasAngleDeg(
      input.roofPointsPx[longestIndex],
      input.roofPointsPx[(longestIndex + 1) % input.roofPointsPx.length],
    ),
    source: "longest-edge",
    edgeIndex: longestIndex,
  };
}
