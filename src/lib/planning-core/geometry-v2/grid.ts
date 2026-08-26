import { rotateMetricPoint, transformMetricPolygon } from "./coordinates";
import { validatePlacementFootprint } from "./collision";
import {
  combinePolygonBounds,
  isSimpleMetricPolygon,
  polygonBounds,
} from "./polygon";
import {
  GEOMETRY_EPSILON_M,
  GEOMETRY_V2_ENGINE_VERSION,
  type GenerateGridPlacementsInput,
  type GenerateGridPlacementsResult,
  type GridAnchor,
  type MetricPoint,
  type PlacementUnitGeometry,
} from "./types";

function validPhase(phase: number): boolean {
  return Number.isFinite(phase) && phase >= 0 && phase < 1;
}

export function generateAnchoredAxisPositions(input: {
  min: number;
  max: number;
  pitch: number;
  phase: number;
  anchor: GridAnchor;
}): number[] {
  if (
    !Number.isFinite(input.min) ||
    !Number.isFinite(input.max) ||
    !(input.pitch > 0) ||
    !validPhase(input.phase) ||
    input.max < input.min - GEOMETRY_EPSILON_M
  ) {
    return [];
  }

  const positions: number[] = [];
  if (input.anchor === "start") {
    const first = input.min + input.phase * input.pitch;
    for (
      let value = first;
      value <= input.max + GEOMETRY_EPSILON_M;
      value += input.pitch
    ) {
      positions.push(value);
    }
    return positions;
  }

  if (input.anchor === "end") {
    const last = input.max - input.phase * input.pitch;
    for (
      let value = last;
      value >= input.min - GEOMETRY_EPSILON_M;
      value -= input.pitch
    ) {
      positions.push(value);
    }
    return positions.reverse();
  }

  const centerRail = (input.min + input.max) / 2 + input.phase * input.pitch;
  const firstIndex = Math.ceil(
    (input.min - centerRail - GEOMETRY_EPSILON_M) / input.pitch,
  );
  const lastIndex = Math.floor(
    (input.max - centerRail + GEOMETRY_EPSILON_M) / input.pitch,
  );
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    positions.push(centerRail + index * input.pitch);
  }
  return positions;
}

export function createRectangularPlacementUnit(input: {
  widthM: number;
  heightM: number;
  gapX: number;
  gapY: number;
}): PlacementUnitGeometry {
  const halfWidth = input.widthM / 2;
  const halfHeight = input.heightM / 2;
  return {
    footprint: [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ],
    pitchM: {
      x: input.widthM + input.gapX,
      y: input.heightM + input.gapY,
    },
  };
}

function toGridLocal(point: MetricPoint, origin: MetricPoint, angleDeg: number) {
  return rotateMetricPoint(
    { x: point.x - origin.x, y: point.y - origin.y },
    -angleDeg,
  );
}

function toWorld(point: MetricPoint, origin: MetricPoint, angleDeg: number) {
  const rotated = rotateMetricPoint(point, angleDeg);
  return { x: rotated.x + origin.x, y: rotated.y + origin.y };
}

function invalidGridResult(message: string): GenerateGridPlacementsResult {
  return {
    engineVersion: GEOMETRY_V2_ENGINE_VERSION,
    placements: [],
    count: 0,
    rejected: {
      "outside-usable-roof": 0,
      "reserved-zone": 0,
      "snow-guard": 0,
    },
    diagnostics: [{ code: "invalid-grid", message }],
  };
}

export function generateGridPlacements(
  input: GenerateGridPlacementsInput,
): GenerateGridPlacementsResult {
  const phaseX = input.phaseX ?? 0;
  const phaseY = input.phaseY ?? 0;
  const anchorX = input.anchorX ?? "start";
  const anchorY = input.anchorY ?? "start";
  const rotation = input.rotationCartesianDeg ?? 0;
  const gridOrigin = input.gridOriginM ?? { x: 0, y: 0 };

  if (input.usableRoof.status !== "valid" || !input.usableRoof.components.length) {
    return {
      ...invalidGridResult("Usable roof geometry is empty or invalid."),
      diagnostics: [
        ...input.usableRoof.diagnostics,
        {
          code: "empty-usable-roof",
          message: "Grid generation requires valid usable roof geometry.",
        },
      ],
    };
  }
  if (
    !isSimpleMetricPolygon(input.unit.footprint) ||
    !(input.unit.pitchM.x > 0) ||
    !(input.unit.pitchM.y > 0) ||
    !Number.isFinite(input.unit.pitchM.x) ||
    !Number.isFinite(input.unit.pitchM.y) ||
    !validPhase(phaseX) ||
    !validPhase(phaseY) ||
    !Number.isFinite(rotation)
  ) {
    return invalidGridResult(
      "Footprint, pitch, phase and rotation must define a finite valid grid.",
    );
  }

  const localRoofComponents = input.usableRoof.components.map((component) =>
    component.map((point) => toGridLocal(point, gridOrigin, rotation)),
  );
  const roofBounds = combinePolygonBounds(localRoofComponents);
  const footprintBounds = polygonBounds(input.unit.footprint);
  const minOriginX = roofBounds.minX - footprintBounds.minX;
  const maxOriginX = roofBounds.maxX - footprintBounds.maxX;
  const minOriginY = roofBounds.minY - footprintBounds.minY;
  const maxOriginY = roofBounds.maxY - footprintBounds.maxY;

  const columns = generateAnchoredAxisPositions({
    min: minOriginX,
    max: maxOriginX,
    pitch: input.unit.pitchM.x,
    phase: phaseX,
    anchor: anchorX,
  });
  const rows = generateAnchoredAxisPositions({
    min: minOriginY,
    max: maxOriginY,
    pitch: input.unit.pitchM.y,
    phase: phaseY,
    anchor: anchorY,
  });

  const result: GenerateGridPlacementsResult = {
    engineVersion: GEOMETRY_V2_ENGINE_VERSION,
    placements: [],
    count: 0,
    rejected: {
      "outside-usable-roof": 0,
      "reserved-zone": 0,
      "snow-guard": 0,
    },
    diagnostics: [],
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const localOrigin = { x: columns[columnIndex], y: rows[rowIndex] };
      const worldOrigin = toWorld(localOrigin, gridOrigin, rotation);
      const footprint = transformMetricPolygon(input.unit.footprint, {
        translationM: worldOrigin,
        rotationCartesianDeg: rotation,
      });
      const validation = validatePlacementFootprint({
        footprint,
        usableRoof: input.usableRoof,
        reservedZones: input.reservedZones,
        snowGuards: input.snowGuards,
      });
      if (!validation.valid) {
        for (const reason of validation.reasons) result.rejected[reason] += 1;
        continue;
      }
      result.placements.push({
        originM: worldOrigin,
        footprint,
        rotationCartesianDeg: rotation,
        columnIndex,
        rowIndex,
      });
    }
  }

  result.count = result.placements.length;
  return result;
}
