import {
  createCenteredRectangleFootprint,
  deriveTiltedModuleGeometry,
  normalizeGeographicAzimuth,
  placeLocalFootprint,
} from "./moduleGeometry";
import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  type AdvancedBlockDefinition,
  type AdvancedModuleSpecification,
} from "./types";

export { GENERIC_EAST_WEST_SYSTEM_ID } from "./types";

export function createGenericEastWestBlock(input: {
  module: AdvancedModuleSpecification;
  nominalTiltDeg: number;
  primaryFaceAzimuthDeg?: number;
  interModuleGapM?: number;
  moduleGapX?: number;
  blockGapX?: number;
  blockGapY?: number;
}): AdvancedBlockDefinition {
  const geometry = deriveTiltedModuleGeometry({
    module: input.module,
    nominalTiltDeg: input.nominalTiltDeg,
  });
  const interModuleGapM = input.interModuleGapM ?? 0;
  const moduleGapX = input.moduleGapX ?? 0;
  const blockGapX = input.blockGapX ?? 0;
  const blockGapY = input.blockGapY ?? 0;
  for (const [label, value] of [
    ["Inter-module gap", interModuleGapM],
    ["Module gap X", moduleGapX],
    ["Block gap X", blockGapX],
    ["Block gap Y", blockGapY],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} must be a finite non-negative metric value.`);
    }
  }

  const projectedDepthM = geometry.projectedAlongSlopeM;
  const blockDepthM = projectedDepthM * 2 + interModuleGapM;
  const blockFootprint = createCenteredRectangleFootprint({
    widthM: geometry.crossSlopeM,
    depthM: blockDepthM,
  });
  const moduleFootprint = createCenteredRectangleFootprint({
    widthM: geometry.crossSlopeM,
    depthM: projectedDepthM,
  });
  const moduleCenterOffsetM = interModuleGapM / 2 + projectedDepthM / 2;

  return {
    mountingSystemId: GENERIC_EAST_WEST_SYSTEM_ID,
    definitionVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
    planarOrientationDeg: normalizeGeographicAzimuth(
      input.primaryFaceAzimuthDeg ?? 90,
    ),
    blockFootprint,
    pitchM: {
      x: geometry.crossSlopeM + moduleGapX + blockGapX,
      y: blockDepthM + blockGapY,
    },
    moduleSlots: [
      {
        slotIndex: 0,
        localCenterM: { x: 0, y: -moduleCenterOffsetM },
        localRotationCartesianDeg: 0,
        projectedFootprint: placeLocalFootprint({
          centeredFootprint: moduleFootprint,
          localCenterM: { x: 0, y: -moduleCenterOffsetM },
        }),
        faceAzimuthOffsetDeg: 0,
        module: { ...input.module },
        geometry: { ...geometry },
      },
      {
        slotIndex: 1,
        localCenterM: { x: 0, y: moduleCenterOffsetM },
        localRotationCartesianDeg: 180,
        projectedFootprint: placeLocalFootprint({
          centeredFootprint: moduleFootprint,
          localCenterM: { x: 0, y: moduleCenterOffsetM },
          localRotationCartesianDeg: 180,
        }),
        faceAzimuthOffsetDeg: 180,
        module: { ...input.module },
        geometry: { ...geometry },
      },
    ],
    derivedDimensionsM: {
      crossSlopeM: geometry.crossSlopeM,
      projectedModuleDepthM: projectedDepthM,
      projectedDepthM: blockDepthM,
      riseM: geometry.riseM,
      interModuleGapM,
      moduleGapX,
      blockGapX,
      blockGapY,
    },
    warnings: [],
  };
}
