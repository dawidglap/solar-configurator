import {
  analyzeRectangularRoof,
  getCanonicalRoofEdges,
  pointPolygonRelation,
} from "../geometry-v2";
import type { CanonicalRoofEdge, MetricPoint } from "../geometry-v2";
import { normalizeGeographicAzimuth } from "./moduleGeometry";

export type RoofEdgeAlignment = {
  /** K2 block-local X axis follows this canvas edge direction. */
  faceAzimuthDeg: number;
  source: "explicit-reference-edge" | "rectangle-main-axis" | "longest-edge";
  edgeIndex: number;
};

function geographicAzimuthFromImageVector(vector: MetricPoint): number {
  const normalized = normalizeGeographicAzimuth(
    (Math.atan2(vector.x, -vector.y) * 180) / Math.PI,
  );
  return Object.is(normalized, -0) ? 0 : normalized;
}

export type RoofEdgeInwardNormal = {
  vector: MetricPoint;
  geographicAzimuthDeg: number;
};

/**
 * Resolves the perpendicular which points from an edge into the polygon.
 * The probe is local to the edge and independent from viewport transforms.
 */
export function resolveRoofEdgeInwardNormal(input: {
  roofPoints: readonly MetricPoint[];
  edge: CanonicalRoofEdge;
}): RoofEdgeInwardNormal | null {
  const left = { x: -input.edge.direction.y, y: input.edge.direction.x };
  const candidates = [left, { x: -left.x, y: -left.y }];
  const probeDistances = [
    Math.min(0.75, input.edge.lengthPx * 0.01),
    Math.min(2, input.edge.lengthPx * 0.05),
  ].filter((distance) => distance > 1e-6);

  for (const distance of probeDistances) {
    for (const vector of candidates) {
      const relation = pointPolygonRelation({
        x: input.edge.midpoint.x + vector.x * distance,
        y: input.edge.midpoint.y + vector.y * distance,
      }, [...input.roofPoints]);
      if (relation === "inside") {
        return {
          vector,
          geographicAzimuthDeg: geographicAzimuthFromImageVector(vector),
        };
      }
    }
  }

  // Degenerate/very narrow polygons can leave both tiny probes on a boundary.
  // The centroid fallback keeps the choice deterministic without using screen
  // position or polygon winding.
  const centroid = input.roofPoints.reduce(
    (sum, point) => ({
      x: sum.x + point.x / Math.max(1, input.roofPoints.length),
      y: sum.y + point.y / Math.max(1, input.roofPoints.length),
    }),
    { x: 0, y: 0 },
  );
  const towardCentroid = {
    x: centroid.x - input.edge.midpoint.x,
    y: centroid.y - input.edge.midpoint.y,
  };
  const vector = towardCentroid.x * left.x + towardCentroid.y * left.y >= 0
    ? left
    : { x: -left.x, y: -left.y };
  return {
    vector,
    geographicAzimuthDeg: geographicAzimuthFromImageVector(vector),
  };
}

function alignmentForEdge(input: {
  roofPoints: readonly MetricPoint[];
  edge: CanonicalRoofEdge;
  source: RoofEdgeAlignment["source"];
}): RoofEdgeAlignment | null {
  const inward = resolveRoofEdgeInwardNormal({
    roofPoints: input.roofPoints,
    edge: input.edge,
  });
  return inward ? {
    faceAzimuthDeg: inward.geographicAzimuthDeg,
    source: input.source,
    edgeIndex: input.edge.edgeIndex,
  } : null;
}

/**
 * K2 Dome definitions use face azimuth as the module-local forward direction.
 * Its planar block axis remains parallel to the selected edge, while choosing
 * the inward normal removes the otherwise ambiguous 180 degree orientation.
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
    return alignmentForEdge({
      roofPoints: input.roofPointsPx,
      edge,
      source: "explicit-reference-edge",
    });
  }
  const rectangle = analyzeRectangularRoof(input.roofPointsPx, input.mppImage);
  if (rectangle.supported) {
    const edge = canonicalEdges[rectangle.dimensions.lengthEdgeIndex];
    return edge ? alignmentForEdge({
      roofPoints: input.roofPointsPx,
      edge,
      source: "rectangle-main-axis",
    }) : null;
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
  return alignmentForEdge({
    roofPoints: input.roofPointsPx,
    edge: canonicalEdges[longestIndex],
    source: "longest-edge",
  });
}
