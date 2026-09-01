import { resolveSurfacePlanning } from "../planning-core/advanced/surfacePlanning";
import {
  getCanonicalRoofEdges,
  resolveRoofReferenceEdgeIndex,
} from "../planning-core/geometry-v2";
import type { ModulesConfig, RoofArea } from "@/types/planner";

export const FLAT_SLOPE_DIRECTION_TOLERANCE_DEG = 0.05;

export function shouldShowRoofFallDirection(
  roofKind: "pitched" | "flat" | "green",
  slopeDeg: number,
): boolean {
  return roofKind === "pitched" || slopeDeg > FLAT_SLOPE_DIRECTION_TOLERANCE_DEG;
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
  const slope = planning.status === "supported-advanced"
    ? planning.config.surface.slopeDeg ?? input.roof.tiltDeg
    : input.roof.tiltDeg;
  if (!Number.isFinite(slope) || (slope as number) < 0) missing.push("slope");
  if (
    (input.roofKind === "pitched" || (slope ?? 0) > FLAT_SLOPE_DIRECTION_TOLERANCE_DEG) &&
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
