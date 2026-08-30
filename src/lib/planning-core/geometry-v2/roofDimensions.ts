import { isSimpleMetricPolygon, polygonArea } from "./polygon";
import type { MetricPoint } from "./types";

export const MIN_EDITABLE_ROOF_DIMENSION_M = 0.1;
export const MAX_EDITABLE_ROOF_DIMENSION_M = 500;

export type RectangularRoofDimensions = {
  centerPx: MetricPoint;
  lengthM: number;
  widthM: number;
  lengthAxis: MetricPoint;
  widthAxis: MetricPoint;
  lengthEdgeIndex: number;
  widthEdgeIndex: number;
  canvasAngleDeg: number;
};

export type RectangularRoofAnalysis =
  | { supported: true; dimensions: RectangularRoofDimensions }
  | { supported: false; reason: "invalid-scale" | "not-four-points" | "not-rectangle" };

function vector(a: MetricPoint, b: MetricPoint): MetricPoint {
  return { x: b.x - a.x, y: b.y - a.y };
}

function magnitude(value: MetricPoint): number {
  return Math.hypot(value.x, value.y);
}

function unit(value: MetricPoint): MetricPoint {
  const length = magnitude(value);
  return { x: value.x / length, y: value.y / length };
}

function dot(a: MetricPoint, b: MetricPoint): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: MetricPoint, b: MetricPoint): number {
  return a.x * b.y - a.y * b.x;
}

function relativeDifference(first: number, second: number): number {
  return Math.abs(first - second) / Math.max(first, second, 1e-12);
}

export function analyzeRectangularRoof(
  pointsPx: readonly MetricPoint[],
  mppImage: number,
): RectangularRoofAnalysis {
  if (!(mppImage > 0) || !Number.isFinite(mppImage)) {
    return { supported: false, reason: "invalid-scale" };
  }
  if (pointsPx.length !== 4) {
    return { supported: false, reason: "not-four-points" };
  }
  const edges = pointsPx.map((point, index) =>
    vector(point, pointsPx[(index + 1) % pointsPx.length]),
  );
  const lengths = edges.map(magnitude);
  if (lengths.some((length) => !Number.isFinite(length) || length <= 1e-6)) {
    return { supported: false, reason: "not-rectangle" };
  }

  const perpendicularTolerance = Math.sin((0.75 * Math.PI) / 180);
  const parallelTolerance = perpendicularTolerance;
  const adjacentPerpendicular = Math.abs(dot(unit(edges[0]), unit(edges[1]))) <= perpendicularTolerance;
  const oppositeParallel =
    Math.abs(cross(unit(edges[0]), unit(edges[2]))) <= parallelTolerance &&
    Math.abs(cross(unit(edges[1]), unit(edges[3]))) <= parallelTolerance;
  const oppositeEqual =
    relativeDifference(lengths[0], lengths[2]) <= 0.01 &&
    relativeDifference(lengths[1], lengths[3]) <= 0.01;
  const diagonalMidpointDistance = Math.hypot(
    (pointsPx[0].x + pointsPx[2].x - pointsPx[1].x - pointsPx[3].x) / 2,
    (pointsPx[0].y + pointsPx[2].y - pointsPx[1].y - pointsPx[3].y) / 2,
  );
  const midpointTolerance = Math.max(...lengths) * 0.01;
  if (
    !adjacentPerpendicular ||
    !oppositeParallel ||
    !oppositeEqual ||
    diagonalMidpointDistance > midpointTolerance
  ) {
    return { supported: false, reason: "not-rectangle" };
  }

  const lengthEdgeIndex = lengths[0] >= lengths[1] ? 0 : 1;
  const widthEdgeIndex = lengthEdgeIndex === 0 ? 1 : 0;
  const lengthAxis = unit(edges[lengthEdgeIndex]);
  const widthAxis = unit(edges[widthEdgeIndex]);
  const centerPx = pointsPx.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const rawCanvasAngleDeg = (Math.atan2(lengthAxis.y, lengthAxis.x) * 180) / Math.PI;
  const canvasAngleDeg = ((rawCanvasAngleDeg % 180) + 180) % 180;
  return {
    supported: true,
    dimensions: {
      centerPx,
      lengthM: lengths[lengthEdgeIndex] * mppImage,
      widthM: lengths[widthEdgeIndex] * mppImage,
      lengthAxis,
      widthAxis,
      lengthEdgeIndex,
      widthEdgeIndex,
      canvasAngleDeg,
    },
  };
}

export type ResizeRectangularRoofResult =
  | { valid: true; points: MetricPoint[]; dimensions: RectangularRoofDimensions }
  | { valid: false; reason: "unsupported-shape" | "invalid-length" | "invalid-width" };

function validDimension(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_EDITABLE_ROOF_DIMENSION_M &&
    value <= MAX_EDITABLE_ROOF_DIMENSION_M
  );
}

export type RoofSegmentDimension = {
  segmentIndex: number;
  startPointIndex: number;
  endPointIndex: number;
  lengthM: number;
};

export type RoofSegmentMeasurementOptions = {
  tiltDeg?: number;
  fallAzimuthDeg?: number;
};

export function roofSegmentLengthM(
  vectorPx: MetricPoint,
  mppImage: number,
  options: RoofSegmentMeasurementOptions = {},
): number {
  const planLengthPx = Math.hypot(vectorPx.x, vectorPx.y);
  if (
    !(options.tiltDeg && options.tiltDeg > 0) ||
    typeof options.fallAzimuthDeg !== "number"
  ) {
    return planLengthPx * mppImage;
  }
  const azimuthRad = (options.fallAzimuthDeg * Math.PI) / 180;
  const fallUnit = { x: Math.sin(azimuthRad), y: -Math.cos(azimuthRad) };
  const parallelPx = vectorPx.x * fallUnit.x + vectorPx.y * fallUnit.y;
  const perpendicularPx =
    vectorPx.x * -fallUnit.y + vectorPx.y * fallUnit.x;
  const cosine = Math.max(
    Math.cos((Math.min(options.tiltDeg, 80) * Math.PI) / 180),
    Math.cos((80 * Math.PI) / 180),
  );
  return Math.hypot(parallelPx / cosine, perpendicularPx) * mppImage;
}

