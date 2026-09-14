import { resolveCanonicalRoofReferenceEdge } from "@/lib/planning-core/geometry-v2";
import type { Pt } from "@/types/planner";

export type RoofReferenceEdgePresentation = {
  edge: NonNullable<ReturnType<typeof resolveCanonicalRoofReferenceEdge>>;
  label: "FIRST" | "REFERENZKANTE";
  center: Pt;
  screenRotationDeg: number;
  widthPx: number;
  heightPx: number;
  fontSizePx: number;
};

function isPointInsidePolygon(point: Pt, polygon: readonly Pt[]) {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y || 1e-9) +
          current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Pure screen-space presentation model for the selected roof's semantic edge.
 * The inward offset keeps the pill away from exterior dimension lines and the
 * NORMAL/TRAPEZ roof-mode control without changing canonical roof geometry.
 */
export function buildRoofReferenceEdgePresentation(input: {
  points: readonly Pt[];
  roofKind: "pitched" | "flat" | "green";
  referenceEdgeIndex?: number;
  scale: number;
  canvasRotationDeg: number;
}): RoofReferenceEdgePresentation | null {
  if (input.roofKind === "green") return null;
  const edge = resolveCanonicalRoofReferenceEdge({
    points: input.points,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: input.roofKind,
  });
  if (!edge) return null;

  const inverseScale = 1 / Math.max(input.scale, 0.01);
  const leftNormal = { x: -edge.direction.y, y: edge.direction.x };
  const leftSample = {
    x: edge.midpoint.x + leftNormal.x * 0.75,
    y: edge.midpoint.y + leftNormal.y * 0.75,
  };
  const inward = isPointInsidePolygon(leftSample, input.points)
    ? leftNormal
    : { x: -leftNormal.x, y: -leftNormal.y };
  const label = input.roofKind === "pitched" ? "FIRST" : "REFERENZKANTE";
  const inwardOffsetPx = 27;

  return {
    edge,
    label,
    center: {
      x: edge.midpoint.x + inward.x * inwardOffsetPx * inverseScale,
      y: edge.midpoint.y + inward.y * inwardOffsetPx * inverseScale,
    },
    screenRotationDeg: -input.canvasRotationDeg,
    widthPx: Math.max(66, label.length * 7.5 + 24),
    heightPx: 26,
    fontSizePx: 11.5,
  };
}
