import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";

import {
  GEOMETRY_AREA_EPSILON_M2,
  GEOMETRY_EPSILON_M,
  type MetricPoint,
  type MetricPolygon,
} from "./types";

// polygon-clipping is CommonJS at runtime; the default namespace keeps the
// same geometry implementation available in both tsx tests and Next/Webpack.
const { difference } = polygonClipping;

export type MetricBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function squaredDistance(a: MetricPoint, b: MetricPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function normalizeMetricPolygon(polygon: MetricPolygon): MetricPolygon {
  const normalized: MetricPolygon = [];
  for (const point of polygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    const previous = normalized.at(-1);
    if (!previous || squaredDistance(previous, point) > GEOMETRY_EPSILON_M ** 2) {
      normalized.push({ x: point.x, y: point.y });
    }
  }
  if (
    normalized.length > 1 &&
    squaredDistance(normalized[0], normalized.at(-1)!) <= GEOMETRY_EPSILON_M ** 2
  ) {
    normalized.pop();
  }
  return normalized;
}

export function signedPolygonArea(polygon: MetricPolygon): number {
  let doubledArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}

export function polygonArea(polygon: MetricPolygon): number {
  return Math.abs(signedPolygonArea(polygon));
}

export function polygonBounds(polygon: MetricPolygon): MetricBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function combinePolygonBounds(polygons: MetricPolygon[]): MetricBounds {
  const bounds = polygons.map(polygonBounds);
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

function cross(a: MetricPoint, b: MetricPoint, c: MetricPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function isPointOnSegment(
  point: MetricPoint,
  start: MetricPoint,
  end: MetricPoint,
): boolean {
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
  const crossTolerance = GEOMETRY_EPSILON_M * Math.max(1, segmentLength);
  if (Math.abs(cross(start, end, point)) > crossTolerance) return false;
  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON_M &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON_M &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON_M &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON_M
  );
}

export type PointPolygonRelation = "inside" | "boundary" | "outside";

export function pointPolygonRelation(
  point: MetricPoint,
  polygon: MetricPolygon,
): PointPolygonRelation {
  if (polygon.length < 3) return "outside";
  for (let index = 0; index < polygon.length; index += 1) {
    if (isPointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) {
      return "boundary";
    }
  }

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint.y > point.y !== previousPoint.y > point.y) {
      const intersectionX =
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
        currentPoint.x;
      if (intersectionX > point.x) inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

export function segmentsIntersectOrTouch(
  a1: MetricPoint,
  a2: MetricPoint,
  b1: MetricPoint,
  b2: MetricPoint,
): boolean {
  const c1 = cross(a1, a2, b1);
  const c2 = cross(a1, a2, b2);
  const c3 = cross(b1, b2, a1);
  const c4 = cross(b1, b2, a2);
  const tolerance = GEOMETRY_EPSILON_M * Math.max(
    1,
    Math.hypot(a2.x - a1.x, a2.y - a1.y),
    Math.hypot(b2.x - b1.x, b2.y - b1.y),
  );

  if (Math.abs(c1) <= tolerance && isPointOnSegment(b1, a1, a2)) return true;
  if (Math.abs(c2) <= tolerance && isPointOnSegment(b2, a1, a2)) return true;
  if (Math.abs(c3) <= tolerance && isPointOnSegment(a1, b1, b2)) return true;
  if (Math.abs(c4) <= tolerance && isPointOnSegment(a2, b1, b2)) return true;

  return (
    ((c1 > tolerance && c2 < -tolerance) ||
      (c1 < -tolerance && c2 > tolerance)) &&
    ((c3 > tolerance && c4 < -tolerance) ||
      (c3 < -tolerance && c4 > tolerance))
  );
}

export function isSimpleMetricPolygon(polygon: MetricPolygon): boolean {
  if (polygon.length < 3 || polygonArea(polygon) <= GEOMETRY_AREA_EPSILON_M2) {
    return false;
  }
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      const adjacent =
        first === second ||
        firstNext === second ||
        secondNext === first;
      if (adjacent) continue;
      if (
        segmentsIntersectOrTouch(
          polygon[first],
          polygon[firstNext],
          polygon[second],
          polygon[secondNext],
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function toClosedRing(polygon: MetricPolygon): Pair[] {
  const ring: Pair[] = polygon.map((point) => [point.x, point.y]);
  ring.push([polygon[0].x, polygon[0].y]);
  return ring;
}

function ringArea(ring: Pair[]): number {
  let doubledArea = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    doubledArea += ring[index][0] * ring[index + 1][1];
    doubledArea -= ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(doubledArea / 2);
}

function multiPolygonArea(multiPolygon: MultiPolygon): number {
  return multiPolygon.reduce((total, polygon) => {
    if (!polygon.length) return total;
    const outerArea = ringArea(polygon[0]);
    const holeArea = polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
    return total + Math.max(0, outerArea - holeArea);
  }, 0);
}

export function isFootprintContainedInUsableRoof(
  footprint: MetricPolygon,
  usableComponents: MetricPolygon[],
): boolean {
  if (!isSimpleMetricPolygon(footprint) || !usableComponents.length) return false;
  const subject: Polygon = [toClosedRing(footprint)];
  const roof: MultiPolygon = usableComponents.map((component) => [toClosedRing(component)]);
  try {
    const outside = difference(subject, roof);
    return multiPolygonArea(outside) <= GEOMETRY_AREA_EPSILON_M2;
  } catch {
    return false;
  }
}

export function polygonsIntersectOrTouch(
  first: MetricPolygon,
  second: MetricPolygon,
): boolean {
  if (first.length < 3 || second.length < 3) return false;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length;
      if (
        segmentsIntersectOrTouch(
          first[firstIndex],
          first[firstNext],
          second[secondIndex],
          second[secondNext],
        )
      ) {
        return true;
      }
    }
  }
  return (
    pointPolygonRelation(first[0], second) !== "outside" ||
    pointPolygonRelation(second[0], first) !== "outside"
  );
}

export function pointToSegmentDistance(
  point: MetricPoint,
  start: MetricPoint,
  end: MetricPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON_M ** 2) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

export function segmentToSegmentDistance(
  a1: MetricPoint,
  a2: MetricPoint,
  b1: MetricPoint,
  b2: MetricPoint,
): number {
  if (segmentsIntersectOrTouch(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegmentDistance(a1, b1, b2),
    pointToSegmentDistance(a2, b1, b2),
    pointToSegmentDistance(b1, a1, a2),
    pointToSegmentDistance(b2, a1, a2),
  );
}

export function segmentToPolygonDistance(
  start: MetricPoint,
  end: MetricPoint,
  polygon: MetricPolygon,
): number {
  if (
    pointPolygonRelation(start, polygon) !== "outside" ||
    pointPolygonRelation(end, polygon) !== "outside"
  ) {
    return 0;
  }
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    minimum = Math.min(
      minimum,
      segmentToSegmentDistance(
        start,
        end,
        polygon[index],
        polygon[(index + 1) % polygon.length],
      ),
    );
  }
  return minimum;
}
