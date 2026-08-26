import {
  createCenteredRectangleFootprint,
  deriveTiltedModuleGeometry,
  normalizeGeographicAzimuth,
  placeLocalFootprint,
} from "../moduleGeometry";
import type { AdvancedGeometryWarning } from "../types";
import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_CONSTANTS_MM,
  K2_D_DOME_NOMINAL_TILT_DEG,
  K2_D_DOME_SYSTEM_ID,
} from "./constants";
import {
  calculateK2DDomeAssemblyDimension1Mm,
  calculateK2DDomeAssemblyDimension2Mm,
  calculateK2DDomeEffectiveTiltDeg,
  calculateK2DDomeLongSideBlockSizeMm,
  calculateK2DDomeOneBlockRailDepthMm,
  calculateK2DDomeProjectedModuleDepthMm,
  calculateK2DDomeRailDirectionBlockSizeMm,
  calculateK2DDomeServiceCorridorMm,
  k2DDomeMetresToMillimetres,
  k2DDomeMillimetresToMetres,
} from "./formulas";
import type {
  K2DDomeAdapterInput,
  K2DDomeAdapterResult,
  K2DDomeBlockLimitResult,
  K2DDomeDerivedDimensions,
  K2DDomeValidationError,
} from "./types";

function inputErrors(input: K2DDomeAdapterInput): K2DDomeValidationError[] {
  const errors: K2DDomeValidationError[] = [];
  const moduleWidthMm = input.module.widthM * 1000;
  const moduleLengthMm = input.module.heightM * 1000;
  const rowSpaceMm = input.rowSpaceM * 1000;
  const widthRange = K2_D_DOME_CONSTANTS_MM.moduleWidth;
  const lengthRange = K2_D_DOME_CONSTANTS_MM.moduleLength;

  if (!Number.isFinite(moduleWidthMm) || moduleWidthMm <= 0) {
    errors.push({
      code: "invalid-module-width",
      message: "Module width must be a finite positive metric value.",
    });
  } else if (moduleWidthMm < widthRange.min) {
    errors.push({
      code: "module-width-below-range",
      message: `Module width must be at least ${widthRange.min} mm.`,
    });
  } else if (moduleWidthMm > widthRange.max) {
    errors.push({
      code: "module-width-above-range",
      message: `Module width must not exceed ${widthRange.max} mm.`,
    });
  }
  if (!Number.isFinite(moduleLengthMm) || moduleLengthMm <= 0) {
    errors.push({
      code: "invalid-module-length",
      message: "Module length must be a finite positive metric value.",
    });
  } else if (moduleLengthMm < lengthRange.min) {
    errors.push({
      code: "module-length-below-range",
      message: `Module length must be at least ${lengthRange.min} mm.`,
    });
  } else if (moduleLengthMm > lengthRange.max) {
    errors.push({
      code: "module-length-above-range",
      message: `Module length must not exceed ${lengthRange.max} mm.`,
    });
  }
  if (!Number.isFinite(rowSpaceMm) || rowSpaceMm <= 0) {
    errors.push({
      code: "invalid-row-space",
      message: "Row space must be a finite positive metric value.",
    });
  }
  if (
    input.primaryFaceAzimuthDeg !== undefined &&
    !Number.isFinite(input.primaryFaceAzimuthDeg)
  ) {
    errors.push({
      code: "invalid-face-azimuth",
      message: "Primary face azimuth must be finite.",
    });
  }
  if (input.module.orientation !== "landscape") {
    errors.push({
      code: "unsupported-orientation",
      message:
        "Drawing 07-481-08 uses the physical module width as the inclined dimension; this adapter supports landscape modules only.",
    });
  }
  return errors;
}

function standardWarnings(effectiveTiltDeg: number): AdvancedGeometryWarning[] {
  const warnings: AdvancedGeometryWarning[] = [
    {
      code: "structural-verification-not-performed",
      message:
        "Statics, wind and snow loads, ballast and fastening have not been verified.",
      severity: "warning",
    },
    {
      code: "terminal-clearance-not-in-block-formula",
      message:
        "The drawing shows 20 mm minimum terminal clearance, but the official rail-direction block-size formula does not add it; the footprint follows the formula.",
      severity: "info",
    },
  ];
  if (Math.abs(effectiveTiltDeg - K2_D_DOME_NOMINAL_TILT_DEG) > 1e-9) {
    warnings.push({
      code: "nominal-effective-tilt-differ",
      message: `Nominal tilt is 10 degrees; datasheet geometry derives ${effectiveTiltDeg.toFixed(3)} degrees.`,
      severity: "info",
    });
  }
  return warnings;
}

