import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import type { RoofArea } from "@/types/planner";
import { resolveRoofFallAzimuth, roofAzimuthCardinal } from "../roof/roofOrientation";
import { resolveInitialSonnendachRoofType } from "./advanced/advancedPlanningApplication";

function normalize360(value: number) {
  return ((value % 360) + 360) % 360;
}

/** Shared source of truth for the module directions shown by compass and sidebar. */
export function resolveModuleOrientationDirections(input: {
  roof?: RoofArea;
  advancedConfig?: AdvancedSurfacePlanningV1;
}): { isFlat: boolean; directionDegs: number[] } {
  const { roof, advancedConfig } = input;
  const isFlat = roof?.roofKind === "flat" || (
    roof?.roofKind === undefined && roof != null && (
      advancedConfig?.surface.kind === "flat" ||
      resolveInitialSonnendachRoofType(roof) === "flat"
    )
  );
  const system = advancedConfig?.advanced.system;
  const primaryModuleAzimuthDeg = system?.systemId === K2_S_DOME_SYSTEM_ID ||
      system?.systemId === GENERIC_SOUTH_SYSTEM_ID
    ? system.faceAzimuthDeg
    : system?.systemId === K2_D_DOME_SYSTEM_ID ||
        system?.systemId === GENERIC_EAST_WEST_SYSTEM_ID
      ? system.primaryFaceAzimuthDeg
      : undefined;
  const opposingModules = system?.systemId === K2_D_DOME_SYSTEM_ID ||
    system?.systemId === GENERIC_EAST_WEST_SYSTEM_ID;
  const primaryDirectionDeg = isFlat
    ? primaryModuleAzimuthDeg
    : roof
      ? resolveRoofFallAzimuth(roof)
      : undefined;
  const directionDegs = primaryDirectionDeg == null
    ? []
    : opposingModules && isFlat
      ? [normalize360(primaryDirectionDeg), normalize360(primaryDirectionDeg + 180)]
      : [normalize360(primaryDirectionDeg)];

  return { isFlat, directionDegs };
}

export function formatModuleOrientationDirection(directionDeg: number): string {
  const normalized = normalize360(directionDeg);
  return `${Math.round(normalized)}° ${roofAzimuthCardinal(normalized)}`;
}
