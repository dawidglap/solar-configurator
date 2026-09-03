import { rotateMetricPoint, type MetricPolygon } from "../geometry-v2";
import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_CONSTANTS_MM,
  K2_D_DOME_SYSTEM_ID,
} from "./k2-d-dome";
import {
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_SYSTEM_ID,
} from "./k2-s-dome";
import type { PlacedAdvancedBlock } from "./types";

export const K2_MONTAGE_FIELD_GROUPING_VERSION = "k2-montage-fields-v1" as const;

export type K2MontageFieldSystem =
  | {
      systemId: typeof K2_D_DOME_SYSTEM_ID;
      adapterVersion: typeof K2_D_DOME_ADAPTER_VERSION;
    }
  | {
      systemId: typeof K2_S_DOME_SYSTEM_ID;
      adapterVersion: typeof K2_S_DOME_ADAPTER_VERSION;
    };

export type K2MontageField = K2MontageFieldSystem & {
  fieldKey: string;
  blockKeys: string[];
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  blockCount: number;
  moduleCount: number;
  railSizeM: number;
  longSideSizeM: number;
  outline: MetricPolygon;
};

export type K2MontageFieldGroupingResult = {
  version: typeof K2_MONTAGE_FIELD_GROUPING_VERSION;
  fields: K2MontageField[];
  blockToFieldKey: Record<string, string>;
  maxRailSizeM: number;
  maxLongSideSizeM: number;
};

export type GroupK2MontageFieldsInput = K2MontageFieldSystem & {
  blocks: readonly PlacedAdvancedBlock[];
  moduleWidthM: number;
  moduleLengthM: number;
  rowSpaceM: number;
  /** Effective pitch from the same adapter definition used for placement. */
  pitchM?: { x: number; y: number };
};

export type EffectiveMontageField = {
  fieldKey: string;
  blockKeys: string[];
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  blockCount: number;
  moduleCount: number;
  railSizeM: number;
  longSideSizeM: number;
  outline: MetricPolygon;
};

export type GroupEffectiveMontageFieldsInput = {
  blocks: readonly PlacedAdvancedBlock[];
  pitchM: { x: number; y: number };
  maxRailSizeM?: number;
  maxLongSideSizeM?: number;
};

const EPSILON_M = 1e-9;

function coordinateKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function compareBlocks(first: PlacedAdvancedBlock, second: PlacedAdvancedBlock): number {
  return first.rowIndex - second.rowIndex ||
    first.columnIndex - second.columnIndex ||
    first.blockKey.localeCompare(second.blockKey);
}

function largestCompliantCount(
  axis: "rows" | "columns",
  input: GroupEffectiveMontageFieldsInput,
  single: { railSizeM: number; longSideSizeM: number },
  limitM: number,
): number {
  let count = 1;
  while (count < 10_000) {
    const next = count + 1;
    const size = axis === "rows"
      ? single.railSizeM + (next - 1) * input.pitchM.y
      : single.longSideSizeM + (next - 1) * input.pitchM.x;
    if (size > limitM + EPSILON_M) break;
    count = next;
  }
  return count;
}

function fieldOutline(blocks: readonly PlacedAdvancedBlock[]): MetricPolygon {
  const rotation = blocks[0]?.rotationCartesianDeg ?? 0;
  const points = blocks.flatMap((block) => block.footprint);
  const local = points.map((point) => rotateMetricPoint(point, -rotation));
  const minX = Math.min(...local.map((point) => point.x));
  const maxX = Math.max(...local.map((point) => point.x));
  const minY = Math.min(...local.map((point) => point.y));
  const maxY = Math.max(...local.map((point) => point.y));
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((point) => rotateMetricPoint(point, rotation));
}

/** Measures the outer edges of the block footprints in their real local axes. */
export function measureMontageFieldBlocks(
  blocks: readonly PlacedAdvancedBlock[],
): { railSizeM: number; longSideSizeM: number; outline: MetricPolygon } {
  if (!blocks.length) {
    throw new RangeError("A Montagefeld must contain at least one block.");
  }
  const rotation = blocks[0].rotationCartesianDeg;
  const local = blocks
    .flatMap((block) => block.footprint)
    .map((point) => rotateMetricPoint(point, -rotation));
  const minX = Math.min(...local.map((point) => point.x));
  const maxX = Math.max(...local.map((point) => point.x));
  const minY = Math.min(...local.map((point) => point.y));
  const maxY = Math.max(...local.map((point) => point.y));
  return {
    longSideSizeM: maxX - minX,
    railSizeM: maxY - minY,
    outline: fieldOutline(blocks),
  };
}

/**
 * Groups the already-generated effective blocks. No system formula is repeated:
 * field extents come from the exact collision footprints used by placement.
 */
