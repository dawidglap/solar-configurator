import {
  GEOMETRY_EPSILON_M,
  type MetricPolygon,
  type PlacementValidationResult,
  type PolygonObstacle,
  type SegmentObstacle,
  type UsableRoofGeometry,
} from "./types";
import {
  isFootprintContainedInUsableRoof,
  polygonsIntersectOrTouch,
  segmentToPolygonDistance,
} from "./polygon";

export function footprintCollidesWithReservedZones(
  footprint: MetricPolygon,
  reservedZones: PolygonObstacle[],
): boolean {
  return reservedZones.some((zone) =>
    polygonsIntersectOrTouch(footprint, zone.polygon),
  );
}

export function footprintCollidesWithSegmentObstacles(
  footprint: MetricPolygon,
  obstacles: SegmentObstacle[],
): boolean {
  return obstacles.some((obstacle) => {
    const clearance = Number.isFinite(obstacle.clearanceM)
      ? Math.max(0, obstacle.clearanceM)
      : 0;
    return (
      segmentToPolygonDistance(obstacle.start, obstacle.end, footprint) <=
      clearance + GEOMETRY_EPSILON_M
    );
  });
}

export function validatePlacementFootprint(input: {
  footprint: MetricPolygon;
  usableRoof: UsableRoofGeometry;
  reservedZones?: PolygonObstacle[];
  snowGuards?: SegmentObstacle[];
}): PlacementValidationResult {
  const reasons: PlacementValidationResult["reasons"] = [];

  if (
    input.usableRoof.status !== "valid" ||
    !isFootprintContainedInUsableRoof(
      input.footprint,
      input.usableRoof.components,
    )
  ) {
    reasons.push("outside-usable-roof");
  }
  if (
    footprintCollidesWithReservedZones(
      input.footprint,
      input.reservedZones ?? [],
    )
  ) {
    reasons.push("reserved-zone");
  }
  if (
    footprintCollidesWithSegmentObstacles(
      input.footprint,
      input.snowGuards ?? [],
    )
  ) {
    reasons.push("snow-guard");
  }

  return { valid: reasons.length === 0, reasons };
}
