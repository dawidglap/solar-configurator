/** SOLA technical input bounds; they are not K2-approved product limits. */
export const GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M = {
  min: 0.01,
  max: 5,
} as const;

export const GREEN_ROOF_GENERIC_TILT_RANGE_DEG = {
  min: 0,
  max: 45,
} as const;

export const GREEN_ROOF_GENERIC_SPACING_RANGE_M = {
  min: 0,
  max: 5,
} as const;

export const GREEN_ROOF_GENERIC_DEFAULTS = {
  undersideClearanceM: 0.3,
  nominalTiltDeg: 10,
  moduleGapX: 0.02,
  moduleGapY: 0.02,
  blockGapX: 0,
  blockGapY: 0.2,
} as const;

export type GreenRoofGenericValidationIssue = {
  code:
    | "invalid-underside-clearance"
    | "invalid-generic-tilt"
    | "invalid-generic-spacing";
  field: "undersideClearanceM" | "nominalTiltDeg" | "spacing";
  message: string;
};

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validateGreenRoofGenericInputs(input: {
  undersideClearanceM: number | undefined;
  nominalTiltDeg: number;
  spacingsM: readonly number[];
}): GreenRoofGenericValidationIssue[] {
  const issues: GreenRoofGenericValidationIssue[] = [];
  if (
    input.undersideClearanceM === undefined ||
    !inRange(input.undersideClearanceM, GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M)
  ) {
    issues.push({
      code: "invalid-underside-clearance",
      field: "undersideClearanceM",
      message: `Höhe UK muss zwischen ${GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.min * 100} und ${GREEN_ROOF_UNDERSIDE_CLEARANCE_RANGE_M.max * 100} cm liegen.`,
    });
  }
  if (!inRange(input.nominalTiltDeg, GREEN_ROOF_GENERIC_TILT_RANGE_DEG)) {
    issues.push({
      code: "invalid-generic-tilt",
      field: "nominalTiltDeg",
      message: `Die freie Modulneigung muss zwischen ${GREEN_ROOF_GENERIC_TILT_RANGE_DEG.min}° und ${GREEN_ROOF_GENERIC_TILT_RANGE_DEG.max}° liegen.`,
    });
  }
  if (
    input.spacingsM.some(
      (value) => !inRange(value, GREEN_ROOF_GENERIC_SPACING_RANGE_M),
    )
  ) {
    issues.push({
      code: "invalid-generic-spacing",
      field: "spacing",
      message: `Abstände müssen zwischen ${GREEN_ROOF_GENERIC_SPACING_RANGE_M.min} und ${GREEN_ROOF_GENERIC_SPACING_RANGE_M.max} m liegen.`,
    });
  }
  return issues;
}
