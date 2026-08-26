export const K2_S_DOME_SYSTEM_ID = "k2-s-dome-6.10-classic" as const;
export const K2_S_DOME_ADAPTER_VERSION = "07-482-05@2023-05-05" as const;

/** All constants below are millimetres from K2 drawing 07-482-05. */
export const K2_S_DOME_CONSTANTS_MM = {
  moduleLength: { min: 1448, max: 2390 },
  moduleWidth: { min: 950, max: 1170 },
  rowSpace: { min: 1150, max: 2000 },
  supportRise: 164.5,
  effectiveSpanReduction: 40,
  highSideTerminalExtension: 38.7,
  assemblyReferenceLow: 23.5,
  assemblyReferenceBase: 55.7,
  assemblyReferenceHigh: 3.6,
  moduleLongSideSpacing: 18,
  longSideTerminalExtension: 47,
  lowSideMinimumTerminalExtension: 20,
} as const;

export const K2_S_DOME_NOMINAL_TILT_DEG = 10;

