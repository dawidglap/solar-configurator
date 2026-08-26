import type {
  AdvancedBlockDefinition,
  AdvancedGeometryWarning,
  AdvancedModuleSpecification,
} from "../types";

export type K2SDomeValidationErrorCode =
  | "unsupported-orientation"
  | "module-width-below-range"
  | "module-width-above-range"
  | "module-length-below-range"
  | "module-length-above-range"
  | "row-space-below-range"
  | "row-space-above-range"
  | "derived-geometry-impossible";

export type K2SDomeValidationError = {
  code: K2SDomeValidationErrorCode;
  message: string;
};

export type K2SDomeAdapterInput = {
  module: AdvancedModuleSpecification;
  rowSpaceM: number;
  faceAzimuthDeg?: number;
};

export type K2SDomeDerivedDimensions = {
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
  moduleLongSideSpacingM: number;
  longSideTerminalExtensionM: number;
  lowSideMinimumTerminalExtensionM: number;
  highSideTerminalExtensionM: number;
  blockFootprintCrossSlopeM: number;
  blockFootprintRailDirectionM: number;
};

export type K2SDomeAdapterResult =
  | {
      valid: true;
      systemId: "k2-s-dome-6.10-classic";
      adapterVersion: "07-482-05@2023-05-05";
      definition: AdvancedBlockDefinition;
      derivedDimensions: K2SDomeDerivedDimensions;
      warnings: AdvancedGeometryWarning[];
      errors: [];
    }
  | {
      valid: false;
      systemId: "k2-s-dome-6.10-classic";
      adapterVersion: "07-482-05@2023-05-05";
      definition: null;
      derivedDimensions: null;
      warnings: AdvancedGeometryWarning[];
      errors: K2SDomeValidationError[];
    };

