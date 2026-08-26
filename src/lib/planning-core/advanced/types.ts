import type {
  GeometryDiagnostic,
  GridAnchor,
  MetricPoint,
  MetricPolygon,
  PlacementInvalidReason,
  PolygonObstacle,
  SegmentObstacle,
  UsableRoofGeometry,
} from "../geometry-v2";

export const ADVANCED_BLOCK_ENGINE_VERSION = "advanced-block-v1" as const;
export const GENERIC_MOUNTING_DEFINITION_VERSION = "generic-v1" as const;

export type ModuleOrientation = "portrait" | "landscape";

export type AdvancedModuleSpecification = {
  /** Physical short side of the module. */
  widthM: number;
  /** Physical long side of the module. */
  heightM: number;
  orientation: ModuleOrientation;
};

export type TiltedModuleGeometry = {
  crossSlopeM: number;
  alongSlopeM: number;
  projectedAlongSlopeM: number;
  riseM: number;
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
};

export type AdvancedModuleSlot = {
  slotIndex: number;
  localCenterM: MetricPoint;
  /** Rotation relative to the block's metric XY axes. */
  localRotationCartesianDeg: number;
  /** Projected module polygon in block-local coordinates. */
  projectedFootprint: MetricPolygon;
  /** Geographic clockwise offset from the block planar orientation. */
  faceAzimuthOffsetDeg: number;
  module: AdvancedModuleSpecification;
  geometry: TiltedModuleGeometry;
};

export type AdvancedGeometryWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type AdvancedBlockDefinition = {
  mountingSystemId: string;
  definitionVersion: string;
  /** Geographic azimuth of the block-local +Y axis. */
  planarOrientationDeg: number;
  /** Collision/containment footprint, independent of module footprints. */
  blockFootprint: MetricPolygon;
  /** Exact grid pitch supplied by the generic definition or future adapter. */
  pitchM: { x: number; y: number };
  moduleSlots: AdvancedModuleSlot[];
  derivedDimensionsM: Record<string, number>;
  warnings: AdvancedGeometryWarning[];
};

export type PlacedAdvancedBlock = {
  engineVersion: typeof ADVANCED_BLOCK_ENGINE_VERSION;
  blockIndex: number;
  blockKey: string;
  mountingSystemId: string;
  definitionVersion: string;
  centerM: MetricPoint;
  /** Physical orientation; it is not a canvas angle. */
  planarOrientationDeg: number;
  /** Geometry-v2 Cartesian transform derived from planarOrientationDeg. */
  rotationCartesianDeg: number;
  footprint: MetricPolygon;
  moduleSlots: AdvancedModuleSlot[];
  derivedDimensionsM: Record<string, number>;
  warnings: AdvancedGeometryWarning[];
  columnIndex: number;
  rowIndex: number;
};

export type ExpandedAdvancedModule = {
  blockIndex: number;
  blockKey: string;
  slotIndex: number;
  mountingSystemId: string;
  centerM: MetricPoint;
  projectedFootprint: MetricPolygon;
  planarRotationCartesianDeg: number;
  faceAzimuthDeg: number;
  nominalTiltDeg: number;
  effectiveTiltDeg: number;
  crossSlopeM: number;
  projectedAlongSlopeM: number;
  riseM: number;
};

export type ComputeAdvancedBlockLayoutInput = {
  roofPolygonM: MetricPolygon;
  marginM: number;
  blockDefinition: AdvancedBlockDefinition;
  gridOriginM?: MetricPoint;
  phaseX?: number;
  phaseY?: number;
  anchorX?: GridAnchor;
  anchorY?: GridAnchor;
  reservedZones?: PolygonObstacle[];
  snowGuards?: SegmentObstacle[];
};

export type AdvancedBlockLayoutResult = {
  engineVersion: typeof ADVANCED_BLOCK_ENGINE_VERSION;
  usableRoof: UsableRoofGeometry;
  blocks: PlacedAdvancedBlock[];
  modules: ExpandedAdvancedModule[];
  blockCount: number;
  moduleCount: number;
  rejected: Record<PlacementInvalidReason, number>;
  diagnostics: GeometryDiagnostic[];
};

