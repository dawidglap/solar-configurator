export type LegacyPoint = { x: number; y: number };

export type LegacyPanelOrientation = "portrait" | "landscape";
export type LegacyGridAnchor = "start" | "center" | "end";

export type LegacyStandardCandidate = {
  cx: number;
  cy: number;
  wPx: number;
  hPx: number;
  angleDeg: number;
};

export type LegacyReservedZone = {
  points: LegacyPoint[];
};

export type LegacySnowGuard = {
  p1: LegacyPoint;
  p2: LegacyPoint;
};

export type LegacyStandardFilterPolicy = {
  reservedZones: boolean;
  snowGuards: boolean;
};

export type LegacyStandardGenerationInput = {
  roofPolygon: LegacyPoint[];
  mppImage: number;
  canvasAngleDeg?: number;
  orientation: LegacyPanelOrientation;
  panelSizeM: {
    widthM: number;
    heightM: number;
  };
  spacingM: number;
  marginM: number;
  phaseX?: number;
  phaseY?: number;
  anchorX?: LegacyGridAnchor;
  anchorY?: LegacyGridAnchor;
  coverageRatio?: number;
};

export type LegacyStandardLayoutInput = {
  generation: LegacyStandardGenerationInput;
  reservedZones: LegacyReservedZone[];
  snowGuards: LegacySnowGuard[];
  filterPolicy: LegacyStandardFilterPolicy;
};

export type LegacyStandardLayoutResult = {
  engineVersion: "legacy-v1";
  candidates: LegacyStandardCandidate[];
  placements: LegacyStandardCandidate[];
  count: number;
  rejected: {
    reservedZone: number;
    snowGuard: number;
  };
};
