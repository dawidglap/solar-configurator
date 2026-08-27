import { rotateMetricPoint, type MetricPolygon } from "../geometry-v2";
import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_CONSTANTS_MM,
  K2_D_DOME_SYSTEM_ID,
  calculateK2DDomeLongSideBlockSizeMm,
  calculateK2DDomeRailDirectionBlockSizeMm,
  k2DDomeMetresToMillimetres,
  k2DDomeMillimetresToMetres,
} from "./k2-d-dome";
import {
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_SYSTEM_ID,
  calculateK2SDomeLongSideBlockSizeMm,
  calculateK2SDomeRailDirectionBlockSizeMm,
  metresToMillimetres,
  millimetresToMetres,
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

function fieldDimensions(input: {
  systemId: GroupK2MontageFieldsInput["systemId"];
  moduleWidthM: number;
  moduleLengthM: number;
  rowSpaceM: number;
  rows: number;
  columns: number;
}): { railSizeM: number; longSideSizeM: number } {
  if (input.systemId === K2_D_DOME_SYSTEM_ID) {
    return {
      railSizeM: k2DDomeMillimetresToMetres(
        calculateK2DDomeRailDirectionBlockSizeMm({
          moduleWidthMm: k2DDomeMetresToMillimetres(input.moduleWidthM),
          rowSpaceMm: k2DDomeMetresToMillimetres(input.rowSpaceM),
          quantityRows: input.rows,
        }),
      ),
      longSideSizeM: k2DDomeMillimetresToMetres(
        calculateK2DDomeLongSideBlockSizeMm({
          moduleLengthMm: k2DDomeMetresToMillimetres(input.moduleLengthM),
          numberOfColumns: input.columns,
        }),
      ),
    };
  }
  return {
    railSizeM: millimetresToMetres(
      calculateK2SDomeRailDirectionBlockSizeMm({
        moduleWidthMm: metresToMillimetres(input.moduleWidthM),
        rowSpaceMm: metresToMillimetres(input.rowSpaceM),
        quantityRows: input.rows,
      }),
    ),
    longSideSizeM: millimetresToMetres(
      calculateK2SDomeLongSideBlockSizeMm({
        moduleLengthMm: metresToMillimetres(input.moduleLengthM),
        numberOfColumns: input.columns,
      }),
    ),
  };
}

function largestCompliantCount(
  axis: "rows" | "columns",
  input: GroupK2MontageFieldsInput,
  limitM: number,
): number {
  let count = 1;
  while (count < 10_000) {
    const next = count + 1;
    const dimensions = fieldDimensions({
      systemId: input.systemId,
      moduleWidthM: input.moduleWidthM,
      moduleLengthM: input.moduleLengthM,
      rowSpaceM: input.rowSpaceM,
      rows: axis === "rows" ? next : 1,
      columns: axis === "columns" ? next : 1,
    });
    const size = axis === "rows" ? dimensions.railSizeM : dimensions.longSideSizeM;
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
  const maxRows = largestCompliantCount("rows", input, maxRailSizeM);
  const maxColumns = largestCompliantCount("columns", input, maxLongSideSizeM);
  const ordered = [...input.blocks].sort(compareBlocks);
  const byCoordinate = new Map<string, PlacedAdvancedBlock>();
  for (const block of ordered) {
    const key = coordinateKey(block.rowIndex, block.columnIndex);
    if (byCoordinate.has(key)) {
      throw new RangeError(`Duplicate K2 grid position ${key}.`);
    }
    byCoordinate.set(key, block);
  }

  const unassigned = new Set(byCoordinate.keys());
  const fields: K2MontageField[] = [];
  const blockToFieldKey: Record<string, string> = {};
  while (unassigned.size > 0) {
    const seed = ordered.find((block) => unassigned.has(coordinateKey(block.rowIndex, block.columnIndex)));
    if (!seed) throw new Error("K2 Montagefeld grouping lost an unassigned block.");

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
    const rowStart = rows[0];
    const rowEnd = rows[rows.length - 1];
    const columnStart = columns[0];
    const columnEnd = columns[columns.length - 1];
    const fieldKey = `f:r${rowStart}-${rowEnd}:c${columnStart}-${columnEnd}`;
    const dimensions = fieldDimensions({
      systemId: input.systemId,
      moduleWidthM: input.moduleWidthM,
      moduleLengthM: input.moduleLengthM,
      rowSpaceM: input.rowSpaceM,
      rows: rows.length,
      columns: columns.length,
    });
    const moduleCount = fieldBlocks.reduce((sum, block) => sum + block.moduleSlots.length, 0);
    const identity = input.systemId === K2_D_DOME_SYSTEM_ID
      ? { systemId: K2_D_DOME_SYSTEM_ID, adapterVersion: K2_D_DOME_ADAPTER_VERSION }
      : { systemId: K2_S_DOME_SYSTEM_ID, adapterVersion: K2_S_DOME_ADAPTER_VERSION };
    fields.push({
      ...identity,
      fieldKey,
      blockKeys: fieldBlocks.map((block) => block.blockKey),
      rowStart,
      rowEnd,
      columnStart,
      columnEnd,
      blockCount: fieldBlocks.length,
      moduleCount,
      railSizeM: dimensions.railSizeM,
      longSideSizeM: dimensions.longSideSizeM,
      outline: fieldOutline(fieldBlocks),
    });
    for (const block of fieldBlocks) {
      unassigned.delete(coordinateKey(block.rowIndex, block.columnIndex));
      blockToFieldKey[block.blockKey] = fieldKey;
    }
  }

  return {
    version: K2_MONTAGE_FIELD_GROUPING_VERSION,
    fields,
    blockToFieldKey,
    maxRailSizeM,
    maxLongSideSizeM,
  };
}
