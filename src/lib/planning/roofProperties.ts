import { resolveSurfacePlanning } from "../planning-core/advanced/surfacePlanning";
import {
  getCanonicalRoofEdges,
  resolveRoofReferenceEdgeIndex,
} from "../planning-core/geometry-v2";
import type { ModulesConfig, RoofArea } from "@/types/planner";

export const FLAT_SLOPE_DIRECTION_TOLERANCE_DEG = 0.05;
export const DEFAULT_ROOF_EDGE_MARGIN_M = 0.2;

export function resolveRoofSlopeForKind(
  roofKind: "pitched" | "flat" | "green",
  slopeDeg: number | undefined,
): number {
  if (roofKind === "flat") return 0;
  return Number.isFinite(slopeDeg) ? slopeDeg as number : 0;
}

export function shouldShowRoofFallDirection(
  roofKind: "pitched" | "flat" | "green",
  slopeDeg: number,
): boolean {
  return roofKind === "pitched" || (
    roofKind === "green" && slopeDeg > FLAT_SLOPE_DIRECTION_TOLERANCE_DEG
  );
}

export function resolveRoofEdgeMarginM(
  roof: Pick<RoofArea, "edgeMarginM" | "surfacePlanning">,
  standardMarginM: number,
): number {
  if (typeof roof.edgeMarginM === "number" && Number.isFinite(roof.edgeMarginM)) {
    return Math.max(0, roof.edgeMarginM);
  }
  const planning = resolveSurfacePlanning(roof.surfacePlanning);
  if (planning.status === "supported-advanced") {
    return planning.config.advanced.layout.marginM;
  }
  return Math.max(0, standardMarginM);
}

export function resolveRoofEdgeMarginsM(
  roof: Pick<RoofArea, "points" | "edgeMarginMode" | "edgeStableIds" | "edgeMarginsM">,
  globalMarginM: number,
): number[] | undefined {
  if (roof.edgeMarginMode !== "perEdge") return undefined;
  const edges = getCanonicalRoofEdges(roof.points);
  if (roof.edgeStableIds?.length !== edges.length) {
    return edges.map(() => Math.max(0, globalMarginM));
  }
  return roof.edgeStableIds.map((edgeId) => {
    const value = roof.edgeMarginsM?.[edgeId];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : Math.max(0, globalMarginM);
  });
}

export function initializePerEdgeMargins(input: {
  roof: RoofArea;
  globalMarginM: number;
  createId: () => string;
}): Pick<RoofArea, "edgeMarginMode" | "edgeStableIds" | "edgeMarginsM"> {
  const edgeCount = getCanonicalRoofEdges(input.roof.points).length;
  const existingIds = input.roof.edgeStableIds?.length === edgeCount
    ? input.roof.edgeStableIds
    : undefined;
  const edgeStableIds = existingIds ?? Array.from({ length: edgeCount }, input.createId);
  const edgeMarginsM = { ...(input.roof.edgeMarginsM ?? {}) };
  edgeStableIds.forEach((edgeId) => {
    const existing = edgeMarginsM[edgeId];
    if (!(typeof existing === "number" && Number.isFinite(existing) && existing >= 0)) {
      edgeMarginsM[edgeId] = Math.max(0, input.globalMarginM);
    }
  });
  return { edgeMarginMode: "perEdge", edgeStableIds, edgeMarginsM };
}

function pointsMatch(
  first: { x: number; y: number },
  second: { x: number; y: number },
  epsilon = 0.5,
): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= epsilon;
}

/** Keeps edge overrides attached to physical edges across topology edits. */
export function reconcileRoofEdgeMarginState(input: {
  roof: RoofArea;
  nextPoints: RoofArea["points"];
  createId: () => string;
}): Pick<RoofArea, "edgeStableIds" | "edgeMarginsM"> | undefined {
  const oldEdges = getCanonicalRoofEdges(input.roof.points);
  const newEdges = getCanonicalRoofEdges(input.nextPoints);
  const oldIds = input.roof.edgeStableIds;
  if (!oldIds || oldIds.length !== oldEdges.length) return undefined;

  const usedIds = new Set<string>();
  const nextIds = newEdges.map((edge, edgeIndex) => {
    const exactIndex = oldEdges.findIndex((oldEdge, oldIndex) => {
      const oldId = oldIds[oldIndex];
      if (usedIds.has(oldId)) return false;
      return (
        pointsMatch(oldEdge.start, edge.start) && pointsMatch(oldEdge.end, edge.end)
      ) || (
        pointsMatch(oldEdge.start, edge.end) && pointsMatch(oldEdge.end, edge.start)
      );
    });
    const fallbackId = oldEdges.length === newEdges.length ? oldIds[edgeIndex] : undefined;
    const edgeId = exactIndex >= 0 ? oldIds[exactIndex] : (
      fallbackId && !usedIds.has(fallbackId) ? fallbackId : input.createId()
    );
    usedIds.add(edgeId);
    return edgeId;
  });
  const nextMargins = Object.fromEntries(
    nextIds.flatMap((edgeId) => {
      const marginM = input.roof.edgeMarginsM?.[edgeId];
      return typeof marginM === "number" && Number.isFinite(marginM) && marginM >= 0
        ? [[edgeId, marginM] as const]
        : [];
    }),
  );
  return { edgeStableIds: nextIds, edgeMarginsM: nextMargins };
}

export function modulesWithRoofEdgeMargin(
  roof: Pick<RoofArea, "edgeMarginM" | "surfacePlanning">,
  modules: ModulesConfig,
): ModulesConfig {
  return { ...modules, marginM: resolveRoofEdgeMarginM(roof, modules.marginM) };
}

export type RoofBuildingPlanningCompleteness = {
  complete: boolean;
  missing: Array<"polygon" | "slope" | "fall-direction" | "margin" | "reference-edge">;
};

export function isRoofBuildingPlanningComplete(input: {
  roof: RoofArea;
  roofKind: "pitched" | "flat" | "green";
  standardMarginM: number;
}): RoofBuildingPlanningCompleteness {
  const missing: RoofBuildingPlanningCompleteness["missing"] = [];
  if (getCanonicalRoofEdges(input.roof.points).length < 3) missing.push("polygon");
  const planning = resolveSurfacePlanning(input.roof.surfacePlanning);
  const slope = resolveRoofSlopeForKind(
    input.roofKind,
    planning.status === "supported-advanced"
      ? planning.config.surface.slopeDeg ?? input.roof.tiltDeg
      : input.roof.tiltDeg,
  );
  if (!Number.isFinite(slope) || (slope as number) < 0) missing.push("slope");
  if (
    shouldShowRoofFallDirection(input.roofKind, slope) &&
    !(planning.status === "supported-advanced" &&
      Number.isFinite(planning.config.surface.fallAzimuthDeg)) &&
    !Number.isFinite(input.roof.fallAzimuthDeg) &&
    !Number.isFinite(input.roof.azimuthDeg)
  ) missing.push("fall-direction");
  if (!Number.isFinite(resolveRoofEdgeMarginM(input.roof, input.standardMarginM))) {
    missing.push("margin");
  }
  if (resolveRoofReferenceEdgeIndex({
    points: input.roof.points,
    requestedIndex: input.roof.referenceEdgeIndex,
    roofKind: input.roofKind,
  }) == null) missing.push("reference-edge");
  return { complete: missing.length === 0, missing };
}
