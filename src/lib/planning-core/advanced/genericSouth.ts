import type { AdvancedModuleSpecification } from "./types";
import {
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  type AdvancedBlockDefinition,
} from "./types";
import {
  createCenteredRectangleFootprint,
  deriveTiltedModuleGeometry,
  normalizeGeographicAzimuth,
} from "./moduleGeometry";

export { GENERIC_SOUTH_SYSTEM_ID } from "./types";

export function createGenericSouthBlock(input: {
  module: AdvancedModuleSpecification;
  nominalTiltDeg: number;
  faceAzimuthDeg?: number;
  moduleGapX?: number;
  moduleGapY?: number;
  blockGapX?: number;
  blockGapY?: number;
}): AdvancedBlockDefinition {
  const geometry = deriveTiltedModuleGeometry({
    module: input.module,
    nominalTiltDeg: input.nominalTiltDeg,
  });
  const moduleGapX = input.moduleGapX ?? 0;
  const moduleGapY = input.moduleGapY ?? 0;
  const blockGapX = input.blockGapX ?? 0;
  const blockGapY = input.blockGapY ?? 0;
  if (
    [moduleGapX, moduleGapY, blockGapX, blockGapY].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new RangeError("Module and block gaps must be finite non-negative metric values.");
  }
  const blockFootprint = createCenteredRectangleFootprint({
    widthM: geometry.crossSlopeM,
    depthM: geometry.projectedAlongSlopeM,
  });

  return {
    mountingSystemId: GENERIC_SOUTH_SYSTEM_ID,
    definitionVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
    planarOrientationDeg: normalizeGeographicAzimuth(
      input.faceAzimuthDeg ?? 180,
    ),
    blockFootprint,
    pitchM: {
      x: geometry.crossSlopeM + moduleGapX + blockGapX,
      y: geometry.projectedAlongSlopeM + moduleGapY + blockGapY,
    },
    moduleSlots: [
      {
        slotIndex: 0,
        localCenterM: { x: 0, y: 0 },
        localRotationCartesianDeg: 0,
        projectedFootprint: blockFootprint.map((point) => ({ ...point })),
        faceAzimuthOffsetDeg: 0,
        module: { ...input.module },
        geometry,
      },
    ],
    derivedDimensionsM: {
      crossSlopeM: geometry.crossSlopeM,
      projectedDepthM: geometry.projectedAlongSlopeM,
      riseM: geometry.riseM,
      moduleGapX,
      moduleGapY,
      blockGapX,
      blockGapY,
    },
    warnings: [],
  };
}