export function evaluateK2DDomeBlockLimits(input: {
  moduleWidthM: number;
  moduleLengthM: number;
  rowSpaceM: number;
  quantityRows: number;
  numberOfColumns: number;
}): K2DDomeBlockLimitResult {
  const railDirectionBlockSizeM = k2DDomeMillimetresToMetres(
    calculateK2DDomeRailDirectionBlockSizeMm({
      moduleWidthMm: k2DDomeMetresToMillimetres(input.moduleWidthM),
      rowSpaceMm: k2DDomeMetresToMillimetres(input.rowSpaceM),
      quantityRows: input.quantityRows,
    }),
  );
  const longSideBlockSizeM = k2DDomeMillimetresToMetres(
    calculateK2DDomeLongSideBlockSizeMm({
      moduleLengthMm: k2DDomeMetresToMillimetres(input.moduleLengthM),
      numberOfColumns: input.numberOfColumns,
    }),
  );
  const maxRailDirectionM = k2DDomeMillimetresToMetres(
    K2_D_DOME_CONSTANTS_MM.maxBlockRailDirection,
  );
  const maxLongSideM = k2DDomeMillimetresToMetres(
    K2_D_DOME_CONSTANTS_MM.maxBlockLongSide,
  );
  const warnings: AdvancedGeometryWarning[] = [];
  if (railDirectionBlockSizeM > maxRailDirectionM) {
    warnings.push({
      code: "rail-direction-block-limit-exceeded",
      message: `Rail-direction block size ${railDirectionBlockSizeM.toFixed(3)} m exceeds the 12 m datasheet limit.`,
      severity: "warning",
    });
  }
  if (longSideBlockSizeM > maxLongSideM) {
    warnings.push({
      code: "long-side-block-limit-exceeded",
      message: `Long-side block size ${longSideBlockSizeM.toFixed(3)} m exceeds the 16 m datasheet limit.`,
      severity: "warning",
    });
  }
  return {
    quantityRows: input.quantityRows,
    numberOfColumns: input.numberOfColumns,
    railDirectionBlockSizeM,
    longSideBlockSizeM,
    maxRailDirectionM,
    maxLongSideM,
    warnings,
  };
}

