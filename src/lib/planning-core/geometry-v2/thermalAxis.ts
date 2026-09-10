import { GEOMETRY_EPSILON_M, type GridAnchor } from "./types";

export type ThermalAxisBreak = {
  /** Complete physical extent of one indivisible placement unit on this axis. */
  unitExtentM: number;
  /** Largest whole number of units permitted in one thermal field. */
  maxUnitsPerField: number;
  /** Clear edge-to-edge distance between consecutive thermal fields. */
  separationGapM: number;
};

/**
 * Splits a finite run into the minimum number of fields required by the
 * maximum, distributing whole placement units as evenly as possible.
 * Larger groups are kept first so the result is stable for every caller.
 */
export function resolveBalancedThermalFieldSizes(
  unitCount: number,
  maxUnitsPerField: number,
): number[] {
  if (!Number.isInteger(unitCount) || unitCount <= 0) return [];
  if (!Number.isInteger(maxUnitsPerField) || maxUnitsPerField <= 0) {
    return [unitCount];
  }
  const fieldCount = Math.ceil(unitCount / maxUnitsPerField);
  const baseSize = Math.floor(unitCount / fieldCount);
  const largerFieldCount = unitCount % fieldCount;
  return Array.from(
    { length: fieldCount },
    (_, index) => baseSize + (index < largerFieldCount ? 1 : 0),
  );
}

function balancedBreakCountBefore(
  index: number,
  unitCount: number,
  maxUnitsPerField: number,
): number {
  const sizes = resolveBalancedThermalFieldSizes(unitCount, maxUnitsPerField);
  let boundary = 0;
  let breaks = 0;
  for (let fieldIndex = 0; fieldIndex < sizes.length - 1; fieldIndex += 1) {
    boundary += sizes[fieldIndex];
    if (index < boundary) break;
    breaks += 1;
  }
  return breaks;
}

export function resolveMaximumWholeUnits(input: {
  unitExtentM: number;
  regularPitchM: number;
  fieldLimitM: number;
}): number {
  if (
    !(input.unitExtentM > 0) ||
    !(input.regularPitchM > 0) ||
    !(input.fieldLimitM > 0) ||
    !Number.isFinite(input.unitExtentM) ||
    !Number.isFinite(input.regularPitchM) ||
    !Number.isFinite(input.fieldLimitM) ||
    input.unitExtentM > input.fieldLimitM + GEOMETRY_EPSILON_M
  ) return 0;
  return Math.max(
    1,
    Math.floor(
      (input.fieldLimitM - input.unitExtentM + GEOMETRY_EPSILON_M) /
        input.regularPitchM,
    ) + 1,
  );
}

export function thermalAxisSpan(input: {
  count: number;
  regularPitchM: number;
  break?: ThermalAxisBreak;
}): number {
  if (input.count <= 1) return 0;
  const base = (input.count - 1) * input.regularPitchM;
  const thermal = input.break;
  if (!thermal || thermal.maxUnitsPerField <= 0) return base;
  const breakCount = Math.floor((input.count - 1) / thermal.maxUnitsPerField);
  const regularGapM = input.regularPitchM - thermal.unitExtentM;
  return base + breakCount * (thermal.separationGapM - regularGapM);
}

export function generateThermalAxisPositions(input: {
  min: number;
  max: number;
  pitch: number;
  phase: number;
  anchor: GridAnchor;
  break?: ThermalAxisBreak;
  count?: number;
}): number[] {
  if (
    !Number.isFinite(input.min) ||
    !Number.isFinite(input.max) ||
    !(input.pitch > 0) ||
    !Number.isFinite(input.phase) ||
    input.phase < 0 ||
    input.phase >= 1 ||
    input.max < input.min - GEOMETRY_EPSILON_M
  ) return [];

  const axisBreak = input.break;
  const discoveryOffsetAt = (index: number) => thermalAxisSpan({
    count: index + 1,
    regularPitchM: input.pitch,
    break: axisBreak,
  });
  let count = input.count;
  if (count === undefined) {
    count = 0;
    while (count < 100_000) {
      const span = discoveryOffsetAt(count);
      if (span > input.max - input.min + GEOMETRY_EPSILON_M) break;
      count += 1;
    }
  }
  if (!Number.isInteger(count) || count <= 0) return [];

  const regularGapM = axisBreak
    ? input.pitch - axisBreak.unitExtentM
    : 0;
  const offsetAt = (index: number) => index * input.pitch + (
    axisBreak && axisBreak.maxUnitsPerField > 0
      ? balancedBreakCountBefore(index, count as number, axisBreak.maxUnitsPerField) *
        (axisBreak.separationGapM - regularGapM)
      : 0
  );
  const span = offsetAt(count - 1);
  const phaseOffset = input.phase * input.pitch;
  const first = input.anchor === "start"
    ? input.min + phaseOffset
    : input.anchor === "end"
      ? input.max - span - phaseOffset
      : (input.min + input.max - span) / 2 + phaseOffset;
  return Array.from({ length: count }, (_, index) => first + offsetAt(index));
}
