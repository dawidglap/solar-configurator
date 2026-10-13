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
  collinearDistanceM: 0.15,
  collinearAngleDeg: 5,
  shortEdgeM: 0.45,
  shortEdgeDeviationM: 0.16,
  shortEdgeAngleDeg: 18,
  maxAreaChangeRatio: 0.02,
  maxPasses: 32,
};

export type SonnendachSimplificationOptions = Partial<SonnendachSimplificationConfig>;
export type SonnendachVertexMetric = {
  sourceIndex: number;
  pointM: Pt;
  outgoingEdgeM: number;
  turnAngleDeg: number;
  internalAngleDeg: number;
};
export type SonnendachRemovedVertex = {
  sourceIndex: number;
  pointM: Pt;
  reason: "closing-duplicate" | "near-duplicate" | "near-collinear" | "short-edge-jitter";
  deviationM: number;
  shortestAdjacentEdgeM: number;
  turnAngleDeg: number;
};
export type SonnendachSimplificationReport = {
  points: Pt[];
  before: SonnendachVertexMetric[];
  after: SonnendachVertexMetric[];
  removed: SonnendachRemovedVertex[];
  areaBeforeM2: number;
  areaAfterM2: number;
  areaChangeRatio: number;
  windingPreserved: boolean;
  valid: boolean;
};

type IndexedMetricPoint = Pt & { sourceIndex: number; sourcePoint: Pt };

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
  if (o1 * o2 < -epsilon && o3 * o4 < -epsilon) return true;
  const onSegment = (start: Pt, point: Pt, end: Pt) =>
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon;
  return (
    (Math.abs(o1) <= epsilon && onSegment(a, c, b)) ||
    (Math.abs(o2) <= epsilon && onSegment(a, d, b)) ||
    (Math.abs(o3) <= epsilon && onSegment(c, a, d)) ||
    (Math.abs(o4) <= epsilon && onSegment(c, b, d))
  );
}

export function isSimpleSonnendachPolygon(points: readonly Pt[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return false;
      }
    }
  }
  return true;
}

function metrics(points: readonly IndexedMetricPoint[]): SonnendachVertexMetric[] {
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const turn = turnAngleDeg(previous, point, next);
    return {
      sourceIndex: point.sourceIndex,
      pointM: { x: point.x, y: point.y },
      outgoingEdgeM: distance(point, next),
      turnAngleDeg: turn,
      internalAngleDeg: 180 - turn,
    };
  });
}

function resolvedOptions(overrides: SonnendachSimplificationOptions): SonnendachSimplificationConfig {
  const options: SonnendachSimplificationConfig = { ...SONNENDACH_SIMPLIFICATION };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) options[key as keyof SonnendachSimplificationConfig] = value;
  }
  return options;
}

function unchangedReport(source: readonly Pt[]): SonnendachSimplificationReport {
  return {
    points: source.map((point) => ({ ...point })),
    before: [],
    after: [],
    removed: [],
    areaBeforeM2: 0,
    areaAfterM2: 0,
    areaChangeRatio: 0,
    windingPreserved: true,
    valid: false,
  };
}

