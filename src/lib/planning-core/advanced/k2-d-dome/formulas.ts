import { K2_D_DOME_CONSTANTS_MM } from "./constants";

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

export function k2DDomeMillimetresToMetres(valueMm: number): number {
  requireFinite(valueMm, "Millimetre value");
  return valueMm / 1000;
}

export function k2DDomeMetresToMillimetres(valueM: number): number {
  requireFinite(valueM, "Metric value");
  return valueM * 1000;
}

/** x = asin(164.5 / (module width - 40)), K2 drawing 07-481-08. */
export function calculateK2DDomeEffectiveTiltDeg(moduleWidthMm: number): number {
  requireFinite(moduleWidthMm, "Module width");
  const denominator =
    moduleWidthMm - K2_D_DOME_CONSTANTS_MM.effectiveSpanReduction;
  const ratio = K2_D_DOME_CONSTANTS_MM.supportRise / denominator;
  if (!(denominator > 0) || ratio < -1 || ratio > 1) {
    throw new RangeError("Module width cannot produce a real D-Dome tilt.");
  }
  return (Math.asin(ratio) * 180) / Math.PI;
}

export function calculateK2DDomeProjectedModuleDepthMm(
  moduleWidthMm: number,
): number {
  const tiltRadians =
    (calculateK2DDomeEffectiveTiltDeg(moduleWidthMm) * Math.PI) / 180;
  return moduleWidthMm * Math.cos(tiltRadians);
}

export function calculateK2DDomeAssemblyDimension1Mm(
  moduleWidthMm: number,
): number {
  const tiltRadians =
    (calculateK2DDomeEffectiveTiltDeg(moduleWidthMm) * Math.PI) / 180;
  const constants = K2_D_DOME_CONSTANTS_MM;
  return (
    (moduleWidthMm - constants.effectiveSpanReduction) *
      Math.cos(tiltRadians) -
    constants.assemblyReferenceLow -
    constants.assemblyReferenceBase +
    constants.assemblyReferenceHigh
  );
}

export function calculateK2DDomeAssemblyDimension2Mm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
}): number {
  requireFinite(input.rowSpaceMm, "Row space");
  const projectedDepthMm = calculateK2DDomeProjectedModuleDepthMm(
    input.moduleWidthMm,
  );
  const constants = K2_D_DOME_CONSTANTS_MM;
  return (
    input.rowSpaceMm -
    2 * (projectedDepthMm - constants.assemblyReferenceLow) -
    constants.centralSystemDimension
  );
}

export function calculateK2DDomeServiceCorridorMm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
}): number {
  return (
    calculateK2DDomeAssemblyDimension2Mm(input) -
    2 * K2_D_DOME_CONSTANTS_MM.assemblyReferenceLow
  );
}

export function calculateK2DDomeOneBlockRailDepthMm(
  moduleWidthMm: number,
): number {
  return (
    2 * calculateK2DDomeProjectedModuleDepthMm(moduleWidthMm) +
    K2_D_DOME_CONSTANTS_MM.centralSystemDimension
  );
}

export function calculateK2DDomeAllowedRowSpaceRangeMm(
  moduleWidthMm: number,
): { min: number; max: number } {
  const oneBlockDepthMm = calculateK2DDomeOneBlockRailDepthMm(moduleWidthMm);
  return {
    min:
      oneBlockDepthMm +
      K2_D_DOME_CONSTANTS_MM.approximateServiceCorridor.min,
    max:
      oneBlockDepthMm +
      K2_D_DOME_CONSTANTS_MM.approximateServiceCorridor.max,
  };
}

export function calculateK2DDomeRailDirectionBlockSizeMm(input: {
  moduleWidthMm: number;
  rowSpaceMm: number;
  quantityRows: number;
}): number {
  requirePositiveInteger(input.quantityRows, "Quantity of rows");
  return (
    input.rowSpaceMm * input.quantityRows -
    calculateK2DDomeServiceCorridorMm(input)
  );
}

export function calculateK2DDomeLongSideBlockSizeMm(input: {
  moduleLengthMm: number;
  numberOfColumns: number;
}): number {
  requireFinite(input.moduleLengthMm, "Module length");
  requirePositiveInteger(input.numberOfColumns, "Number of columns");
  const constants = K2_D_DOME_CONSTANTS_MM;
  return (
    (input.moduleLengthMm + constants.moduleLongSideSpacing) *
      input.numberOfColumns -
    constants.moduleLongSideSpacing +
    2 * constants.longSideTerminalExtension
  );
}

