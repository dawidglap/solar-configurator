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
