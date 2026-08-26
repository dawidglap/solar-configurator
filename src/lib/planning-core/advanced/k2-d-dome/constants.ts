export const K2_D_DOME_SYSTEM_ID = "k2-d-dome-6.10-classic" as const;
export const K2_D_DOME_ADAPTER_VERSION = "07-481-08@2023-05-05" as const;

/** All constants below are millimetres from K2 drawing 07-481-08. */
export const K2_D_DOME_CONSTANTS_MM = {
  moduleLength: { min: 1448, max: 2390 },
  moduleWidth: { min: 950, max: 1170 },
  approximateServiceCorridor: { min: 140, max: 450 },
  supportRise: 164.5,
  effectiveSpanReduction: 40,
  assemblyReferenceLow: 23.5,
  assemblyReferenceBase: 55.7,
  assemblyReferenceHigh: 3.6,
  centralSystemDimension: 78,
  moduleLongSideSpacing: 18,
  longSideTerminalExtension: 47,
  visibleMinimumTerminalClearance: 20,
  maxBlockRailDirection: 12_000,
  maxBlockLongSide: 16_000,
} as const;

export const K2_D_DOME_NOMINAL_TILT_DEG = 10;