export function groupEffectiveMontageFields(
  input: GroupEffectiveMontageFieldsInput,
): EffectiveMontageField[] {
  if (!input.blocks.length) return [];
  const ordered = [...input.blocks].sort(compareBlocks);
  const single = measureMontageFieldBlocks([ordered[0]]);
  const maxRows = input.maxRailSizeM === undefined
    ? ordered.length
    : largestCompliantCount("rows", input, single, input.maxRailSizeM);
  const maxColumns = input.maxLongSideSizeM === undefined
    ? ordered.length
    : largestCompliantCount("columns", input, single, input.maxLongSideSizeM);
  const byCoordinate = new Map<string, PlacedAdvancedBlock>();
  for (const block of ordered) {
    const key = coordinateKey(block.rowIndex, block.columnIndex);
    if (byCoordinate.has(key)) throw new RangeError(`Duplicate grid position ${key}.`);
    byCoordinate.set(key, block);
  }

  const unassigned = new Set(byCoordinate.keys());
  const fields: EffectiveMontageField[] = [];
  while (unassigned.size > 0) {
    const seed = ordered.find((block) => unassigned.has(coordinateKey(block.rowIndex, block.columnIndex)));
    if (!seed) throw new Error("Montagefeld grouping lost an unassigned block.");
    const columns: number[] = [];
    for (let column = seed.columnIndex; columns.length < maxColumns; column += 1) {
      if (!unassigned.has(coordinateKey(seed.rowIndex, column))) break;
      columns.push(column);
    }
    const rows = [seed.rowIndex];
    for (let row = seed.rowIndex + 1; rows.length < maxRows; row += 1) {
      if (!columns.every((column) => unassigned.has(coordinateKey(row, column)))) break;
      rows.push(row);
    }
    const fieldBlocks = rows.flatMap((row) =>
      columns.map((column) => byCoordinate.get(coordinateKey(row, column))!),
    ).sort(compareBlocks);
    const measurement = measureMontageFieldBlocks(fieldBlocks);
    const fieldKey = `f:r${rows[0]}-${rows[rows.length - 1]}:c${columns[0]}-${columns[columns.length - 1]}`;
    fields.push({
      fieldKey,
      blockKeys: fieldBlocks.map((block) => block.blockKey),
      rowStart: rows[0],
      rowEnd: rows[rows.length - 1],
      columnStart: columns[0],
      columnEnd: columns[columns.length - 1],
      blockCount: fieldBlocks.length,
      moduleCount: fieldBlocks.reduce((sum, block) => sum + block.moduleSlots.length, 0),
      railSizeM: measurement.railSizeM,
      longSideSizeM: measurement.longSideSizeM,
      outline: measurement.outline,
    });
    fieldBlocks.forEach((block) => unassigned.delete(coordinateKey(block.rowIndex, block.columnIndex)));
  }
  return fields;
}

/**
 * Groups already-placed K2 blocks. It never moves or removes a placement.
 * Holes split continuity; each emitted field is a deterministic rectangle of
 * orthogonally adjacent grid cells within the datasheet limits.
 */
export function groupK2MontageFields(
  input: GroupK2MontageFieldsInput,
): K2MontageFieldGroupingResult {
  const maxRailSizeM = (input.systemId === K2_D_DOME_SYSTEM_ID
    ? K2_D_DOME_CONSTANTS_MM.maxBlockRailDirection
    : K2_S_DOME_CONSTANTS_MM.maxBlockRailDirection) / 1000;
  const maxLongSideSizeM = (input.systemId === K2_D_DOME_SYSTEM_ID
    ? K2_D_DOME_CONSTANTS_MM.maxBlockLongSide
    : K2_S_DOME_CONSTANTS_MM.maxBlockLongSide) / 1000;
  const pitchM = input.pitchM ?? {
    x: input.moduleLengthM + (
      input.systemId === K2_D_DOME_SYSTEM_ID
        ? K2_D_DOME_CONSTANTS_MM.moduleLongSideSpacing
        : K2_S_DOME_CONSTANTS_MM.moduleLongSideSpacing
    ) / 1000,
    y: input.rowSpaceM,
  };
  const effectiveFields = groupEffectiveMontageFields({
    blocks: input.blocks,
    pitchM,
    maxRailSizeM,
    maxLongSideSizeM,
  });
  const fields: K2MontageField[] = [];
  const blockToFieldKey: Record<string, string> = {};
  for (const field of effectiveFields) {
    const identity = input.systemId === K2_D_DOME_SYSTEM_ID
      ? { systemId: K2_D_DOME_SYSTEM_ID, adapterVersion: K2_D_DOME_ADAPTER_VERSION }
      : { systemId: K2_S_DOME_SYSTEM_ID, adapterVersion: K2_S_DOME_ADAPTER_VERSION };
    fields.push({
      ...identity,
      ...field,
    });
    field.blockKeys.forEach((blockKey) => { blockToFieldKey[blockKey] = field.fieldKey; });
  }

  return {
    version: K2_MONTAGE_FIELD_GROUPING_VERSION,
    fields,
    blockToFieldKey,
    maxRailSizeM,
    maxLongSideSizeM,
  };
}
