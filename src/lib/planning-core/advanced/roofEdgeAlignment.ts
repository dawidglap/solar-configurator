import { analyzeRectangularRoof, getCanonicalRoofEdges } from "../geometry-v2";
import type { MetricPoint } from "../geometry-v2";
import { normalizeGeographicAzimuth } from "./moduleGeometry";

export type RoofEdgeAlignment = {
  /** K2 block-local X axis follows this canvas edge direction. */
  faceAzimuthDeg: number;
  source: "explicit-reference-edge" | "rectangle-main-axis" | "longest-edge";
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
  referenceEdgeIndex?: number;
}): RoofEdgeAlignment | null {
  if (
    input.roofPointsPx.length < 2 ||
    !(input.mppImage > 0) ||
    !Number.isFinite(input.mppImage)
  ) return null;
  const canonicalEdges = getCanonicalRoofEdges(input.roofPointsPx);
  if (
    Number.isInteger(input.referenceEdgeIndex) &&
    (input.referenceEdgeIndex as number) >= 0 &&
    (input.referenceEdgeIndex as number) < canonicalEdges.length
  ) {
    const edge = canonicalEdges[input.referenceEdgeIndex as number];
    return {
      faceAzimuthDeg: canvasAngleDeg(edge.start, edge.end),
      source: "explicit-reference-edge",
      edgeIndex: edge.edgeIndex,
    };
  }
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
  for (const edge of canonicalEdges) {
    if (edge.lengthPx > longestLength) {
      longestLength = edge.lengthPx;
      longestIndex = edge.edgeIndex;
    }
  }
  if (!(longestLength > 0) || longestIndex < 0) return null;
  return {
    faceAzimuthDeg: canvasAngleDeg(
      canonicalEdges[longestIndex].start,
      canonicalEdges[longestIndex].end,
    ),
    source: "longest-edge",
    edgeIndex: longestIndex,
  };
}
