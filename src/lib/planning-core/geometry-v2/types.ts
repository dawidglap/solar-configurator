export const GEOMETRY_V2_ENGINE_VERSION = "geometry-v2" as const;
export const GEOMETRY_EPSILON_M = 1e-6;
export const GEOMETRY_AREA_EPSILON_M2 = 1e-10;

export type MetricPoint = { x: number; y: number };
export type MetricPolygon = MetricPoint[];
export type GridAnchor = "start" | "center" | "end";

export type GeometryDiagnosticCode =
  | "invalid-polygon"
  | "invalid-margin"
  | "margin-consumed-roof"
  | "offset-failed"
  | "invalid-grid"
  | "empty-usable-roof";

export type GeometryDiagnostic = {
  code: GeometryDiagnosticCode;
  message: string;
};

export type UsableRoofGeometry = {
  engineVersion: typeof GEOMETRY_V2_ENGINE_VERSION;
  status: "valid" | "empty" | "invalid";
  components: MetricPolygon[];
  marginM: number;
  diagnostics: GeometryDiagnostic[];
};

export type PlacementUnitGeometry = {
  /** Polygon relative to the placement origin, in metric Cartesian coordinates. */
  footprint: MetricPolygon;
  /** Independent lattice pitch. It is not assumed to equal footprint bounds. */
  pitchM: { x: number; y: number };
};

export type PolygonObstacle = {
  id?: string;
  polygon: MetricPolygon;
};

export type SegmentObstacle = {
  id?: string;
  start: MetricPoint;
  end: MetricPoint;
  /** Explicit clearance around the segment; zero preserves line-contact semantics. */
  clearanceM: number;
};

export type PlacementInvalidReason =
  | "outside-usable-roof"
  | "reserved-zone"
  | "snow-guard";

export type PlacementValidationResult = {
  valid: boolean;
  reasons: PlacementInvalidReason[];
};

export type GridPlacement = {
  originM: MetricPoint;
  footprint: MetricPolygon;
  rotationCartesianDeg: number;
  columnIndex: number;
  rowIndex: number;
};

export type GenerateGridPlacementsInput = {
  usableRoof: UsableRoofGeometry;
  unit: PlacementUnitGeometry;
  rotationCartesianDeg?: number;
  gridOriginM?: MetricPoint;
  phaseX?: number;
  phaseY?: number;
  anchorX?: GridAnchor;
  anchorY?: GridAnchor;
  reservedZones?: PolygonObstacle[];
  snowGuards?: SegmentObstacle[];
};

export type GenerateGridPlacementsResult = {
  engineVersion: typeof GEOMETRY_V2_ENGINE_VERSION;
  placements: GridPlacement[];
  count: number;
  rejected: Record<PlacementInvalidReason, number>;
  diagnostics: GeometryDiagnostic[];
};
