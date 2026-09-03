export const COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION = 1 as const;

/**
 * Technical fallbacks for companies that have not saved planner defaults yet.
 * These are generic clear module gaps for a normal clamp, not K2 Dome system
 * dimensions. K2 keeps its adapter-owned 18 mm long-side repeat dimension.
 */
export const BUILT_IN_COMPANY_PLANNER_DEFAULTS = {
  schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
  moduleSpacing: {
    horizontalMm: 19,
    verticalMm: 19,
  },
  thermalSeparations: {
    pitched: {
      maxFieldLengthM: 17.6,
      maxFieldWidthM: 17.6,
    },
    flat: {
      /** Maximum extent in the mounting-system rail/row direction. */
      maxPrimaryFieldLengthM: 12.3,
    },
    flatEastWest: {
      /** Maximum extent perpendicular to the primary rail/row direction. */
      maxSecondaryFieldLengthM: 16,
    },
  },
} as const;

export const COMPANY_MODULE_SPACING_LIMITS_MM = {
  min: 0,
  max: 500,
} as const;

export const COMPANY_THERMAL_FIELD_LIMITS_M = {
  min: 0.1,
  max: 100,
} as const;

export function isValidModuleSpacingMm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= COMPANY_MODULE_SPACING_LIMITS_MM.min &&
    value <= COMPANY_MODULE_SPACING_LIMITS_MM.max
  );
}

export type CompanyPlannerDefaultsV1 = {
  schemaVersion: typeof COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION;
  /** Clear edge-to-edge module gap used with a normal module clamp. */
  moduleSpacing: {
    horizontalMm: number;
    verticalMm: number;
  };
  thermalSeparations: {
    pitched: {
      maxFieldLengthM: number;
      maxFieldWidthM: number;
    };
    flat: {
      maxPrimaryFieldLengthM: number;
    };
    flatEastWest: {
      maxSecondaryFieldLengthM: number;
    };
  };
};

export type CompanyPlannerDefaultsValidation =
  | { valid: true; value: CompanyPlannerDefaultsV1 }
  | { valid: false; errors: string[] };

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function validateSpacingMm(
  value: unknown,
  field: "horizontalMm" | "verticalMm",
  errors: string[],
): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === undefined) {
    errors.push(`${field} must be a finite number.`);
    return undefined;
  }
  if (!isValidModuleSpacingMm(numeric)) {
    errors.push(
      `${field} must be between ${COMPANY_MODULE_SPACING_LIMITS_MM.min} and ${COMPANY_MODULE_SPACING_LIMITS_MM.max} mm.`,
    );
    return undefined;
  }
  return numeric;
}

export function isValidThermalFieldLimitM(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= COMPANY_THERMAL_FIELD_LIMITS_M.min &&
    value <= COMPANY_THERMAL_FIELD_LIMITS_M.max;
}

function readThermalLimit(
  value: unknown,
  path: string,
  errors: string[],
): number | undefined {
  if (!isValidThermalFieldLimitM(value)) {
    errors.push(`${path} must be between ${COMPANY_THERMAL_FIELD_LIMITS_M.min} and ${COMPANY_THERMAL_FIELD_LIMITS_M.max} m.`);
    return undefined;
  }
  return value;
}

