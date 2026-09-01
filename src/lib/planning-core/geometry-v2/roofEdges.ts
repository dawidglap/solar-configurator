import type { MetricPoint } from "./types";

const DEFAULT_POINT_EPSILON = 1e-6;

export type CanonicalRoofVertex = MetricPoint & {
  originalPointIndex: number;
};

export type CanonicalRoofEdge = {
  edgeIndex: number;
  startPointIndex: number;
  endPointIndex: number;
  start: MetricPoint;
  end: MetricPoint;
  midpoint: MetricPoint;
  direction: MetricPoint;
  lengthPx: number;
  canvasAngleDeg: number;
  /** Directed geographic azimuth in image coordinates (Y points down). */
  geographicAzimuthDeg: number;
};

function samePoint(a: MetricPoint, b: MetricPoint, epsilon: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsilon;
}

export function getCanonicalRoofVertices(
  points: readonly MetricPoint[],
  epsilon = DEFAULT_POINT_EPSILON,
): CanonicalRoofVertex[] {
  const vertices: CanonicalRoofVertex[] = [];
  points.forEach((point, originalPointIndex) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const previous = vertices[vertices.length - 1];
    if (previous && samePoint(previous, point, epsilon)) return;
    vertices.push({ ...point, originalPointIndex });
  });
  if (
    vertices.length > 1 &&
    samePoint(vertices[0], vertices[vertices.length - 1], epsilon)
  ) {
    vertices.pop();
  }
  return vertices;
}

function normalize360(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Enumerates only physical polygon edges. Explicit closing points and
 * duplicate-adjacent points never become customer-facing zero-length edges.
 */
export function getCanonicalRoofEdges(
  points: readonly MetricPoint[],
  epsilon = DEFAULT_POINT_EPSILON,
): CanonicalRoofEdge[] {
  const vertices = getCanonicalRoofVertices(points, epsilon);
  if (vertices.length < 3) return [];
  return vertices.flatMap((start, edgeIndex) => {
    const end = vertices[(edgeIndex + 1) % vertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthPx = Math.hypot(dx, dy);
    if (!(lengthPx > epsilon)) return [];
    return [{
      edgeIndex,
      startPointIndex: start.originalPointIndex,
      endPointIndex: end.originalPointIndex,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      direction: { x: dx / lengthPx, y: dy / lengthPx },
      lengthPx,
      canvasAngleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      geographicAzimuthDeg: normalize360((Math.atan2(dx, -dy) * 180) / Math.PI),
    }];
  });
}

export function resolveRoofReferenceEdgeIndex(input: {
  points: readonly MetricPoint[];
  requestedIndex?: number;
  roofKind: "pitched" | "flat" | "green";
}): number | undefined {
  const edges = getCanonicalRoofEdges(input.points);
  if (!edges.length) return undefined;
  if (
    Number.isInteger(input.requestedIndex) &&
    (input.requestedIndex as number) >= 0 &&
    (input.requestedIndex as number) < edges.length
  ) {
    return input.requestedIndex;
  }
  if (input.roofKind === "pitched") return 0;
  return edges.reduce((best, edge) =>
    edge.lengthPx > best.lengthPx ? edge : best,
  ).edgeIndex;
}

export type PitchedRoofEdgeRole =
  | "first"
  | "eaves"
  | "gable-left"
  | "gable-right"
  | "edge";

export function getPitchedRoofEdgeRoles(input: {
  points: readonly MetricPoint[];
  referenceEdgeIndex?: number;
}): Map<number, PitchedRoofEdgeRole> {
  const edges = getCanonicalRoofEdges(input.points);
  const roles = new Map<number, PitchedRoofEdgeRole>();
  edges.forEach((edge) => roles.set(edge.edgeIndex, "edge"));
  if (!edges.length) return roles;
  const firstIndex = resolveRoofReferenceEdgeIndex({
    points: input.points,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: "pitched",
  }) as number;
  roles.set(firstIndex, "first");
  if (edges.length !== 4) return roles;

  roles.set((firstIndex + 2) % 4, "eaves");
  const first = edges[firstIndex];
  const startIsLeft =
    first.start.x < first.end.x ||
    (Math.abs(first.start.x - first.end.x) <= DEFAULT_POINT_EPSILON &&
      first.start.y < first.end.y);
  roles.set((firstIndex + 3) % 4, startIsLeft ? "gable-left" : "gable-right");
  roles.set((firstIndex + 1) % 4, startIsLeft ? "gable-right" : "gable-left");
  return roles;
}

export function getCanonicalLeftEndOfEdge(edge: CanonicalRoofEdge): MetricPoint {
  if (edge.start.x < edge.end.x) return edge.start;
  if (edge.start.x > edge.end.x) return edge.end;
  return edge.start.y <= edge.end.y ? edge.start : edge.end;
}
