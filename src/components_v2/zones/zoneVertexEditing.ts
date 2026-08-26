import {
  isSimpleMetricPolygon,
  pointPolygonRelation,
  polygonArea,
  type MetricPoint,
} from "@/lib/planning-core/geometry-v2";

export type ZoneVertexMoveResult =
  | { accepted: true; points: MetricPoint[]; point: MetricPoint; snapped: boolean }
  | {
      accepted: false;
      points: MetricPoint[];
      reason: "outside-owner-roof" | "duplicate-adjacent-point" | "invalid-polygon";
    };

function nearestPointOnSegment(
  point: MetricPoint,
  start: MetricPoint,
  end: MetricPoint,
): MetricPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return { ...start };
  const parameter = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator),
  );
  return { x: start.x + parameter * dx, y: start.y + parameter * dy };
}

export function snapPointToOwnerRoof(
  point: MetricPoint,
  ownerRoof: readonly MetricPoint[],
  tolerancePx: number,
): { point: MetricPoint; snapped: boolean } {
  let best: { point: MetricPoint; distance: number } | undefined;
  const consider = (candidate: MetricPoint) => {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= tolerancePx && (!best || distance < best.distance)) {
      best = { point: candidate, distance };
    }
  };
  ownerRoof.forEach((vertex) => consider(vertex));
  ownerRoof.forEach((start, index) => {
    consider(nearestPointOnSegment(point, start, ownerRoof[(index + 1) % ownerRoof.length]));
  });
  return best ? { point: { ...best.point }, snapped: true } : { point: { ...point }, snapped: false };
}

export function moveZoneVertex(input: {
  points: readonly MetricPoint[];
  vertexIndex: number;
  requestedPoint: MetricPoint;
  ownerRoof: readonly MetricPoint[];
  snapTolerancePx?: number;
  disableSnap?: boolean;
  minAdjacentDistancePx?: number;
}): ZoneVertexMoveResult {
  const snapped = input.disableSnap
    ? { point: { ...input.requestedPoint }, snapped: false }
    : snapPointToOwnerRoof(
        input.requestedPoint,
        input.ownerRoof,
        Math.max(0, input.snapTolerancePx ?? 0),
      );
  if (pointPolygonRelation(snapped.point, [...input.ownerRoof]) === "outside") {
    return { accepted: false, points: [...input.points], reason: "outside-owner-roof" };
  }
  const next = input.points.map((point, index) =>
    index === input.vertexIndex ? { ...snapped.point } : { ...point },
  );
  const previousIndex = (input.vertexIndex - 1 + next.length) % next.length;
  const nextIndex = (input.vertexIndex + 1) % next.length;
  const minDistance = input.minAdjacentDistancePx ?? 1;
  if (
    Math.hypot(next[previousIndex].x - snapped.point.x, next[previousIndex].y - snapped.point.y) < minDistance ||
    Math.hypot(next[nextIndex].x - snapped.point.x, next[nextIndex].y - snapped.point.y) < minDistance
  ) {
    return { accepted: false, points: [...input.points], reason: "duplicate-adjacent-point" };
  }
  if (!isSimpleMetricPolygon(next) || polygonArea(next) <= minDistance * minDistance) {
    return { accepted: false, points: [...input.points], reason: "invalid-polygon" };
  }
  return { accepted: true, points: next, point: snapped.point, snapped: snapped.snapped };
}