export function validateCompanyPlannerDefaults(
  value: unknown,
): CompanyPlannerDefaultsValidation {
  const input = value as Record<string, unknown> | null;
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Planner defaults must be an object."] };
  }
  if (input.schemaVersion !== COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION) {
    errors.push("Unsupported planner defaults schema version.");
  }
  const spacing = input.moduleSpacing as Record<string, unknown> | null;
  if (!spacing || typeof spacing !== "object" || Array.isArray(spacing)) {
    errors.push("moduleSpacing must be an object.");
    return { valid: false, errors };
  }
  const horizontalMm = validateSpacingMm(
    spacing.horizontalMm,
    "horizontalMm",
    errors,
  );
  const verticalMm = validateSpacingMm(
    spacing.verticalMm,
    "verticalMm",
    errors,
  );
  const thermalInput = input.thermalSeparations as Record<string, unknown> | undefined;
  const pitchedInput = thermalInput?.pitched as Record<string, unknown> | undefined;
  const flatInput = thermalInput?.flat as Record<string, unknown> | undefined;
  const eastWestInput = thermalInput?.flatEastWest as Record<string, unknown> | undefined;
  // Optional for documents saved before thermal defaults existed. Resolution
  // supplies the built-in values without requiring a schema migration.
  const thermalSeparations = thermalInput === undefined
    ? {
        pitched: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.pitched },
        flat: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.flat },
        flatEastWest: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.flatEastWest },
      }
    : {
        pitched: {
          maxFieldLengthM: readThermalLimit(pitchedInput?.maxFieldLengthM, "thermalSeparations.pitched.maxFieldLengthM", errors),
          maxFieldWidthM: readThermalLimit(pitchedInput?.maxFieldWidthM, "thermalSeparations.pitched.maxFieldWidthM", errors),
        },
        flat: {
          maxPrimaryFieldLengthM: readThermalLimit(flatInput?.maxPrimaryFieldLengthM, "thermalSeparations.flat.maxPrimaryFieldLengthM", errors),
        },
        flatEastWest: {
          maxSecondaryFieldLengthM: readThermalLimit(eastWestInput?.maxSecondaryFieldLengthM, "thermalSeparations.flatEastWest.maxSecondaryFieldLengthM", errors),
        },
      };
  if (errors.length || horizontalMm === undefined || verticalMm === undefined) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    value: {
      schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
      moduleSpacing: { horizontalMm, verticalMm },
      thermalSeparations: thermalSeparations as CompanyPlannerDefaultsV1["thermalSeparations"],
    },
  };
}

export function resolveCompanyPlannerDefaults(
  value: unknown,
): CompanyPlannerDefaultsV1 {
  const result = validateCompanyPlannerDefaults(value);
  return result.valid
    ? result.value
    : {
        schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
        moduleSpacing: {
          horizontalMm:
            BUILT_IN_COMPANY_PLANNER_DEFAULTS.moduleSpacing.horizontalMm,
          verticalMm:
            BUILT_IN_COMPANY_PLANNER_DEFAULTS.moduleSpacing.verticalMm,
        },
        thermalSeparations: {
          pitched: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.pitched },
          flat: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.flat },
          flatEastWest: { ...BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations.flatEastWest },
        },
      };
}

export type EffectiveThermalFieldLimits =
  | {
      kind: "pitched-grid";
      maxRowDirectionM: number;
      maxColumnDirectionM: number;
    }
  | {
      kind: "flat-block";
      maxRailDirectionM: number;
      maxModuleLongSideDirectionM?: number;
    };

export function resolveCompanyThermalFieldLimits(input: {
  company?: unknown;
  roofKind: "pitched" | "flat";
  mountingOrientation?: "south" | "east-west";
}): EffectiveThermalFieldLimits {
  const defaults = resolveCompanyPlannerDefaults(input.company).thermalSeparations;
  if (input.roofKind === "pitched") {
    return {
      kind: "pitched-grid",
      maxRowDirectionM: defaults.pitched.maxFieldLengthM,
      maxColumnDirectionM: defaults.pitched.maxFieldWidthM,
    };
  }
  return {
    kind: "flat-block",
    maxRailDirectionM: defaults.flat.maxPrimaryFieldLengthM,
    ...(input.mountingOrientation === "east-west"
      ? { maxModuleLongSideDirectionM: defaults.flatEastWest.maxSecondaryFieldLengthM }
      : {}),
  };
}

export function companySpacingMmToMetres(valueMm: number): number {
  return valueMm / 1000;
}

export type PlanningModuleSpacingInput = {
  spacingM?: unknown;
  spacingXM?: unknown;
  spacingYM?: unknown;
};

export function resolveEffectiveModuleSpacingM(input: {
  planning?: PlanningModuleSpacingInput | null;
  company?: unknown;
}): { horizontalM: number; verticalM: number } {
  const company = resolveCompanyPlannerDefaults(input.company);
  const companyHorizontalM = companySpacingMmToMetres(
    company.moduleSpacing.horizontalMm,
  );
  const companyVerticalM = companySpacingMmToMetres(
    company.moduleSpacing.verticalMm,
  );
  const uniform = finiteNumber(input.planning?.spacingM);
  const horizontal = finiteNumber(input.planning?.spacingXM);
  const vertical = finiteNumber(input.planning?.spacingYM);
  return {
    horizontalM: horizontal ?? uniform ?? companyHorizontalM,
    verticalM: vertical ?? uniform ?? companyVerticalM,
  };
}
