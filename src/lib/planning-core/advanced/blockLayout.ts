import {
  computeUsableRoof,
  generateGridPlacements,
  normalizeDegrees,
  rotateMetricPoint,
  transformMetricPolygon,
} from "../geometry-v2";
import { geographicPlanarOrientationToCartesianRotationDeg } from "./moduleGeometry";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  type AdvancedBlockDefinition,
  type AdvancedBlockLayoutResult,
  type ComputeAdvancedBlockLayoutInput,
  type ExpandedAdvancedModule,
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
