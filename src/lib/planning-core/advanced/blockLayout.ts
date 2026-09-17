import {
  combinePolygonBounds,
  computeUsableRoof,
  generateGridPlacements,
  generateThermalAxisPositions,
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
    thermalBreaks: input.thermalBreaks,
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

function normalizedPhase(value: number): number {
  const phase = value % 1;
  return phase < 0 ? phase + 1 : phase;
}

function phaseDistance(a: number, b: number): number {
  const distance = Math.abs(normalizedPhase(a) - normalizedPhase(b));
  return Math.min(distance, 1 - distance);
}

function deterministicPhaseCandidates(
  current: number | undefined,
  contacts: readonly number[] = [],
): number[] {
  const values = [normalizedPhase(current ?? 0)];
  for (let index = 0; index < 8; index += 1) values.push(index / 8);
  values.push(...contacts.map(normalizedPhase));
  return values.filter((value, index) =>
    values.findIndex((candidate) => Math.abs(candidate - value) < 1e-9) === index,
  ).slice(0, 24);
}

function contactPhaseCandidates(input: ComputeAdvancedBlockLayoutInput): {
  x: number[];
  y: number[];
} {
  const usableRoof = computeUsableRoof({
    roofPolygonM: input.roofPolygonM,
    marginM: input.marginM,
  });
  if (usableRoof.status !== "valid" || !usableRoof.components.length) return { x: [], y: [] };
  const rotation = geographicPlanarOrientationToCartesianRotationDeg(
    input.blockDefinition.planarOrientationDeg,
  );
  const origin = input.gridOriginM ?? { x: 0, y: 0 };
  const localRoof = usableRoof.components.map((component) =>
    component.map((point) => toGridLocal(point, origin, rotation)),
  );
  const bounds = combinePolygonBounds(localRoof);
  const footprint = polygonBounds(input.blockDefinition.blockFootprint);
  const minOriginX = bounds.minX - footprint.minX;
  const minOriginY = bounds.minY - footprint.minY;
  const points = [
    ...localRoof.flat(),
    ...(input.reservedZones ?? []).flatMap((zone) =>
      zone.polygon.map((point) => toGridLocal(point, origin, rotation))),
    ...(input.snowGuards ?? []).flatMap((guard) => [
      toGridLocal(guard.start, origin, rotation),
      toGridLocal(guard.end, origin, rotation),
    ]),
  ];
  const x = points.flatMap((point) => [
    (point.x - footprint.minX - minOriginX) / input.blockDefinition.pitchM.x,
    (point.x - footprint.maxX - minOriginX) / input.blockDefinition.pitchM.x,
  ]);
  const y = points.flatMap((point) => [
    (point.y - footprint.minY - minOriginY) / input.blockDefinition.pitchM.y,
    (point.y - footprint.maxY - minOriginY) / input.blockDefinition.pitchM.y,
  ]);
  return { x, y };
}

function fragmentationScore(layout: AdvancedBlockLayoutResult): number {
  const byRow = new Map<number, number[]>();
  for (const block of layout.blocks) {
    const columns = byRow.get(block.rowIndex);
    if (columns) columns.push(block.columnIndex);
    else byRow.set(block.rowIndex, [block.columnIndex]);
  }
  let runs = 0;
  for (const columns of byRow.values()) {
    columns.sort((a, b) => a - b);
    for (let index = 0; index < columns.length; index += 1) {
      if (index === 0 || columns[index] !== columns[index - 1] + 1) runs += 1;
    }
  }
  return runs;
}

/** Finite, deterministic phase search for the explicit Vollbelegung action. */
export function computeMaximumAdvancedBlockLayout(
  input: ComputeAdvancedBlockLayoutInput,
): {
  layout: AdvancedBlockLayoutResult;
  phaseX: number;
  phaseY: number;
  candidatesEvaluated: number;
} {
  const contacts = contactPhaseCandidates(input);
  const phasesX = deterministicPhaseCandidates(input.phaseX, contacts.x);
  const phasesY = deterministicPhaseCandidates(input.phaseY, contacts.y);
  const requestedX = normalizedPhase(input.phaseX ?? 0);
  const requestedY = normalizedPhase(input.phaseY ?? 0);
  let best: {
    layout: AdvancedBlockLayoutResult;
    phaseX: number;
    phaseY: number;
    fragmentation: number;
    phaseDistance: number;
    order: number;
  } | null = null;
  let order = 0;

  for (const phaseY of phasesY) {
    for (const phaseX of phasesX) {
      const layout = computeAdvancedBlockLayout({ ...input, phaseX, phaseY });
      const candidate = {
        layout,
        phaseX,
        phaseY,
        fragmentation: fragmentationScore(layout),
        phaseDistance: phaseDistance(phaseX, requestedX) + phaseDistance(phaseY, requestedY),
        order: order++,
      };
      if (
        !best ||
        candidate.layout.moduleCount > best.layout.moduleCount ||
        (candidate.layout.moduleCount === best.layout.moduleCount &&
          (candidate.fragmentation < best.fragmentation ||
            (candidate.fragmentation === best.fragmentation &&
              (candidate.phaseDistance < best.phaseDistance - 1e-12 ||
                (Math.abs(candidate.phaseDistance - best.phaseDistance) <= 1e-12 &&
                  candidate.order < best.order)))))
      ) {
        best = candidate;
      }
    }
  }

  return {
    layout: best!.layout,
    phaseX: best!.phaseX,
    phaseY: best!.phaseY,
    candidatesEvaluated: order,
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
  thermalBreak?: NonNullable<ComputeAdvancedBlockLayoutInput["thermalBreaks"]>["x"];
}): number[] {
  if (input.thermalBreak) {
    return generateThermalAxisPositions({
      min: input.min,
      max: input.max,
      pitch: input.pitch,
      count: input.count,
      phase: input.phase,
      anchor: input.anchor,
      break: input.thermalBreak,
    });
  }
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
    thermalBreak: input.thermalBreaks?.x,
  });
  const rows = fixedAxisPositions({
    min: roofBounds.minY - footprintBounds.minY,
    max: roofBounds.maxY - footprintBounds.maxY,
    pitch: input.blockDefinition.pitchM.y,
    count: input.rowCount,
    phase: input.phaseY ?? 0,
    anchor: input.anchorY ?? "center",
    thermalBreak: input.thermalBreaks?.y,
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
