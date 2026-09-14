import { resolveCanonicalRoofReferenceEdge } from "@/lib/planning-core/geometry-v2";
import type { Pt } from "@/types/planner";

export type FillAreaReferenceFrame = {
  tangent: Pt;
  normal: Pt;
  edgeIndex: number;
};

/**
 * Resolves the physical First/Referenzkante frame directly from the canonical
 * roof edge. There is deliberately no viewport or module-layout angle input.
 */
export function resolveFillAreaReferenceFrame(input: {
  roofPoints: readonly Pt[];
  referenceEdgeIndex?: number;
  roofKind: "pitched" | "flat" | "green";
}): FillAreaReferenceFrame | undefined {
  const edge = resolveCanonicalRoofReferenceEdge({
    points: input.roofPoints,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: input.roofKind,
  });
  if (!edge) return undefined;
  const tangent = { ...edge.direction };
  return {
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    edgeIndex: edge.edgeIndex,
  };
}

/**
 * Builds the signed press-drag rectangle in canonical image coordinates.
 * The same polygon is suitable for both the dashed overlay and final fill.
 */
export function buildOrientedFillAreaPolygon(input: {
  start: Pt;
  end: Pt;
  frame: Pick<FillAreaReferenceFrame, "tangent" | "normal">;
}): Pt[] {
  const delta = {
    x: input.end.x - input.start.x,
    y: input.end.y - input.start.y,
  };
  const u = delta.x * input.frame.tangent.x + delta.y * input.frame.tangent.y;
  const v = delta.x * input.frame.normal.x + delta.y * input.frame.normal.y;
  const along = {
    x: input.frame.tangent.x * u,
    y: input.frame.tangent.y * u,
  };
  const across = {
    x: input.frame.normal.x * v,
    y: input.frame.normal.y * v,
  };
  return [
    { ...input.start },
    { x: input.start.x + along.x, y: input.start.y + along.y },
    {
      x: input.start.x + along.x + across.x,
      y: input.start.y + along.y + across.y,
    },
    { x: input.start.x + across.x, y: input.start.y + across.y },
  ];
}