export function analyzeRoofSegments(
  pointsPx: readonly MetricPoint[],
  mppImage: number,
  options: RoofSegmentMeasurementOptions = {},
): RoofSegmentDimension[] {
  if (!(mppImage > 0) || !Number.isFinite(mppImage) || pointsPx.length < 3) return [];
  return pointsPx.map((point, segmentIndex) => {
    const endPointIndex = (segmentIndex + 1) % pointsPx.length;
    const end = pointsPx[endPointIndex];
    return {
      segmentIndex,
      startPointIndex: segmentIndex,
      endPointIndex,
      lengthM: roofSegmentLengthM(
        { x: end.x - point.x, y: end.y - point.y },
        mppImage,
        options,
      ),
    };
  });
}

export type ResizeRoofSegmentResult =
  | { valid: true; points: MetricPoint[]; segments: RoofSegmentDimension[] }
  | {
      valid: false;
      reason:
        | "invalid-scale"
        | "invalid-segment"
        | "invalid-length"
        | "invalid-polygon";
    };

/**
 * Changes one polygon edge without inventing an axis or bounding-box constraint.
 * The selected edge keeps its midpoint and direction; its two vertices move
 * symmetrically. Neighbouring edges follow those vertices.
 */
export function resizeRoofSegment(input: {
  pointsPx: readonly MetricPoint[];
  mppImage: number;
  segmentIndex: number;
  lengthM: number;
  tiltDeg?: number;
  fallAzimuthDeg?: number;
}): ResizeRoofSegmentResult {
  if (!(input.mppImage > 0) || !Number.isFinite(input.mppImage)) {
    return { valid: false, reason: "invalid-scale" };
  }
  if (!validDimension(input.lengthM)) return { valid: false, reason: "invalid-length" };
  if (
    input.pointsPx.length < 3 ||
    !Number.isInteger(input.segmentIndex) ||
    input.segmentIndex < 0 ||
    input.segmentIndex >= input.pointsPx.length
  ) {
    return { valid: false, reason: "invalid-segment" };
  }

  const startIndex = input.segmentIndex;
  const endIndex = (startIndex + 1) % input.pointsPx.length;
  const start = input.pointsPx[startIndex];
  const end = input.pointsPx[endIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const currentLengthPx = Math.hypot(dx, dy);
  if (!(currentLengthPx > 1e-6)) return { valid: false, reason: "invalid-segment" };

  const currentLengthM = roofSegmentLengthM(
    { x: dx, y: dy },
    input.mppImage,
    { tiltDeg: input.tiltDeg, fallAzimuthDeg: input.fallAzimuthDeg },
  );
  const halfLengthPx = (currentLengthPx * input.lengthM) / currentLengthM / 2;
  const ux = dx / currentLengthPx;
  const uy = dy / currentLengthPx;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const points = input.pointsPx.map((point) => ({ ...point }));
  points[startIndex] = {
    x: midpoint.x - ux * halfLengthPx,
    y: midpoint.y - uy * halfLengthPx,
  };
  points[endIndex] = {
    x: midpoint.x + ux * halfLengthPx,
    y: midpoint.y + uy * halfLengthPx,
  };

  const metricPoints = points.map((point) => ({
    x: point.x * input.mppImage,
    y: point.y * input.mppImage,
  }));
  if (!isSimpleMetricPolygon(metricPoints) || polygonArea(metricPoints) <= 0.01) {
    return { valid: false, reason: "invalid-polygon" };
  }
  return {
    valid: true,
    points,
    segments: analyzeRoofSegments(points, input.mppImage, {
      tiltDeg: input.tiltDeg,
      fallAzimuthDeg: input.fallAzimuthDeg,
    }),
  };
}

export function resizeRectangularRoof(input: {
  pointsPx: readonly MetricPoint[];
  mppImage: number;
  lengthM: number;
  widthM: number;
}): ResizeRectangularRoofResult {
  if (!validDimension(input.lengthM)) return { valid: false, reason: "invalid-length" };
  if (!validDimension(input.widthM)) return { valid: false, reason: "invalid-width" };
  const analysis = analyzeRectangularRoof(input.pointsPx, input.mppImage);
  if (!analysis.supported) return { valid: false, reason: "unsupported-shape" };
  const current = analysis.dimensions;
  const lengthScale = input.lengthM / current.lengthM;
  const widthScale = input.widthM / current.widthM;
  const points = input.pointsPx.map((point) => {
    const relative = {
      x: point.x - current.centerPx.x,
      y: point.y - current.centerPx.y,
    };
    const alongLength = dot(relative, current.lengthAxis) * lengthScale;
    const alongWidth = dot(relative, current.widthAxis) * widthScale;
    return {
      x:
        current.centerPx.x +
        current.lengthAxis.x * alongLength +
        current.widthAxis.x * alongWidth,
      y:
        current.centerPx.y +
        current.lengthAxis.y * alongLength +
        current.widthAxis.y * alongWidth,
    };
  });
  const resized = analyzeRectangularRoof(points, input.mppImage);
  if (!resized.supported) return { valid: false, reason: "unsupported-shape" };
  return { valid: true, points, dimensions: resized.dimensions };
}
