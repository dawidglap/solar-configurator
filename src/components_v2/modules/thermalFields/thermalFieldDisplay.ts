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
  rowStart?: number;
  rowEnd?: number;
  columnStart?: number;
  columnEnd?: number;
  thermalSeparationGapM?: number;
};

export type ThermalFieldDisplay = ThermalFieldDisplayInput & {
  displayId: `T${number}`;
  color: string;
};

export type ThermalBreakDisplay = {
  key: string;
  start: Pt;
  end: Pt;
  gapM: number;
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
      field.rowStart === other.rowStart &&
      field.rowEnd === other.rowEnd &&
      field.columnStart === other.columnStart &&
      field.columnEnd === other.columnEnd &&
      field.thermalSeparationGapM === other.thermalSeparationGapM &&
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

function closestPointOnSegment(point: Pt, start: Pt, end: Pt): Pt {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return start;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2));
  return { x: start.x + t * dx, y: start.y + t * dy };
}

function closestOutlinePoints(first: readonly Pt[], second: readonly Pt[]): [Pt, Pt] {
  let best: [Pt, Pt] = [first[0], second[0]];
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (a: Pt, b: Pt) => {
    const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [a, b];
    }
  };
  first.forEach((point) => second.forEach((start, index) => {
    consider(point, closestPointOnSegment(point, start, second[(index + 1) % second.length]));
  }));
  second.forEach((point) => first.forEach((start, index) => {
    consider(closestPointOnSegment(point, start, first[(index + 1) % first.length]), point);
  }));
  return best;
}

/** One deterministic marker for each adjacent thermal-field boundary. */
export function buildThermalBreakDisplays(
  fields: readonly ThermalFieldDisplay[],
): ThermalBreakDisplay[] {
  return fields.flatMap((first, firstIndex) =>
    fields.slice(firstIndex + 1).flatMap((second) => {
      const columnAdjacent = first.columnEnd !== undefined && second.columnStart !== undefined &&
        first.columnEnd + 1 === second.columnStart &&
        (first.rowStart ?? 0) <= (second.rowEnd ?? -1) &&
        (second.rowStart ?? 0) <= (first.rowEnd ?? -1);
      const rowAdjacent = first.rowEnd !== undefined && second.rowStart !== undefined &&
        first.rowEnd + 1 === second.rowStart &&
        (first.columnStart ?? 0) <= (second.columnEnd ?? -1) &&
        (second.columnStart ?? 0) <= (first.columnEnd ?? -1);
      if ((!columnAdjacent && !rowAdjacent) || first.thermalSeparationGapM === undefined) return [];
      const [start, end] = closestOutlinePoints(first.outlinePx, second.outlinePx);
      return [{
        key: `${first.key}:${second.key}`,
        start,
        end,
        gapM: first.thermalSeparationGapM,
      }];
    }),
  );
}

/** Presentation-only mapping. Input order remains the domain's deterministic topology order. */
export function buildThermalFieldDisplay(
  fields: readonly ThermalFieldDisplayInput[],
): ThermalFieldDisplay[] {
  let previousColorIndex = -1;
  return fields.map((field, index) => {
    const topology = /t:r(\d+)-(\d+):c(\d+)-(\d+)/.exec(field.key);
    let colorIndex = (hashKey(stableThermalIdentity(field.key)) + index) % THERMAL_FIELD_COLORS.length;
    if (colorIndex === previousColorIndex) {
      colorIndex = (colorIndex + 1) % THERMAL_FIELD_COLORS.length;
    }
    previousColorIndex = colorIndex;
    return {
      ...field,
      displayId: `T${index + 1}`,
      color: THERMAL_FIELD_COLORS[colorIndex],
      ...(field.rowStart === undefined && topology
        ? {
            rowStart: Number(topology[1]),
            rowEnd: Number(topology[2]),
            columnStart: Number(topology[3]),
            columnEnd: Number(topology[4]),
          }
        : {}),
    };
  });
}

export function formatFieldMetres(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
