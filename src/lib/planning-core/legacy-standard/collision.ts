import type { LegacyPoint, LegacyStandardCandidate } from "./types";

function deg2rad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function rectToPolygon(rect: LegacyStandardCandidate): LegacyPoint[] {
  const halfWidth = rect.wPx / 2;
  const halfHeight = rect.hPx / 2;
  const theta = deg2rad(rect.angleDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const local: LegacyPoint[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];

  return local.map((point) => ({
    x: rect.cx + point.x * cos - point.y * sin,
    y: rect.cy + point.x * sin + point.y * cos,
  }));
}

export function legacyPointInPolygon(point: LegacyPoint, polygon: LegacyPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const xi = polygon[index].x;
    const yi = polygon[index].y;
    const xj = polygon[previous].x;
    const yj = polygon[previous].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;

    if (intersects) inside = !inside;
  }
  return inside;
}

function onSegment(a: LegacyPoint, b: LegacyPoint, point: LegacyPoint): boolean {
  return (
    Math.min(a.x, b.x) - 1e-6 <= point.x &&
    point.x <= Math.max(a.x, b.x) + 1e-6 &&
    Math.min(a.y, b.y) - 1e-6 <= point.y &&
    point.y <= Math.max(a.y, b.y) + 1e-6
  );
}

function segmentsIntersect(
  a1: LegacyPoint,
  a2: LegacyPoint,
  b1: LegacyPoint,
  b2: LegacyPoint,
): boolean {
  const cross = (p: LegacyPoint, q: LegacyPoint, r: LegacyPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  const c1 = cross(a1, a2, b1);
  const c2 = cross(a1, a2, b2);
  const c3 = cross(b1, b2, a1);
  const c4 = cross(b1, b2, a2);

  if (
    (c1 === 0 && onSegment(a1, a2, b1)) ||
    (c2 === 0 && onSegment(a1, a2, b2)) ||
    (c3 === 0 && onSegment(b1, b2, a1)) ||
    (c4 === 0 && onSegment(b1, b2, a2))
  ) {
    return true;
  }

  return c1 * c2 < 0 && c3 * c4 < 0;
}

function polygonsIntersect(a: LegacyPoint[], b: LegacyPoint[]): boolean {
  if (a.some((point) => legacyPointInPolygon(point, b))) return true;
  if (b.some((point) => legacyPointInPolygon(point, a))) return true;

  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    const a1 = a[aIndex];
    const a2 = a[(aIndex + 1) % a.length];
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      const b1 = b[bIndex];
      const b2 = b[(bIndex + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

export function legacyRectIntersectsPolygon(
  rect: LegacyStandardCandidate,
  polygon: LegacyPoint[],
): boolean {
  if (polygon.length < 3) return false;
  return polygonsIntersect(rectToPolygon(rect), polygon);
}

export function legacyRectIntersectsSegment(
  rect: LegacyStandardCandidate,
  p1: LegacyPoint,
  p2: LegacyPoint,
): boolean {
  const rectPolygon = rectToPolygon(rect);

  if (legacyPointInPolygon(p1, rectPolygon) || legacyPointInPolygon(p2, rectPolygon)) {
    return true;
  }

  for (let index = 0; index < rectPolygon.length; index += 1) {
    const a = rectPolygon[index];
    const b = rectPolygon[(index + 1) % rectPolygon.length];
    if (segmentsIntersect(a, b, p1, p2)) return true;
  }

  return false;
}
