import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  type AdvancedSurfacePlanningV1,
} from "@/lib/planning-core/advanced";
import {
  resolveCompanyThermalFieldLimits,
  type CompanyPlannerDefaultsV1,
} from "@/lib/planning/companyPlannerDefaults";

/**
 * Resolves missing per-roof thermal inputs for draft/preview initialization.
 * It never mutates the persisted roof document; Apply stores the resolved input.
 */
export function withEffectiveAdvancedThermalLimits(
  config: AdvancedSurfacePlanningV1,
  company: CompanyPlannerDefaultsV1,
): AdvancedSurfacePlanningV1 {
  const systemId = config.advanced.system.systemId;
  const resolved = resolveCompanyThermalFieldLimits({
    company,
    roofKind: "flat",
    mountingOrientation:
      systemId === K2_D_DOME_SYSTEM_ID || systemId === GENERIC_EAST_WEST_SYSTEM_ID
        ? "east-west"
        : "south",
  });
  if (resolved.kind !== "flat-block") return config;
  return {
    ...config,
    thermalFieldLimits: {
      ...resolved,
      ...config.thermalFieldLimits,
    },
  };
}