export function createK2DDomeBlock(
  input: K2DDomeAdapterInput,
): K2DDomeAdapterResult {
  const errors = inputErrors(input);
  if (errors.length) {
    return {
      valid: false,
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      definition: null,
      derivedDimensions: null,
      warnings: [],
      errors,
    };
  }

  const moduleWidthMm = k2DDomeMetresToMillimetres(input.module.widthM);
  const moduleLengthMm = k2DDomeMetresToMillimetres(input.module.heightM);
  const rowSpaceMm = k2DDomeMetresToMillimetres(input.rowSpaceM);
  const effectiveTiltDeg = calculateK2DDomeEffectiveTiltDeg(moduleWidthMm);
  const projectedModuleDepthMm =
    calculateK2DDomeProjectedModuleDepthMm(moduleWidthMm);
  const assemblyDimension1Mm =
    calculateK2DDomeAssemblyDimension1Mm(moduleWidthMm);
  const assemblyDimension2Mm = calculateK2DDomeAssemblyDimension2Mm({
    moduleWidthMm,
    rowSpaceMm,
  });
  const serviceCorridorMm = calculateK2DDomeServiceCorridorMm({
    moduleWidthMm,
    rowSpaceMm,
  });
  const oneBlockRailDepthMm =
    calculateK2DDomeOneBlockRailDepthMm(moduleWidthMm);
  const corridorRange = K2_D_DOME_CONSTANTS_MM.approximateServiceCorridor;
  if (serviceCorridorMm < corridorRange.min) {
    errors.push({
      code: "service-corridor-below-range",
      message: `Derived service corridor must be at least approximately ${corridorRange.min} mm.`,
    });
  }
  if (serviceCorridorMm > corridorRange.max) {
    errors.push({
      code: "service-corridor-above-range",
      message: `Derived service corridor must not exceed approximately ${corridorRange.max} mm.`,
    });
  }
  if (
    assemblyDimension1Mm <= 0 ||
    assemblyDimension2Mm <= 0 ||
    serviceCorridorMm < 0 ||
    oneBlockRailDepthMm <= 0
  ) {
    errors.push({
      code: "derived-geometry-impossible",
      message:
        "The selected dimensions produce a non-positive assembly, corridor or block footprint.",
    });
  }
  if (errors.length) {
    return {
      valid: false,
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      definition: null,
      derivedDimensions: null,
      warnings: [],
      errors,
    };
  }

  const moduleGeometry = deriveTiltedModuleGeometry({
    module: input.module,
    nominalTiltDeg: K2_D_DOME_NOMINAL_TILT_DEG,
    effectiveTiltDeg,
  });
  const constants = K2_D_DOME_CONSTANTS_MM;
  const blockCrossSlopeMm = calculateK2DDomeLongSideBlockSizeMm({
    moduleLengthMm,
    numberOfColumns: 1,
  });
  const blockFootprint = createCenteredRectangleFootprint({
    widthM: k2DDomeMillimetresToMetres(blockCrossSlopeMm),
    depthM: k2DDomeMillimetresToMetres(oneBlockRailDepthMm),
  });
  const centeredModuleFootprint = createCenteredRectangleFootprint({
    widthM: input.module.heightM,
    depthM: moduleGeometry.projectedAlongSlopeM,
  });
  const moduleCenterOffsetM = k2DDomeMillimetresToMetres(
    constants.centralSystemDimension / 2 + projectedModuleDepthMm / 2,
  );
  const warnings = standardWarnings(effectiveTiltDeg);
  const pitchXM = k2DDomeMillimetresToMetres(
    moduleLengthMm + constants.moduleLongSideSpacing,
  );
  const derivedDimensions: K2DDomeDerivedDimensions = {
    moduleWidthM: input.module.widthM,
    moduleLengthM: input.module.heightM,
    rowSpaceM: input.rowSpaceM,
    nominalTiltDeg: K2_D_DOME_NOMINAL_TILT_DEG,
    effectiveTiltDeg,
    projectedModuleDepthM: moduleGeometry.projectedAlongSlopeM,
    moduleRiseM: moduleGeometry.riseM,
    supportRiseM: k2DDomeMillimetresToMetres(constants.supportRise),
    assemblyDimension1M: k2DDomeMillimetresToMetres(assemblyDimension1Mm),
    assemblyDimension2M: k2DDomeMillimetresToMetres(assemblyDimension2Mm),
    serviceCorridorM: k2DDomeMillimetresToMetres(serviceCorridorMm),
    centralSystemDimensionM: k2DDomeMillimetresToMetres(
      constants.centralSystemDimension,
    ),
    oneBlockRailDepthM: k2DDomeMillimetresToMetres(oneBlockRailDepthMm),
    moduleLongSideSpacingM: k2DDomeMillimetresToMetres(
      constants.moduleLongSideSpacing,
    ),
    longSideTerminalExtensionM: k2DDomeMillimetresToMetres(
      constants.longSideTerminalExtension,
    ),
    pitchXM,
    pitchYM: input.rowSpaceM,
    blockFootprintCrossSlopeM:
      k2DDomeMillimetresToMetres(blockCrossSlopeMm),
  };

  return {
    valid: true,
    systemId: K2_D_DOME_SYSTEM_ID,
    adapterVersion: K2_D_DOME_ADAPTER_VERSION,
    definition: {
      mountingSystemId: K2_D_DOME_SYSTEM_ID,
      definitionVersion: K2_D_DOME_ADAPTER_VERSION,
      planarOrientationDeg: normalizeGeographicAzimuth(
        input.primaryFaceAzimuthDeg ?? 90,
      ),
      blockFootprint,
      pitchM: { x: pitchXM, y: input.rowSpaceM },
      moduleSlots: [
        {
          slotIndex: 0,
          localCenterM: { x: 0, y: moduleCenterOffsetM },
          localRotationCartesianDeg: 0,
          projectedFootprint: placeLocalFootprint({
            centeredFootprint: centeredModuleFootprint,
            localCenterM: { x: 0, y: moduleCenterOffsetM },
          }),
          faceAzimuthOffsetDeg: 0,
          module: { ...input.module },
          geometry: { ...moduleGeometry },
        },
        {
          slotIndex: 1,
          localCenterM: { x: 0, y: -moduleCenterOffsetM },
          localRotationCartesianDeg: 180,
          projectedFootprint: placeLocalFootprint({
            centeredFootprint: centeredModuleFootprint,
            localCenterM: { x: 0, y: -moduleCenterOffsetM },
            localRotationCartesianDeg: 180,
          }),
          faceAzimuthOffsetDeg: 180,
          module: { ...input.module },
          geometry: { ...moduleGeometry },
        },
      ],
      derivedDimensionsM: {
        moduleWidthM: derivedDimensions.moduleWidthM,
        moduleLengthM: derivedDimensions.moduleLengthM,
        rowSpaceM: derivedDimensions.rowSpaceM,
        projectedModuleDepthM: derivedDimensions.projectedModuleDepthM,
        moduleRiseM: derivedDimensions.moduleRiseM,
        supportRiseM: derivedDimensions.supportRiseM,
        assemblyDimension1M: derivedDimensions.assemblyDimension1M,
        assemblyDimension2M: derivedDimensions.assemblyDimension2M,
        serviceCorridorM: derivedDimensions.serviceCorridorM,
        centralSystemDimensionM:
          derivedDimensions.centralSystemDimensionM,
        oneBlockRailDepthM: derivedDimensions.oneBlockRailDepthM,
        moduleLongSideSpacingM:
          derivedDimensions.moduleLongSideSpacingM,
        longSideTerminalExtensionM:
          derivedDimensions.longSideTerminalExtensionM,
        pitchXM: derivedDimensions.pitchXM,
        pitchYM: derivedDimensions.pitchYM,
        blockFootprintCrossSlopeM:
          derivedDimensions.blockFootprintCrossSlopeM,
      },
      warnings: warnings.map((warning) => ({ ...warning })),
    },
    derivedDimensions,
    warnings,
    errors: [],
  };
}

