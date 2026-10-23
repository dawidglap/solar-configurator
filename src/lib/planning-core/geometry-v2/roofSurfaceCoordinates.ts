import type { MetricPoint } from "./types";

export type RoofSurfaceProjection = Readonly<{
  tiltDeg: number;
  fallAzimuthDeg: number;
}>;

const MAX_TECHNICAL_TILT_DEG = 80;

function projectionCosine(projection: RoofSurfaceProjection): number {
  const tiltDeg = Math.min(MAX_TECHNICAL_TILT_DEG, Math.max(0, projection.tiltDeg));
  return Math.cos((tiltDeg * Math.PI) / 180);
}

function projectionAxes(projection: RoofSurfaceProjection) {
  const azimuthRad = (projection.fallAzimuthDeg * Math.PI) / 180;
  const fall = { x: Math.sin(azimuthRad), y: -Math.cos(azimuthRad) };
  return {
    fall,
    cross: { x: -fall.y, y: fall.x },
    cosine: projectionCosine(projection),
  };
}

/** Converts an image-plane vector to true roof-surface metres (u=cross-slope, v=down-slope). */
export function projectedVectorToRoofLocalM(
  vectorPx: MetricPoint,
  mppImage: number,
  projection: RoofSurfaceProjection,
): MetricPoint {
  const { fall, cross, cosine } = projectionAxes(projection);
  return {
    x: (vectorPx.x * cross.x + vectorPx.y * cross.y) * mppImage,
    y: (vectorPx.x * fall.x + vectorPx.y * fall.y) * mppImage / cosine,
  };
}

/** Converts true roof-surface metres back to the top-down image-plane vector. */
export function roofLocalVectorMToProjectedPx(
  vectorM: MetricPoint,
  mppImage: number,
  projection: RoofSurfaceProjection,
): MetricPoint {
  if (!(mppImage > 0) || !Number.isFinite(mppImage)) {
    throw new Error("mppImage must be a finite positive number");
  }
  const { fall, cross, cosine } = projectionAxes(projection);
  return {
    x: (cross.x * vectorM.x + fall.x * vectorM.y * cosine) / mppImage,
    y: (cross.y * vectorM.x + fall.y * vectorM.y * cosine) / mppImage,
  };
}

export function imagePointToRoofLocalM(
  pointPx: MetricPoint,
  originPx: MetricPoint,
  mppImage: number,
  projection: RoofSurfaceProjection,
): MetricPoint {
  return projectedVectorToRoofLocalM({
    x: pointPx.x - originPx.x,
    y: pointPx.y - originPx.y,
  }, mppImage, projection);
}

export function roofLocalPointMToImage(
  pointM: MetricPoint,
  originPx: MetricPoint,
  mppImage: number,
  projection: RoofSurfaceProjection,
): MetricPoint {
  const vectorPx = roofLocalVectorMToProjectedPx(pointM, mppImage, projection);
  return { x: originPx.x + vectorPx.x, y: originPx.y + vectorPx.y };
}

/** True surface metres represented by one image pixel along a canvas direction. */
export function roofSurfaceMetresPerPixelAtCanvasAngle(
  canvasAngleDeg: number,
  mppImage: number,
  projection?: RoofSurfaceProjection,
): number {
  if (!projection) return mppImage;
  const radians = (canvasAngleDeg * Math.PI) / 180;
  const vector = projectedVectorToRoofLocalM(
    { x: Math.cos(radians), y: Math.sin(radians) },
    mppImage,
    projection,
  );
  return Math.hypot(vector.x, vector.y);
}

export function physicalLengthToProjectedPixels(
  lengthM: number,
  canvasAngleDeg: number,
  mppImage: number,
  projection?: RoofSurfaceProjection,
): number {
  return lengthM / roofSurfaceMetresPerPixelAtCanvasAngle(
    canvasAngleDeg,
    mppImage,
    projection,
  );
}

/**
 * Projects the two physical axes of a rectangular roof-surface object into
 * the canonical 2D canvas footprint used by Standard auto-layout.
 */
export function physicalRectangleToProjectedPixels(input: {
  widthM: number;
  heightM: number;
  canvasAngleDeg: number;
  mppImage: number;
  projection?: RoofSurfaceProjection;
}): { widthPx: number; heightPx: number } {
  return {
    widthPx: physicalLengthToProjectedPixels(
      input.widthM,
      input.canvasAngleDeg,
      input.mppImage,
      input.projection,
    ),
    heightPx: physicalLengthToProjectedPixels(
      input.heightM,
      input.canvasAngleDeg + 90,
      input.mppImage,
      input.projection,
    ),
  };
}

export function projectedCanvasAngleToRoofLocalDeg(
  canvasAngleDeg: number,
  mppImage: number,
  projection: RoofSurfaceProjection,
): number {
  const radians = (canvasAngleDeg * Math.PI) / 180;
  const vector = projectedVectorToRoofLocalM(
    { x: Math.cos(radians), y: Math.sin(radians) },
    mppImage,
    projection,
  );
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
}
