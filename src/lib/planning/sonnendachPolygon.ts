import type { Pt } from "@/types/planner";

export type SonnendachSimplificationConfig = {
  mergeDistanceM: number;
  collinearDistanceM: number;
  collinearAngleDeg: number;
  shortEdgeM: number;
  shortEdgeDeviationM: number;
  shortEdgeAngleDeg: number;
  maxAreaChangeRatio: number;
  maxPasses: number;
};

export const SONNENDACH_SIMPLIFICATION: Readonly<SonnendachSimplificationConfig> = {
  mergeDistanceM: 0.25,
  collinearDistanceM: 0.12,
  collinearAngleDeg: 5,
  shortEdgeM: 0.45,
  shortEdgeDeviationM: 0.16,
  shortEdgeAngleDeg: 18,
  maxAreaChangeRatio: 0.02,
  maxPasses: 8,
} as const;

export type SonnendachSimplificationOptions = Partial<SonnendachSimplificationConfig>;

function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function signedArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function pointToSegmentDistance(point: Pt, start: Pt, end: Pt): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return distance(point, start);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return distance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function turnAngleDeg(previous: Pt, current: Pt, next: Pt): number {
  const incoming = { x: current.x - previous.x, y: current.y - previous.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
  if (denominator <= Number.EPSILON) return 0;
  const cosine = Math.max(
    -1,
    Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function orientation(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const epsilon = 1e-9;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < -epsilon && o3 * o4 < -epsilon;
}

function isSimplePolygon(points: readonly Pt[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first
      ) continue;
      if (segmentsIntersect(
        points[first],
        points[firstNext],
        points[second],
        points[secondNext],
      )) return false;
    }
  }
  return true;
}

function sanitizeRing(points: readonly Pt[], mergeDistancePx: number): Pt[] {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length > 1 && distance(finite[0], finite[finite.length - 1]) <= mergeDistancePx) {
    finite.pop();
  }
  const result: Pt[] = [];
  for (const point of finite) {
    if (!result.length || distance(result[result.length - 1], point) > mergeDistancePx) {
      result.push({ x: point.x, y: point.y });
    }
  }
  if (result.length > 2 && distance(result[0], result[result.length - 1]) <= mergeDistancePx) {
    result.pop();
  }
  return result;
}

/**
 * Removes survey/API noise from a closed Sonnendach ring while preserving its
 * winding, area and topology. All public tolerances are expressed in metres.
 */
export function simplifySonnendachPolygon(
  source: readonly Pt[],
  metresPerPixel: number,
  overrides: SonnendachSimplificationOptions = {},
): Pt[] {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0 || source.length < 3) {
    return source.map((point) => ({ ...point }));
  }

  const options: SonnendachSimplificationConfig = { ...SONNENDACH_SIMPLIFICATION };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      options[key as keyof typeof SONNENDACH_SIMPLIFICATION] = value;
    }
  }
  const toPixels = (metres: number) => metres / metresPerPixel;
  const original = sanitizeRing(source, toPixels(options.mergeDistanceM));
  if (original.length < 3) return source.map((point) => ({ ...point }));

  const originalArea = signedArea(original);
  if (Math.abs(originalArea) <= Number.EPSILON || !isSimplePolygon(original)) return original;

  let result = original;
  for (let pass = 0; pass < options.maxPasses; pass += 1) {
    let removed = false;
    for (let index = 0; index < result.length && result.length > 3; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      const angle = turnAngleDeg(previous, current, next);
      const deviation = pointToSegmentDistance(current, previous, next);
      const shortestAdjacent = Math.min(distance(previous, current), distance(current, next));
      const nearlyCollinear =
        angle <= options.collinearAngleDeg &&
        deviation <= toPixels(options.collinearDistanceM);
      const shortNoise =
        shortestAdjacent <= toPixels(options.shortEdgeM) &&
        angle <= options.shortEdgeAngleDeg &&
        deviation <= toPixels(options.shortEdgeDeviationM);
      if (!nearlyCollinear && !shortNoise) continue;

      const candidate = result.filter((_, candidateIndex) => candidateIndex !== index);
      const candidateArea = signedArea(candidate);
      const areaChange = Math.abs(Math.abs(candidateArea) - Math.abs(originalArea)) / Math.abs(originalArea);
      if (
        Math.sign(candidateArea) !== Math.sign(originalArea) ||
        areaChange > options.maxAreaChangeRatio ||
        !isSimplePolygon(candidate)
      ) continue;

      result = candidate;
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return result;
}
