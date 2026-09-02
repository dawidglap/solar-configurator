import {
  isFootprintContainedInUsableRoof,
  isSimpleMetricPolygon,
  polygonArea,
} from "./polygon";
import {
  getCanonicalRoofEdges,
  resolveRoofReferenceEdgeIndex,
} from "./roofEdges";
import type { MetricPoint } from "./types";

export type RoofKind = "pitched" | "flat" | "green";

export type RoofLocalFrame = {
  edgeIndex: number;
  origin: MetricPoint;
  u: MetricPoint;
  v: MetricPoint;
};

export type RoofOwnedPolygonResult =
  | { valid: true; points: MetricPoint[] }
  | {
      valid: false;
      points: MetricPoint[];
      reason: "missing-reference-edge" | "too-small" | "invalid-polygon" | "outside-owner-roof";
    };

export function resolveRoofLocalFrame(input: {
  roofPoints: readonly MetricPoint[];
  roofKind: RoofKind;
  requestedEdgeIndex?: number;
}): RoofLocalFrame | undefined {
  const edgeIndex = resolveRoofReferenceEdgeIndex({
    points: input.roofPoints,
    requestedIndex: input.requestedEdgeIndex,
    roofKind: input.roofKind,
  });
  if (edgeIndex == null) return undefined;
  const edge = getCanonicalRoofEdges(input.roofPoints)[edgeIndex];
  if (!edge) return undefined;
  return {
    edgeIndex,
    origin: { ...edge.start },
    u: { ...edge.direction },
    v: { x: -edge.direction.y, y: edge.direction.x },
  };
}

function project(point: MetricPoint, frame: RoofLocalFrame): MetricPoint {
  const dx = point.x - frame.origin.x;
  const dy = point.y - frame.origin.y;
  return {
    x: dx * frame.u.x + dy * frame.u.y,
    y: dx * frame.v.x + dy * frame.v.y,
  };
}

function unproject(point: MetricPoint, frame: RoofLocalFrame): MetricPoint {
  return {
    x: frame.origin.x + point.x * frame.u.x + point.y * frame.v.x,
    y: frame.origin.y + point.x * frame.u.y + point.y * frame.v.y,
  };
}

function validateOwnerContainment(
  points: MetricPoint[],
  ownerRoofPoints: readonly MetricPoint[],
): RoofOwnedPolygonResult {
  if (!isSimpleMetricPolygon(points) || polygonArea(points) <= 1e-4) {
    return { valid: false, points, reason: "invalid-polygon" };
  }
  if (!isFootprintContainedInUsableRoof(points, [[...ownerRoofPoints]])) {
    return { valid: false, points, reason: "outside-owner-roof" };
  }
  return { valid: true, points };
}

export function createRoofRelativeRectangle(input: {
  dragStart: MetricPoint;
  dragEnd: MetricPoint;
  ownerRoofPoints: readonly MetricPoint[];
  roofKind: RoofKind;
  referenceEdgeIndex?: number;
  minimumSidePx?: number;
}): RoofOwnedPolygonResult & {
  edgeIndex?: number;
  widthPx?: number;
  heightPx?: number;
} {
  const frame = resolveRoofLocalFrame({
    roofPoints: input.ownerRoofPoints,
    roofKind: input.roofKind,
    requestedEdgeIndex: input.referenceEdgeIndex,
  });
  if (!frame) {
    return { valid: false, points: [], reason: "missing-reference-edge" };
  }
  const start = project(input.dragStart, frame);
  const end = project(input.dragEnd, frame);
  const minU = Math.min(start.x, end.x);
  const maxU = Math.max(start.x, end.x);
  const minV = Math.min(start.y, end.y);
  const maxV = Math.max(start.y, end.y);
  const widthPx = maxU - minU;
  const heightPx = maxV - minV;
  const points = [
    unproject({ x: minU, y: minV }, frame),
    unproject({ x: maxU, y: minV }, frame),
    unproject({ x: maxU, y: maxV }, frame),
    unproject({ x: minU, y: maxV }, frame),
  ];
  if (widthPx < (input.minimumSidePx ?? 1) || heightPx < (input.minimumSidePx ?? 1)) {
    return { valid: false, points, reason: "too-small", edgeIndex: frame.edgeIndex, widthPx, heightPx };
  }
  return {
    ...validateOwnerContainment(points, input.ownerRoofPoints),
    edgeIndex: frame.edgeIndex,
    widthPx,
    heightPx,
  };
}

export function translateRoofOwnedPolygon(input: {
  points: readonly MetricPoint[];
  delta: MetricPoint;
  ownerRoofPoints: readonly MetricPoint[];
}): RoofOwnedPolygonResult {
  const points = input.points.map((point) => ({
    x: point.x + input.delta.x,
    y: point.y + input.delta.y,
  }));
  return validateOwnerContainment(points, input.ownerRoofPoints);
}

function polygonCenter(points: readonly MetricPoint[]): MetricPoint {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function alignPolygonToRoofReference(input: {
  points: readonly MetricPoint[];
  ownerRoofPoints: readonly MetricPoint[];
  roofKind: RoofKind;
  referenceEdgeIndex?: number;
}): RoofOwnedPolygonResult {
  const frame = resolveRoofLocalFrame({
    roofPoints: input.ownerRoofPoints,
    roofKind: input.roofKind,
    requestedEdgeIndex: input.referenceEdgeIndex,
  });
  if (!frame) return { valid: false, points: [...input.points], reason: "missing-reference-edge" };
  let primary = { x: 1, y: 0 };
  let longest = 0;
  input.points.forEach((point, index) => {
    const next = input.points[(index + 1) % input.points.length];
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (length > longest) {
      longest = length;
      primary = { x: (next.x - point.x) / length, y: (next.y - point.y) / length };
    }
  });
  const currentAngle = Math.atan2(primary.y, primary.x);
  const targetAngle = Math.atan2(frame.u.y, frame.u.x);
  let delta = targetAngle - currentAngle;
  while (delta > Math.PI / 2) delta -= Math.PI;
  while (delta < -Math.PI / 2) delta += Math.PI;
  const center = polygonCenter(input.points);
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const points = input.points.map((point) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
  });
  return validateOwnerContainment(points, input.ownerRoofPoints);
}

export function orthogonalizePolygonToRoofReference(input: {
  points: readonly MetricPoint[];
  ownerRoofPoints: readonly MetricPoint[];
  roofKind: RoofKind;
  referenceEdgeIndex?: number;
}): RoofOwnedPolygonResult {
  const frame = resolveRoofLocalFrame({
    roofPoints: input.ownerRoofPoints,
    roofKind: input.roofKind,
    requestedEdgeIndex: input.referenceEdgeIndex,
  });
  if (!frame) return { valid: false, points: [...input.points], reason: "missing-reference-edge" };
  const local = input.points.map((point) => project(point, frame));
  const minU = Math.min(...local.map((point) => point.x));
  const maxU = Math.max(...local.map((point) => point.x));
  const minV = Math.min(...local.map((point) => point.y));
  const maxV = Math.max(...local.map((point) => point.y));
  const points = [
    unproject({ x: minU, y: minV }, frame),
    unproject({ x: maxU, y: minV }, frame),
    unproject({ x: maxU, y: maxV }, frame),
    unproject({ x: minU, y: maxV }, frame),
  ];
  return validateOwnerContainment(points, input.ownerRoofPoints);
}
