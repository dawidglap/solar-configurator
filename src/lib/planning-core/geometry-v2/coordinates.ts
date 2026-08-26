import type { MetricPoint, MetricPolygon } from "./types";

export type ImageMetricAdapter = {
  mppImage: number;
  /** Image pixel that represents metric coordinate (0, 0). */
  metricOriginPx: { x: number; y: number };
};

export function normalizeDegrees(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function imagePointToMetric(
  pointPx: { x: number; y: number },
  adapter: ImageMetricAdapter,
): MetricPoint {
  if (!(adapter.mppImage > 0) || !Number.isFinite(adapter.mppImage)) {
    throw new Error("mppImage must be a finite positive number");
  }
  return {
    x: (pointPx.x - adapter.metricOriginPx.x) * adapter.mppImage,
    y: (adapter.metricOriginPx.y - pointPx.y) * adapter.mppImage,
  };
}

export function metricPointToImage(
  pointM: MetricPoint,
  adapter: ImageMetricAdapter,
): { x: number; y: number } {
  if (!(adapter.mppImage > 0) || !Number.isFinite(adapter.mppImage)) {
    throw new Error("mppImage must be a finite positive number");
  }
  return {
    x: adapter.metricOriginPx.x + pointM.x / adapter.mppImage,
    y: adapter.metricOriginPx.y - pointM.y / adapter.mppImage,
  };
}

export function imagePolygonToMetric(
  polygonPx: Array<{ x: number; y: number }>,
  adapter: ImageMetricAdapter,
): MetricPolygon {
  return polygonPx.map((point) => imagePointToMetric(point, adapter));
}

export function metricPolygonToImage(
  polygonM: MetricPolygon,
  adapter: ImageMetricAdapter,
): Array<{ x: number; y: number }> {
  return polygonM.map((point) => metricPointToImage(point, adapter));
}

/** Geographic azimuth: 0=N, 90=E. Cartesian angle: 0=+X, positive CCW. */
export function geographicAzimuthToCartesianDeg(azimuthDeg: number): number {
  return normalizeDegrees(90 - azimuthDeg);
}

/** Image/canvas angles rotate clockwise because image Y points down. */
export function canvasAngleToCartesianDeg(canvasAngleDeg: number): number {
  return normalizeDegrees(-canvasAngleDeg);
}

export function cartesianAngleToCanvasDeg(cartesianAngleDeg: number): number {
  return normalizeDegrees(-cartesianAngleDeg);
}

export function rotateMetricPoint(
  point: MetricPoint,
  angleCartesianDeg: number,
): MetricPoint {
  const radians = (angleCartesianDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function transformMetricPolygon(
  polygon: MetricPolygon,
  transform: {
    translationM?: MetricPoint;
    rotationCartesianDeg?: number;
  },
): MetricPolygon {
  const translation = transform.translationM ?? { x: 0, y: 0 };
  const rotation = transform.rotationCartesianDeg ?? 0;
  return polygon.map((point) => {
    const rotated = rotateMetricPoint(point, rotation);
    return {
      x: rotated.x + translation.x,
      y: rotated.y + translation.y,
    };
  });
}