/** Simplifies in roof-local metres and returns an auditable removal report. */
export function simplifySonnendachPolygonWithReport(
  source: readonly Pt[],
  metresPerPixel: number,
  overrides: SonnendachSimplificationOptions = {},
): SonnendachSimplificationReport {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0 || source.length < 3) {
    return unchangedReport(source);
  }
  const options = resolvedOptions(overrides);
  const finite = source
    .map((point, sourceIndex) => ({ point, sourceIndex }))
    .filter(({ point }) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length < 3) return unchangedReport(source);
  const origin = finite[0].point;
  const local = finite.map<IndexedMetricPoint>(({ point, sourceIndex }) => ({
    x: (point.x - origin.x) * metresPerPixel,
    y: (point.y - origin.y) * metresPerPixel,
    sourceIndex,
    sourcePoint: { ...point },
  }));
  const removed: SonnendachRemovedVertex[] = [];
  if (local.length > 1 && distance(local[0], local[local.length - 1]) <= options.mergeDistanceM) {
    const closing = local.pop()!;
    removed.push({
      sourceIndex: closing.sourceIndex,
      pointM: { x: closing.x, y: closing.y },
      reason: "closing-duplicate",
      deviationM: distance(local[0], closing),
      shortestAdjacentEdgeM: 0,
      turnAngleDeg: 0,
    });
  }
  const sanitized: IndexedMetricPoint[] = [];
  for (const point of local) {
    const previous = sanitized[sanitized.length - 1];
    if (previous && distance(previous, point) <= options.mergeDistanceM) {
      removed.push({
        sourceIndex: point.sourceIndex,
        pointM: { x: point.x, y: point.y },
        reason: "near-duplicate",
        deviationM: distance(previous, point),
        shortestAdjacentEdgeM: distance(previous, point),
        turnAngleDeg: 0,
      });
    } else {
      sanitized.push(point);
    }
  }
  if (sanitized.length < 3) return unchangedReport(source);
  const original = sanitized;
  const before = metrics(original);
  const originalArea = signedArea(original);
  if (Math.abs(originalArea) <= Number.EPSILON || !isSimpleSonnendachPolygon(original)) {
    return unchangedReport(source);
  }

  let result = [...original];
  const passLimit = Math.max(options.maxPasses, original.length);
  for (let pass = 0; pass < passLimit; pass += 1) {
    let removedInPass = false;
    for (let index = 0; index < result.length && result.length > 3; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      const turn = turnAngleDeg(previous, current, next);
      const deviation = pointToSegmentDistance(current, previous, next);
      const shortestAdjacent = Math.min(distance(previous, current), distance(current, next));
      const nearlyCollinear =
        turn <= options.collinearAngleDeg && deviation <= options.collinearDistanceM;
      const shortNoise =
        shortestAdjacent <= options.shortEdgeM &&
        turn <= options.shortEdgeAngleDeg &&
        deviation <= options.shortEdgeDeviationM;
      if (!nearlyCollinear && !shortNoise) continue;

      const candidate = result.filter((_, candidateIndex) => candidateIndex !== index);
      const candidateArea = signedArea(candidate);
      const areaChange = Math.abs(Math.abs(candidateArea) - Math.abs(originalArea)) / Math.abs(originalArea);
      if (
        Math.sign(candidateArea) !== Math.sign(originalArea) ||
        areaChange > options.maxAreaChangeRatio ||
        !isSimpleSonnendachPolygon(candidate)
      ) continue;
      removed.push({
        sourceIndex: current.sourceIndex,
        pointM: { x: current.x, y: current.y },
        reason: nearlyCollinear ? "near-collinear" : "short-edge-jitter",
        deviationM: deviation,
        shortestAdjacentEdgeM: shortestAdjacent,
        turnAngleDeg: turn,
      });
      result = candidate;
      removedInPass = true;
      break;
    }
    if (!removedInPass) break;
  }

  const areaAfter = signedArea(result);
  return {
    points: result.map((point) => ({ ...point.sourcePoint })),
    before,
    after: metrics(result),
    removed,
    areaBeforeM2: Math.abs(originalArea),
    areaAfterM2: Math.abs(areaAfter),
    areaChangeRatio: Math.abs(Math.abs(areaAfter) - Math.abs(originalArea)) / Math.abs(originalArea),
    windingPreserved: Math.sign(areaAfter) === Math.sign(originalArea),
    valid: isSimpleSonnendachPolygon(result),
  };
}

export function simplifySonnendachPolygon(
  source: readonly Pt[],
  metresPerPixel: number,
  overrides: SonnendachSimplificationOptions = {},
): Pt[] {
  return simplifySonnendachPolygonWithReport(source, metresPerPixel, overrides).points;
}
