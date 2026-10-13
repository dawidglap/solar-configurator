import type { Triangle } from "./types";

type Point2 = Readonly<{ x: number; z: number }>;
const EPSILON = 1e-10;

function signedArea(points: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const point = points[index];
    area += point.x * next.z - next.x * point.z;
  }
  return area / 2;
}

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function isInsideTriangle(point: Point2, a: Point2, b: Point2, c: Point2): boolean {
  const c1 = cross(a, b, point);
  const c2 = cross(b, c, point);
  const c3 = cross(c, a, point);
  const hasNegative = c1 < -EPSILON || c2 < -EPSILON || c3 < -EPSILON;
  const hasPositive = c1 > EPSILON || c2 > EPSILON || c3 > EPSILON;
  return !(hasNegative && hasPositive);
}

/** Dependency-free ear clipping for simple concave roof polygons without holes. */
export function triangulatePolygon(points: readonly Point2[]): readonly Triangle[] {
  if (points.length < 3) return [];
  const indices = points.map((_, index) => index);
  if (signedArea(points) < 0) indices.reverse();
  const triangles: Triangle[] = [];
  let guard = points.length * points.length;

  while (indices.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const previous = indices[(cursor - 1 + indices.length) % indices.length];
      const current = indices[cursor];
      const next = indices[(cursor + 1) % indices.length];
      if (cross(points[previous], points[current], points[next]) <= EPSILON) continue;
      const containsPoint = indices.some((candidate) =>
        candidate !== previous && candidate !== current && candidate !== next &&
        isInsideTriangle(points[candidate], points[previous], points[current], points[next]),
      );
      if (containsPoint) continue;
      triangles.push([previous, current, next]);
      indices.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}
