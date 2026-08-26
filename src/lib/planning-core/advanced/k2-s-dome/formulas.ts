import { K2_S_DOME_CONSTANTS_MM } from "./constants";

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

export function millimetresToMetres(valueMm: number): number {
  requireFinite(valueMm, "Millimetre value");
  return valueMm / 1000;
}

export function metresToMillimetres(valueM: number): number {
  requireFinite(valueM, "Metric value");
  return valueM * 1000;
}

/** x = asin(164.5 / (module width - 40)), K2 drawing 07-482-05. */
export function calculateK2SDomeEffectiveTiltDeg(moduleWidthMm: number): number {
  requireFinite(moduleWidthMm, "Module width");
  const denominator =
    moduleWidthMm - K2_S_DOME_CONSTANTS_MM.effectiveSpanReduction;
  const ratio = K2_S_DOME_CONSTANTS_MM.supportRise / denominator;
  if (!(denominator > 0) || ratio < -1 || ratio > 1) {
    throw new RangeError("Module width cannot produce a real S-Dome tilt.");
  }
  return (Math.asin(ratio) * 180) / Math.PI;
}

export function calculateK2SDomeAssemblyDimension1Mm(
  moduleWidthMm: number,
): number {
  const tiltRadians =
    (calculateK2SDomeEffectiveTiltDeg(moduleWidthMm) * Math.PI) / 180;
  const constants = K2_S_DOME_CONSTANTS_MM;
  return (
    (moduleWidthMm - constants.effectiveSpanReduction) *
      Math.cos(tiltRadians) -
    constants.assemblyReferenceLow -
    constants.assemblyReferenceBase +
    constants.assemblyReferenceHigh
  );
}

export function calculateK2SDomeAssemblyDimension2Mm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
}): number {
  requireFinite(input.rowSpaceMm, "Row space");
  const tiltRadians =
    (calculateK2SDomeEffectiveTiltDeg(input.moduleWidthMm) * Math.PI) / 180;
  const constants = K2_S_DOME_CONSTANTS_MM;
  return (
    input.rowSpaceMm -
    Math.cos(tiltRadians) * input.moduleWidthMm -
    constants.highSideTerminalExtension +
    constants.assemblyReferenceLow
  );
}

export function calculateK2SDomeServiceCorridorMm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
}): number {
  requireFinite(input.rowSpaceMm, "Row space");
  const tiltRadians =
    (calculateK2SDomeEffectiveTiltDeg(input.moduleWidthMm) * Math.PI) / 180;
  return input.rowSpaceMm - input.moduleWidthMm * Math.cos(tiltRadians);
}

export function calculateK2SDomeRailDirectionBlockSizeMm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
  quantityRows: number;
}): number {
  requirePositiveInteger(input.quantityRows, "Quantity of rows");
  const constants = K2_S_DOME_CONSTANTS_MM;
  return (
    input.rowSpaceMm * input.quantityRows -
    calculateK2SDomeServiceCorridorMm(input) +
    constants.highSideTerminalExtension +
    constants.lowSideMinimumTerminalExtension
  );
}

export function calculateK2SDomeLongSideBlockSizeMm(input: {
  moduleLengthMm: number;
  numberOfColumns: number;
}): number {
  requireFinite(input.moduleLengthMm, "Module length");
  requirePositiveInteger(input.numberOfColumns, "Number of columns");
  const constants = K2_S_DOME_CONSTANTS_MM;
  return (
    (input.moduleLengthMm + constants.moduleLongSideSpacing) *
      input.numberOfColumns -
    constants.moduleLongSideSpacing +
    2 * constants.longSideTerminalExtension
  );
}

