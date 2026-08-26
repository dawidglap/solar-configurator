import {
  combinePolygonBounds,
  computeUsableRoof,
  generateGridPlacements,
  normalizeDegrees,
  polygonBounds,
  rotateMetricPoint,
  transformMetricPolygon,
  validatePlacementFootprint,
} from "../geometry-v2";
import { geographicPlanarOrientationToCartesianRotationDeg } from "./moduleGeometry";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  type AdvancedBlockDefinition,
  type AdvancedBlockLayoutResult,
  type ComputeAdvancedBlockLayoutInput,
  type ComputeFixedAdvancedBlockLayoutInput,
  type ExpandedAdvancedModule,
  type FixedAdvancedBlockLayoutResult,
  type PlacedAdvancedBlock,
} from "./types";

function orderedModuleSlots(definition: AdvancedBlockDefinition) {
  if (!definition.moduleSlots.length) {
    throw new RangeError("An Advanced block must contain at least one module slot.");
  }
  const indexes = definition.moduleSlots.map((slot) => slot.slotIndex);
  if (
    indexes.some((index) => !Number.isInteger(index) || index < 0) ||
    new Set(indexes).size !== indexes.length
  ) {
    throw new RangeError(
      "Advanced module slot indexes must be unique non-negative integers.",
    );
  }
  return [...definition.moduleSlots].sort(
    (first, second) => first.slotIndex - second.slotIndex,
  );
}

export function instantiateAdvancedBlock(input: {
  definition: AdvancedBlockDefinition;
  centerM: { x: number; y: number };
  blockIndex: number;
  columnIndex: number;
  rowIndex: number;
}): PlacedAdvancedBlock {
  const moduleSlots = orderedModuleSlots(input.definition);
  const rotationCartesianDeg =
    geographicPlanarOrientationToCartesianRotationDeg(
      input.definition.planarOrientationDeg,
    );
  return {
    engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
    blockIndex: input.blockIndex,
    blockKey: `r${input.rowIndex}:c${input.columnIndex}`,
    mountingSystemId: input.definition.mountingSystemId,
    definitionVersion: input.definition.definitionVersion,
    centerM: { ...input.centerM },
    planarOrientationDeg: input.definition.planarOrientationDeg,
    rotationCartesianDeg,
    footprint: transformMetricPolygon(input.definition.blockFootprint, {
      translationM: input.centerM,
      rotationCartesianDeg,
    }),
    moduleSlots,
    derivedDimensionsM: { ...input.definition.derivedDimensionsM },
    warnings: input.definition.warnings.map((warning) => ({ ...warning })),
    columnIndex: input.columnIndex,
    rowIndex: input.rowIndex,
  };
}

export function expandBlockToModules(
  block: PlacedAdvancedBlock,
): ExpandedAdvancedModule[] {
  return block.moduleSlots.map((slot) => {
    const rotatedCenter = rotateMetricPoint(
      slot.localCenterM,
      block.rotationCartesianDeg,
    );
    return {
      blockIndex: block.blockIndex,
      blockKey: block.blockKey,
      slotIndex: slot.slotIndex,
      mountingSystemId: block.mountingSystemId,
      centerM: {
        x: block.centerM.x + rotatedCenter.x,
        y: block.centerM.y + rotatedCenter.y,
      },
      projectedFootprint: transformMetricPolygon(slot.projectedFootprint, {
        translationM: block.centerM,
        rotationCartesianDeg: block.rotationCartesianDeg,
      }),
      planarRotationCartesianDeg: normalizeDegrees(
        block.rotationCartesianDeg + slot.localRotationCartesianDeg,
      ),
      faceAzimuthDeg: normalizeDegrees(
        block.planarOrientationDeg + slot.faceAzimuthOffsetDeg,
      ),
      nominalTiltDeg: slot.geometry.nominalTiltDeg,
      effectiveTiltDeg: slot.geometry.effectiveTiltDeg,
      crossSlopeM: slot.geometry.crossSlopeM,
      projectedAlongSlopeM: slot.geometry.projectedAlongSlopeM,
      riseM: slot.geometry.riseM,
    };
  });
}

export function computeAdvancedBlockLayout(
  input: ComputeAdvancedBlockLayoutInput,
): AdvancedBlockLayoutResult {
  const usableRoof = computeUsableRoof({
    roofPolygonM: input.roofPolygonM,
    marginM: input.marginM,
  });
  const rotationCartesianDeg =
    geographicPlanarOrientationToCartesianRotationDeg(
      input.blockDefinition.planarOrientationDeg,
    );
  const grid = generateGridPlacements({
    usableRoof,
    unit: {
      footprint: input.blockDefinition.blockFootprint,
      pitchM: input.blockDefinition.pitchM,
    },
    rotationCartesianDeg,
    gridOriginM: input.gridOriginM,
    phaseX: input.phaseX,
    phaseY: input.phaseY,
    anchorX: input.anchorX,
    anchorY: input.anchorY,
    reservedZones: input.reservedZones,
    snowGuards: input.snowGuards,
  });
  const blocks = grid.placements.map((placement, blockIndex) =>
    instantiateAdvancedBlock({
      definition: input.blockDefinition,
      centerM: placement.originM,
      blockIndex,
      columnIndex: placement.columnIndex,
      rowIndex: placement.rowIndex,
    }),
  );
  const modules = blocks.flatMap(expandBlockToModules);

  return {
    engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
    usableRoof,
    blocks,
    modules,
    blockCount: blocks.length,
    moduleCount: modules.length,
    rejected: grid.rejected,
    diagnostics: grid.diagnostics,
  };
}

