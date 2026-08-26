import {
  createCenteredRectangleFootprint,
  deriveTiltedModuleGeometry,
  normalizeGeographicAzimuth,
  placeLocalFootprint,
} from "../moduleGeometry";
import type { AdvancedGeometryWarning } from "../types";
import {
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_CONSTANTS_MM,
  K2_S_DOME_NOMINAL_TILT_DEG,
  K2_S_DOME_SYSTEM_ID,
} from "./constants";
import {
  calculateK2SDomeAssemblyDimension1Mm,
  calculateK2SDomeAssemblyDimension2Mm,
  calculateK2SDomeEffectiveTiltDeg,
  calculateK2SDomeLongSideBlockSizeMm,
  calculateK2SDomeRailDirectionBlockSizeMm,
  calculateK2SDomeServiceCorridorMm,
  metresToMillimetres,
  millimetresToMetres,
} from "./formulas";
import type {
  K2SDomeAdapterInput,
  K2SDomeAdapterResult,
  K2SDomeDerivedDimensions,
  K2SDomeValidationError,
} from "./types";

function rangeErrors(input: K2SDomeAdapterInput): K2SDomeValidationError[] {
  const widthM = K2_S_DOME_CONSTANTS_MM.moduleWidth;
  const lengthM = K2_S_DOME_CONSTANTS_MM.moduleLength;
  const rowSpaceM = K2_S_DOME_CONSTANTS_MM.rowSpace;
  const moduleWidthMm = metresToMillimetres(input.module.widthM);
  const moduleLengthMm = metresToMillimetres(input.module.heightM);
  const rowSpaceMm = metresToMillimetres(input.rowSpaceM);
  const errors: K2SDomeValidationError[] = [];

  if (input.module.orientation !== "landscape") {
    errors.push({
      code: "unsupported-orientation",
      message:
        "Drawing 07-482-05 shows the physical module width as the inclined system dimension; this adapter supports landscape modules only.",
    });
  }
  if (moduleWidthMm < widthM.min) {
    errors.push({
      code: "module-width-below-range",
      message: `Module width must be at least ${widthM.min} mm.`,
    });
  }
  if (moduleWidthMm > widthM.max) {
    errors.push({
      code: "module-width-above-range",
      message: `Module width must not exceed ${widthM.max} mm.`,
    });
  }
  if (moduleLengthMm < lengthM.min) {
    errors.push({
      code: "module-length-below-range",
      message: `Module length must be at least ${lengthM.min} mm.`,
    });
  }
  if (moduleLengthMm > lengthM.max) {
    errors.push({
      code: "module-length-above-range",
      message: `Module length must not exceed ${lengthM.max} mm.`,
    });
  }
  if (rowSpaceMm < rowSpaceM.min) {
    errors.push({
      code: "row-space-below-range",
      message: `Row space must be at least ${rowSpaceM.min} mm.`,
    });
  }
  if (rowSpaceMm > rowSpaceM.max) {
    errors.push({
      code: "row-space-above-range",
      message: `Row space must not exceed ${rowSpaceM.max} mm.`,
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
      code: "minimum-datasheet-system-envelope",
      message:
        "The collision footprint uses the datasheet's minimum 20 mm rail-end clearance; optional hardware extensions are not modelled.",
      severity: "info",
    },
  ];
  if (Math.abs(effectiveTiltDeg - K2_S_DOME_NOMINAL_TILT_DEG) > 1e-9) {
    warnings.push({
      code: "nominal-effective-tilt-differ",
      message: `Nominal tilt is 10 degrees; datasheet geometry derives ${effectiveTiltDeg.toFixed(3)} degrees.`,
      severity: "info",
    });
  }
  return warnings;
}

export function createK2SDomeBlock(
  input: K2SDomeAdapterInput,
): K2SDomeAdapterResult {
  const errors = rangeErrors(input);
  if (errors.length) {
    return {
      valid: false,
      systemId: K2_S_DOME_SYSTEM_ID,
      adapterVersion: K2_S_DOME_ADAPTER_VERSION,
      definition: null,
      derivedDimensions: null,
      warnings: [],
      errors,
    };
  }

  const moduleWidthMm = metresToMillimetres(input.module.widthM);
  const moduleLengthMm = metresToMillimetres(input.module.heightM);
  const rowSpaceMm = metresToMillimetres(input.rowSpaceM);
  const effectiveTiltDeg = calculateK2SDomeEffectiveTiltDeg(moduleWidthMm);
  const assemblyDimension1Mm =
    calculateK2SDomeAssemblyDimension1Mm(moduleWidthMm);
  const assemblyDimension2Mm = calculateK2SDomeAssemblyDimension2Mm({
    moduleWidthMm,
    rowSpaceMm,
  });
  const serviceCorridorMm = calculateK2SDomeServiceCorridorMm({
    moduleWidthMm,
    rowSpaceMm,
  });
  if (assemblyDimension1Mm <= 0 || assemblyDimension2Mm <= 0 || serviceCorridorMm < 0) {
    return {
      valid: false,
      systemId: K2_S_DOME_SYSTEM_ID,
      adapterVersion: K2_S_DOME_ADAPTER_VERSION,
      definition: null,
      derivedDimensions: null,
      warnings: [],
      errors: [
        {
          code: "derived-geometry-impossible",
          message:
            "The selected valid-range dimensions produce a non-positive assembly dimension or service corridor.",
        },
      ],
    };
  }

  const moduleGeometry = deriveTiltedModuleGeometry({
    module: input.module,
    nominalTiltDeg: K2_S_DOME_NOMINAL_TILT_DEG,
    effectiveTiltDeg,
  });
  const constants = K2_S_DOME_CONSTANTS_MM;
  const blockCrossSlopeMm = calculateK2SDomeLongSideBlockSizeMm({
    moduleLengthMm,
    numberOfColumns: 1,
  });
  const blockRailDirectionMm = calculateK2SDomeRailDirectionBlockSizeMm({
    moduleWidthMm,
    rowSpaceMm,
    quantityRows: 1,
  });
  const blockFootprint = createCenteredRectangleFootprint({
    widthM: millimetresToMetres(blockCrossSlopeMm),
    depthM: millimetresToMetres(blockRailDirectionMm),
  });
  const centeredModuleFootprint = createCenteredRectangleFootprint({
    widthM: input.module.heightM,
    depthM: moduleGeometry.projectedAlongSlopeM,
  });
  const moduleLocalCenterY = millimetresToMetres(
    (constants.lowSideMinimumTerminalExtension -
      constants.highSideTerminalExtension) /
      2,
  );
  const projectedModuleFootprint = placeLocalFootprint({
    centeredFootprint: centeredModuleFootprint,
    localCenterM: { x: 0, y: moduleLocalCenterY },
  });
  const warnings = standardWarnings(effectiveTiltDeg);
  const derivedDimensions: K2SDomeDerivedDimensions = {
    moduleWidthM: input.module.widthM,
    moduleLengthM: input.module.heightM,
    rowSpaceM: input.rowSpaceM,
    nominalTiltDeg: K2_S_DOME_NOMINAL_TILT_DEG,
    effectiveTiltDeg,
    projectedModuleDepthM: moduleGeometry.projectedAlongSlopeM,
    moduleRiseM: moduleGeometry.riseM,
    supportRiseM: millimetresToMetres(constants.supportRise),
    assemblyDimension1M: millimetresToMetres(assemblyDimension1Mm),
    assemblyDimension2M: millimetresToMetres(assemblyDimension2Mm),
    serviceCorridorM: millimetresToMetres(serviceCorridorMm),
    moduleLongSideSpacingM: millimetresToMetres(
      constants.moduleLongSideSpacing,
    ),
    longSideTerminalExtensionM: millimetresToMetres(
      constants.longSideTerminalExtension,
    ),
    lowSideMinimumTerminalExtensionM: millimetresToMetres(
      constants.lowSideMinimumTerminalExtension,
    ),
    highSideTerminalExtensionM: millimetresToMetres(
      constants.highSideTerminalExtension,
    ),
    blockFootprintCrossSlopeM: millimetresToMetres(blockCrossSlopeMm),
    blockFootprintRailDirectionM: millimetresToMetres(
      blockRailDirectionMm,
    ),
  };

  return {
    valid: true,
    systemId: K2_S_DOME_SYSTEM_ID,
    adapterVersion: K2_S_DOME_ADAPTER_VERSION,
    definition: {
      mountingSystemId: K2_S_DOME_SYSTEM_ID,
      definitionVersion: K2_S_DOME_ADAPTER_VERSION,
      planarOrientationDeg: normalizeGeographicAzimuth(
        input.faceAzimuthDeg ?? 180,
      ),
      blockFootprint,
      pitchM: {
        x: millimetresToMetres(
          moduleLengthMm + constants.moduleLongSideSpacing,
        ),
        y: input.rowSpaceM,
      },
      moduleSlots: [
        {
          slotIndex: 0,
          localCenterM: { x: 0, y: moduleLocalCenterY },
          localRotationCartesianDeg: 0,
          projectedFootprint: projectedModuleFootprint,
          faceAzimuthOffsetDeg: 0,
          module: { ...input.module },
          geometry: moduleGeometry,
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
        moduleLongSideSpacingM: derivedDimensions.moduleLongSideSpacingM,
        longSideTerminalExtensionM:
          derivedDimensions.longSideTerminalExtensionM,
        lowSideMinimumTerminalExtensionM:
          derivedDimensions.lowSideMinimumTerminalExtensionM,
        highSideTerminalExtensionM:
          derivedDimensions.highSideTerminalExtensionM,
        blockFootprintCrossSlopeM:
          derivedDimensions.blockFootprintCrossSlopeM,
        blockFootprintRailDirectionM:
          derivedDimensions.blockFootprintRailDirectionM,
      },
      warnings: warnings.map((warning) => ({ ...warning })),
    },
    derivedDimensions,
    warnings,
    errors: [],
  };
}
