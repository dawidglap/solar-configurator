import type { Pt } from "@/types/planner";

export const THERMAL_FIELD_COLORS = [
  "#2dd4bf",
  "#60a5fa",
  "#a78bfa",
  "#f59e0b",
  "#34d399",
  "#fb7185",
  "#22d3ee",
  "#f97316",
] as const;

export type ThermalFieldDisplayInput = {
  key: string;
  outlinePx: Pt[];
  lengthM: number;
  widthM: number;
  moduleCount: number;
  blockCount?: number;
  lengthLimitM?: number;
  widthLimitM?: number;
  valid: boolean;
};

export type ThermalFieldDisplay = ThermalFieldDisplayInput & {
  displayId: `T${number}`;
  color: string;
};

function samePoint(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Prevent preview children from causing a child -> CanvasStage render loop. */
export function areThermalFieldDisplayInputsEqual(
  a: readonly ThermalFieldDisplayInput[],
  b: readonly ThermalFieldDisplayInput[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((field, index) => {
    const other = b[index];
    return Boolean(
      other &&
      field.key === other.key &&
      field.lengthM === other.lengthM &&
      field.widthM === other.widthM &&
      field.moduleCount === other.moduleCount &&
      field.blockCount === other.blockCount &&
      field.lengthLimitM === other.lengthLimitM &&
      field.widthLimitM === other.widthLimitM &&
      field.valid === other.valid &&
      field.outlinePx.length === other.outlinePx.length &&
      field.outlinePx.every((point, pointIndex) =>
        samePoint(point, other.outlinePx[pointIndex]),
      )
    );
  });
}

function hashKey(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableThermalIdentity(key: string): string {
  const thermalPrefix = key.lastIndexOf("t:");
  return thermalPrefix >= 0 ? key.slice(thermalPrefix) : key;
}

/** Presentation-only mapping. Input order remains the domain's deterministic topology order. */
export function buildThermalFieldDisplay(
  fields: readonly ThermalFieldDisplayInput[],
): ThermalFieldDisplay[] {
  let previousColorIndex = -1;
  return fields.map((field, index) => {
    let colorIndex = (hashKey(stableThermalIdentity(field.key)) + index) % THERMAL_FIELD_COLORS.length;
    if (colorIndex === previousColorIndex) {
      colorIndex = (colorIndex + 1) % THERMAL_FIELD_COLORS.length;
    }
    previousColorIndex = colorIndex;
    return {
      ...field,
      displayId: `T${index + 1}`,
      color: THERMAL_FIELD_COLORS[colorIndex],
    };
  });
}

export function formatFieldMetres(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