function toGridLocal(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  rotationCartesianDeg: number,
) {
  return rotateMetricPoint(
    { x: point.x - origin.x, y: point.y - origin.y },
    -rotationCartesianDeg,
  );
}

function toWorld(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  rotationCartesianDeg: number,
) {
  const rotated = rotateMetricPoint(point, rotationCartesianDeg);
  return { x: rotated.x + origin.x, y: rotated.y + origin.y };
}

function fixedAxisPositions(input: {
  min: number;
  max: number;
  pitch: number;
  count: number;
  phase: number;
  anchor: "start" | "center" | "end";
}): number[] {
  const span = (input.count - 1) * input.pitch;
  const first =
    input.anchor === "start"
      ? input.min + input.phase * input.pitch
      : input.anchor === "end"
        ? input.max - span - input.phase * input.pitch
        : (input.min + input.max - span) / 2 + input.phase * input.pitch;
  return Array.from({ length: input.count }, (_, index) => first + index * input.pitch);
}

/**
 * Generates the exact requested matrix. Invalid candidates are retained with
 * their collision reasons; callers must not silently reduce the requested
 * quantity or materialize a partial result.
 */
export function computeFixedAdvancedBlockLayout(
  input: ComputeFixedAdvancedBlockLayoutInput,
): FixedAdvancedBlockLayoutResult {
  if (
    !Number.isInteger(input.blocksPerRow) ||
    input.blocksPerRow <= 0 ||
    !Number.isInteger(input.rowCount) ||
    input.rowCount <= 0
  ) {
    throw new RangeError("Fixed block counts must be positive integers.");
  }

  const requestedBlockCount = input.blocksPerRow * input.rowCount;
  if (!Number.isSafeInteger(requestedBlockCount) || requestedBlockCount > 10_000) {
    throw new RangeError("Fixed block grid exceeds the technical limit of 10,000 blocks.");
  }

  const usableRoof = computeUsableRoof({
    roofPolygonM: input.roofPolygonM,
    marginM: input.marginM,
  });
  const rejected = {
    "outside-usable-roof": 0,
    "reserved-zone": 0,
    "snow-guard": 0,
  };
  if (usableRoof.status !== "valid" || !usableRoof.components.length) {
    return {
      engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      usableRoof,
      candidates: [],
      validBlocks: [],
      validModules: [],
      requestedBlockCount,
      validBlockCount: 0,
      requestedModuleCount:
        requestedBlockCount * input.blockDefinition.moduleSlots.length,
      validModuleCount: 0,
      complete: false,
      rejected,
      diagnostics: [...usableRoof.diagnostics],
    };
  }

  const rotationCartesianDeg =
    geographicPlanarOrientationToCartesianRotationDeg(
      input.blockDefinition.planarOrientationDeg,
    );
  const gridOriginM = input.gridOriginM ?? { x: 0, y: 0 };
  const localRoofComponents = usableRoof.components.map((component) =>
    component.map((point) =>
      toGridLocal(point, gridOriginM, rotationCartesianDeg),
    ),
  );
  const roofBounds = combinePolygonBounds(localRoofComponents);
  const footprintBounds = polygonBounds(input.blockDefinition.blockFootprint);
  const columns = fixedAxisPositions({
    min: roofBounds.minX - footprintBounds.minX,
    max: roofBounds.maxX - footprintBounds.maxX,
    pitch: input.blockDefinition.pitchM.x,
    count: input.blocksPerRow,
    phase: input.phaseX ?? 0,
    anchor: input.anchorX ?? "center",
  });
  const rows = fixedAxisPositions({
    min: roofBounds.minY - footprintBounds.minY,
    max: roofBounds.maxY - footprintBounds.maxY,
    pitch: input.blockDefinition.pitchM.y,
    count: input.rowCount,
    phase: input.phaseY ?? 0,
    anchor: input.anchorY ?? "center",
  });

  const candidates = rows.flatMap((rowPosition, rowIndex) =>
    columns.map((columnPosition, columnIndex) => {
      const centerM = toWorld(
        { x: columnPosition, y: rowPosition },
        gridOriginM,
        rotationCartesianDeg,
      );
      const block = instantiateAdvancedBlock({
        definition: input.blockDefinition,
        centerM,
        blockIndex: rowIndex * input.blocksPerRow + columnIndex,
        columnIndex,
        rowIndex,
      });
      const validation = validatePlacementFootprint({
        footprint: block.footprint,
        usableRoof,
        reservedZones: input.reservedZones,
        snowGuards: input.snowGuards,
      });
      for (const reason of validation.reasons) rejected[reason] += 1;
      return { block, valid: validation.valid, reasons: validation.reasons };
    }),
  );
  const validBlocks = candidates
    .filter((candidate) => candidate.valid)
    .map((candidate) => candidate.block);
  const validModules = validBlocks.flatMap(expandBlockToModules);
  const requestedModuleCount =
    requestedBlockCount * input.blockDefinition.moduleSlots.length;

  return {
    engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
    usableRoof,
    candidates,
    validBlocks,
    validModules,
    requestedBlockCount,
    validBlockCount: validBlocks.length,
    requestedModuleCount,
    validModuleCount: validModules.length,
    complete: validBlocks.length === requestedBlockCount,
    rejected,
    diagnostics: [...usableRoof.diagnostics],
  };
}
