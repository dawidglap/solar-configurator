import {
  getCanonicalRoofEdges,
  getPitchedRoofEdgeRoles,
  resolveRoofReferenceEdgeIndex,
  roofSegmentLengthM,
  type PitchedRoofEdgeRole,
} from "@/lib/planning-core/geometry-v2";
import type { Pt } from "@/types/planner";

export type RoofAnnotationKind = "pitched" | "flat" | "green";

export type RoofEdgeAnnotation = {
  edgeIndex: number;
  role: PitchedRoofEdgeRole;
  start: Pt;
  end: Pt;
  midpoint: Pt;
  outward: Pt;
  readableAngleDeg: number;
  lengthM: number;
  label: string;
  isReference: boolean;
};

export type RoofAnnotationModel = {
  center: Pt;
  edges: RoofEdgeAnnotation[];
  referenceEdgeIndex?: number;
};

const ROLE_LABELS: Partial<Record<PitchedRoofEdgeRole, string>> = {
  first: "FIRST",
  eaves: "TRAUFE",
  "gable-left": "ORTGANG LINKS",
  "gable-right": "ORTGANG RECHTS",
};

function pointInPolygon(point: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x
    ) inside = !inside;
  }
  return inside;
}

export function normalizeReadableAnnotationAngle(angleDeg: number): number {
  let angle = ((angleDeg % 360) + 360) % 360;
  if (angle > 180) angle -= 360;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

export function buildRoofAnnotationModel(input: {
  points: readonly Pt[];
  mppImage: number;
  roofKind: RoofAnnotationKind;
  tiltDeg?: number;
  fallAzimuthDeg?: number;
  referenceEdgeIndex?: number;
  referenceLabel?: "BEZUGSKANTE";
}): RoofAnnotationModel {
  const points = input.points.map((point) => ({ x: point.x, y: point.y }));
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / Math.max(1, points.length), y: sum.y + point.y / Math.max(1, points.length) }),
    { x: 0, y: 0 },
  );
  const referenceEdgeIndex = resolveRoofReferenceEdgeIndex({
    points,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: input.roofKind,
  });
  const roles = input.roofKind === "pitched"
    ? getPitchedRoofEdgeRoles({ points, referenceEdgeIndex })
    : new Map<number, PitchedRoofEdgeRole>();
  const edges = getCanonicalRoofEdges(points).map((edge) => {
    const role = roles.get(edge.edgeIndex) ?? "edge";
    const leftNormal = { x: -edge.direction.y, y: edge.direction.x };
    const probe = {
      x: edge.midpoint.x + leftNormal.x * 0.75,
      y: edge.midpoint.y + leftNormal.y * 0.75,
    };
    const outward = pointInPolygon(probe, points)
      ? { x: -leftNormal.x, y: -leftNormal.y }
      : leftNormal;
    const lengthM = roofSegmentLengthM(
      { x: edge.end.x - edge.start.x, y: edge.end.y - edge.start.y },
      input.mppImage,
      input.roofKind === "pitched"
        ? { tiltDeg: input.tiltDeg, fallAzimuthDeg: input.fallAzimuthDeg }
        : undefined,
    );
    const isReference = edge.edgeIndex === referenceEdgeIndex;
    const semanticLabel = input.referenceLabel && isReference
      ? input.referenceLabel
      : input.roofKind === "flat" && isReference
        ? "REFERENZKANTE"
        : ROLE_LABELS[role] ?? `KANTE ${edge.edgeIndex + 1}`;
    return {
      edgeIndex: edge.edgeIndex,
      role,
      start: edge.start,
      end: edge.end,
      midpoint: edge.midpoint,
      outward,
      readableAngleDeg: normalizeReadableAnnotationAngle(
        Math.atan2(edge.direction.y, edge.direction.x) * 180 / Math.PI,
      ),
      lengthM,
      label: `${semanticLabel} · ${lengthM.toFixed(2)} m`,
      isReference,
    };
  });
  return { center, edges, referenceEdgeIndex };
}
