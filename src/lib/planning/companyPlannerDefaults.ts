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
} as const;

export const COMPANY_MODULE_SPACING_LIMITS_MM = {
  min: 0,
  max: 500,
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
  if (errors.length || horizontalMm === undefined || verticalMm === undefined) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    value: {
      schemaVersion: COMPANY_PLANNER_DEFAULTS_SCHEMA_VERSION,
      moduleSpacing: { horizontalMm, verticalMm },
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
