import type { AdvancedModuleSpecification } from "./types";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  GENERIC_MOUNTING_DEFINITION_VERSION,
  type AdvancedBlockDefinition,
} from "./types";
import {
  createCenteredRectangleFootprint,
  deriveTiltedModuleGeometry,
  normalizeGeographicAzimuth,
} from "./moduleGeometry";

export const GENERIC_SOUTH_SYSTEM_ID = "generic-south" as const;

export function createGenericSouthBlock(input: {
  module: AdvancedModuleSpecification;
  nominalTiltDeg: number;
  faceAzimuthDeg?: number;
  blockGapX?: number;
  blockGapY?: number;
}): AdvancedBlockDefinition {
  const geometry = deriveTiltedModuleGeometry({
    module: input.module,
    nominalTiltDeg: input.nominalTiltDeg,
  });
  const gapX = input.blockGapX ?? 0;
  const gapY = input.blockGapY ?? 0;
  if (!Number.isFinite(gapX) || gapX < 0 || !Number.isFinite(gapY) || gapY < 0) {
    throw new RangeError("Block gaps must be finite non-negative metric values.");
  }
  const blockFootprint = createCenteredRectangleFootprint({
    widthM: geometry.crossSlopeM,
    depthM: geometry.projectedAlongSlopeM,
  });

  return {
    mountingSystemId: GENERIC_SOUTH_SYSTEM_ID,
    definitionVersion: `${ADVANCED_BLOCK_ENGINE_VERSION}/${GENERIC_MOUNTING_DEFINITION_VERSION}`,
    planarOrientationDeg: normalizeGeographicAzimuth(
      input.faceAzimuthDeg ?? 180,
    ),
    blockFootprint,
    pitchM: {
      x: geometry.crossSlopeM + gapX,
      y: geometry.projectedAlongSlopeM + gapY,
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
      blockGapX: gapX,
      blockGapY: gapY,
    },
    warnings: [],
  };
}

