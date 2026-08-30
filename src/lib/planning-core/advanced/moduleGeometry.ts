import {
  normalizeDegrees,
  transformMetricPolygon,
  type MetricPoint,
  type MetricPolygon,
} from "../geometry-v2";
import type {
  AdvancedModuleSpecification,
  TiltedModuleGeometry,
} from "./types";

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive metric value.`);
  }
}

export function normalizeGeographicAzimuth(azimuthDeg: number): number {
  if (!Number.isFinite(azimuthDeg)) {
    throw new RangeError("Geographic azimuth must be finite.");
  }
  return normalizeDegrees(azimuthDeg);
}

export function geographicPlanarOrientationToCartesianRotationDeg(
  planarOrientationDeg: number,
): number {
  return normalizeDegrees(-normalizeGeographicAzimuth(planarOrientationDeg));
}

export function deriveTiltedModuleGeometry(input: {
  module: AdvancedModuleSpecification;
  nominalTiltDeg: number;
  effectiveTiltDeg?: number;
}): TiltedModuleGeometry {
  requireFinitePositive(input.module.widthM, "Module width");
  requireFinitePositive(input.module.heightM, "Module height");
  const effectiveTiltDeg = input.effectiveTiltDeg ?? input.nominalTiltDeg;
  for (const [label, value] of [
    ["Nominal tilt", input.nominalTiltDeg],
    ["Effective tilt", effectiveTiltDeg],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 90) {
      throw new RangeError(`${label} must be in the range [0, 90].`);
    }
  }

  const crossSlopeM =
    input.module.orientation === "portrait"
      ? input.module.widthM
      : input.module.heightM;
  const alongSlopeM =
    input.module.orientation === "portrait"
      ? input.module.heightM
      : input.module.widthM;
  const radians = (effectiveTiltDeg * Math.PI) / 180;

  return {
    crossSlopeM,
    alongSlopeM,
    projectedAlongSlopeM: alongSlopeM * Math.cos(radians),
    riseM: alongSlopeM * Math.sin(radians),
    nominalTiltDeg: input.nominalTiltDeg,
    effectiveTiltDeg,
  };
}

export function createCenteredRectangleFootprint(input: {
  widthM: number;
  depthM: number;
}): MetricPolygon {
  requireFinitePositive(input.widthM, "Footprint width");
  requireFinitePositive(input.depthM, "Footprint depth");
  const halfWidth = input.widthM / 2;
  const halfDepth = input.depthM / 2;
  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ];
}

export function placeLocalFootprint(input: {
  centeredFootprint: MetricPolygon;
  localCenterM: MetricPoint;
  localRotationCartesianDeg?: number;
}): MetricPolygon {
  return transformMetricPolygon(input.centeredFootprint, {
    translationM: input.localCenterM,
    rotationCartesianDeg: input.localRotationCartesianDeg ?? 0,
  });
}
