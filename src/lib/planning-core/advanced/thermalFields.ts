import { rotateMetricPoint, type MetricPolygon } from "../geometry-v2";
import { ADVANCED_BLOCK_ENGINE_VERSION } from "./types";
import type { PlacedAdvancedBlock } from "./types";
import { groupEffectiveMontageFields } from "./k2MontageFields";
import type { ThermalFieldLimits } from "./surfacePlanning";

export const THERMAL_FIELD_GROUPING_VERSION = "thermal-fields-v1" as const;

export type ThermalField = {
  thermalFieldKey: string;
  unitKeys: string[];
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  unitCount: number;
  moduleCount: number;
  rowDirectionSizeM: number;
  columnDirectionSizeM: number;
  primaryFieldLimitM: number;
  secondaryFieldLimitM?: number;
  compliant: boolean;
  outline: MetricPolygon;
};

export type ThermalFieldGroupingResult = {
  version: typeof THERMAL_FIELD_GROUPING_VERSION;
  fields: ThermalField[];
  unitToThermalFieldKey: Record<string, string>;
  compliant: boolean;
};

/**
 * Partitions existing physical placement units without moving or deleting them.
 * Rows map to the placement rail/downhill axis and columns to the module-long-
 * side/First axis. The same footprint measurement used by Montagefelder is
 * intentionally reused, while identities and limits remain separate domains.
 */
export function groupThermalFields(input: {
  units: readonly PlacedAdvancedBlock[];
  pitchM: { x: number; y: number };
  limits: ThermalFieldLimits;
}): ThermalFieldGroupingResult {
  const maxRailSizeM = input.limits.kind === "flat-block"
    ? input.limits.maxRailDirectionM
    : input.limits.maxColumnDirectionM;
  const maxLongSideSizeM = input.limits.kind === "flat-block"
    ? input.limits.maxModuleLongSideDirectionM
    : input.limits.maxRowDirectionM;
  const grouped = groupEffectiveMontageFields({
    blocks: input.units,
    pitchM: input.pitchM,
    maxRailSizeM,
    maxLongSideSizeM,
  });
  const fields = grouped.map((field) => {
    const thermalFieldKey = field.fieldKey.replace(/^f:/, "t:");
    const compliant = field.railSizeM <= maxRailSizeM + 1e-9 &&
      (maxLongSideSizeM === undefined || field.longSideSizeM <= maxLongSideSizeM + 1e-9);
    return {
      thermalFieldKey,
      unitKeys: field.blockKeys,
      rowStart: field.rowStart,
      rowEnd: field.rowEnd,
      columnStart: field.columnStart,
      columnEnd: field.columnEnd,
      unitCount: field.blockCount,
      moduleCount: field.moduleCount,
      rowDirectionSizeM: field.longSideSizeM,
      columnDirectionSizeM: field.railSizeM,
      primaryFieldLimitM: maxRailSizeM,
      ...(maxLongSideSizeM !== undefined ? { secondaryFieldLimitM: maxLongSideSizeM } : {}),
      compliant,
      outline: field.outline,
    };
  });
  const unitToThermalFieldKey: Record<string, string> = {};
  fields.forEach((field) => field.unitKeys.forEach((unitKey) => {
    if (unitToThermalFieldKey[unitKey]) {
      throw new Error(`Thermal unit ${unitKey} was assigned more than once.`);
    }
    unitToThermalFieldKey[unitKey] = field.thermalFieldKey;
  }));
  if (Object.keys(unitToThermalFieldKey).length !== input.units.length) {
    throw new Error("Thermal grouping did not assign every placement unit exactly once.");
  }
  return {
    version: THERMAL_FIELD_GROUPING_VERSION,
    fields,
    unitToThermalFieldKey,
    compliant: fields.every((field) => field.compliant),
  };
}

export type RectangularThermalUnit = {
  unitKey: string;
  centerM: { x: number; y: number };
  widthM: number;
  heightM: number;
  rotationCartesianDeg: number;
  moduleCount?: number;
};

/** Adapter for legacy-v1 module rectangles; it changes no placement geometry. */
export function groupRectangularThermalUnits(input: {
  units: readonly RectangularThermalUnit[];
  pitchM: { x: number; y: number };
  limits: Extract<ThermalFieldLimits, { kind: "pitched-grid" }>;
}): ThermalFieldGroupingResult {
  if (!input.units.length) {
    return {
      version: THERMAL_FIELD_GROUPING_VERSION,
      fields: [],
      unitToThermalFieldKey: {},
      compliant: true,
    };
  }
  const rotation = input.units[0].rotationCartesianDeg;
  const localCenters = input.units.map((unit) =>
    rotateMetricPoint(unit.centerM, -rotation));
  const minX = Math.min(...localCenters.map((point) => point.x));
  const minY = Math.min(...localCenters.map((point) => point.y));
  const blocks: PlacedAdvancedBlock[] = input.units.map((unit, index) => {
    const local = localCenters[index];
    const columnIndex = Math.round((local.x - minX) / input.pitchM.x);
    const rowIndex = Math.round((local.y - minY) / input.pitchM.y);
    const localFootprint = [
      { x: -unit.widthM / 2, y: -unit.heightM / 2 },
      { x: unit.widthM / 2, y: -unit.heightM / 2 },
      { x: unit.widthM / 2, y: unit.heightM / 2 },
      { x: -unit.widthM / 2, y: unit.heightM / 2 },
    ];
    const footprint = localFootprint.map((point) => {
      const rotated = rotateMetricPoint(point, rotation);
      return { x: unit.centerM.x + rotated.x, y: unit.centerM.y + rotated.y };
    });
    return {
      engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      blockIndex: index,
      blockKey: unit.unitKey,
      mountingSystemId: "legacy-standard-thermal-unit",
      definitionVersion: THERMAL_FIELD_GROUPING_VERSION,
      centerM: unit.centerM,
      planarOrientationDeg: 0,
      rotationCartesianDeg: rotation,
      footprint,
      moduleSlots: Array.from({ length: unit.moduleCount ?? 1 }, () => ({} as never)),
      derivedDimensionsM: {},
      warnings: [],
      columnIndex,
      rowIndex,
    };
  });
  return groupThermalFields({ units: blocks, pitchM: input.pitchM, limits: input.limits });
}
