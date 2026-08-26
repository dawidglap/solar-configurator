import type {
  AdvancedBlockDefinition,
  AdvancedGeometryWarning,
  AdvancedModuleSpecification,
} from "../types";

export type K2DDomeValidationErrorCode =
  | "invalid-module-width"
  | "invalid-module-length"
  | "invalid-row-space"
  | "invalid-face-azimuth"
  | "unsupported-orientation"
  | "module-width-below-range"
  | "module-width-above-range"
  | "module-length-below-range"
  | "module-length-above-range"
  | "service-corridor-below-range"
  | "service-corridor-above-range"
  | "derived-geometry-impossible";

export type K2DDomeValidationError = {
  code: K2DDomeValidationErrorCode;
  message: string;
};

export type K2DDomeAdapterInput = {
  module: AdvancedModuleSpecification;
  rowSpaceM: number;
  primaryFaceAzimuthDeg?: number;
};

export type K2DDomeDerivedDimensions = {
  moduleWidthM: number;
  moduleLengthM: number;
  rowSpaceM: number;
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  projectedModuleDepthM: number;
  moduleRiseM: number;
  supportRiseM: number;
  assemblyDimension1M: number;
  assemblyDimension2M: number;
  serviceCorridorM: number;
  centralSystemDimensionM: number;
  oneBlockRailDepthM: number;
  moduleLongSideSpacingM: number;
  longSideTerminalExtensionM: number;
  pitchXM: number;
  pitchYM: number;
  blockFootprintCrossSlopeM: number;
};

export type K2DDomeAdapterResult =
  | {
      valid: true;
      systemId: "k2-d-dome-6.10-classic";
      adapterVersion: "07-481-08@2023-05-05";
      definition: AdvancedBlockDefinition;
      derivedDimensions: K2DDomeDerivedDimensions;
      warnings: AdvancedGeometryWarning[];
      errors: [];
    }
  | {
      valid: false;
      systemId: "k2-d-dome-6.10-classic";
      adapterVersion: "07-481-08@2023-05-05";
      definition: null;
      derivedDimensions: null;
      warnings: AdvancedGeometryWarning[];
      errors: K2DDomeValidationError[];
    };

export type K2DDomeBlockLimitResult = {
  quantityRows: number;
  numberOfColumns: number;
  railDirectionBlockSizeM: number;
  longSideBlockSizeM: number;
  maxRailDirectionM: number;
  maxLongSideM: number;
  warnings: AdvancedGeometryWarning[];
};

