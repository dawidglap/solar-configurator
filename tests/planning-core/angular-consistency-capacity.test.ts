import assert from "node:assert/strict";
import test from "node:test";

import {
  computeUsableRoof,
  isFootprintContainedInUsableRoof,
  transformMetricPolygon,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";
import {
  resolveK2ParallelRoofEdgeAlignment,
  type AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import {
  alignAdvancedLayoutParallelToRoofEdge,
  buildDirectAdvancedRoofLayout,
  createInitialAdvancedPlanning,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import {
  resolveAdvancedWorkingOrientationDeg,
  rotateAdvancedWorkingOrientation,
} from "../../src/components_v2/modules/panels/wholeLayoutReflow";
import {
  getCurrentCanvasRotationDeg,
  setCurrentCanvasRotationDeg,
} from "../../src/components_v2/canvas/canvasRotationState";
import { formatDisplayAngleDeg } from "../../src/components_v2/roof/angleDisplay";
import type { ModulesConfig, PanelSpec, RoofArea } from "../../src/types/planner";

const EPSILON = 1e-9;
const MPP_IMAGE = 0.1;

const PANEL: PanelSpec = {
  id: "angular-panel",
  brand: "Fixture",
  model: "M440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};

const MODULES: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "landscape",
  spacingM: 0.019,
  spacingXM: 0.019,
  spacingYM: 0.019,
  marginM: 0.3,
  showGrid: false,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 1,
};

function rotatedRectangle(input: {
  widthM: number;
  heightM: number;
  edgeAzimuthDeg: number;
  centerM?: { x: number; y: number };
}): MetricPolygon {
  const radians = input.edgeAzimuthDeg * Math.PI / 180;
  const tangent = { x: Math.sin(radians), y: -Math.cos(radians) };
  const inward = { x: -tangent.y, y: tangent.x };
  const center = input.centerM ?? { x: 20, y: 20 };
  const halfWidth = input.widthM / 2;
  const halfHeight = input.heightM / 2;
  return [
    { x: center.x - tangent.x * halfWidth - inward.x * halfHeight, y: center.y - tangent.y * halfWidth - inward.y * halfHeight },
    { x: center.x + tangent.x * halfWidth - inward.x * halfHeight, y: center.y + tangent.y * halfWidth - inward.y * halfHeight },
    { x: center.x + tangent.x * halfWidth + inward.x * halfHeight, y: center.y + tangent.y * halfWidth + inward.y * halfHeight },
    { x: center.x - tangent.x * halfWidth + inward.x * halfHeight, y: center.y - tangent.y * halfWidth + inward.y * halfHeight },
  ];
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}

test("one Referenzkante produces an exact D-Dome tangent and South perpendicular", () => {
  const roof = rotatedRectangle({ widthM: 17.85, heightM: 10.9, edgeAzimuthDeg: 114.3 });
  const alignment = resolveK2ParallelRoofEdgeAlignment({
    roofPointsPx: roof,
    mppImage: 1,
    referenceEdgeIndex: 0,
  });
  assert.ok(alignment);
  close(alignment.edgeTangentAzimuthDeg, 114.3);
  close(alignment.faceAzimuthDeg, 204.3);
  close((alignment.faceAzimuthDeg - alignment.edgeTangentAzimuthDeg + 360) % 360, 90);
  close((alignment.edgeTangentAzimuthDeg + 180) % 360, 294.3);
});

test("rotated exact-edge footprints survive micrometre inset quantization but real overflow does not", () => {
  const roof = transformMetricPolygon(
    [
      { x: -8.925, y: -5.45 },
      { x: 8.925, y: -5.45 },
      { x: 8.925, y: 5.45 },
      { x: -8.925, y: 5.45 },
    ],
    { translationM: { x: 20, y: 20 }, rotationCartesianDeg: -114.3 },
  );
  const usable = computeUsableRoof({ roofPolygonM: roof, marginM: 0.3 });
  assert.equal(usable.status, "valid");
  const exactInset = transformMetricPolygon(
    [
      { x: -8.625, y: -5.15 },
      { x: 8.625, y: -5.15 },
      { x: 8.625, y: 5.15 },
      { x: -8.625, y: 5.15 },
    ],
    { translationM: { x: 20, y: 20 }, rotationCartesianDeg: -114.3 },
  );
  assert.equal(isFootprintContainedInUsableRoof(exactInset, usable.components), true);

  const twentyMicrometreOverflow = transformMetricPolygon(
    [
      { x: -8.62502, y: -5.15 },
      { x: 8.62502, y: -5.15 },
      { x: 8.62502, y: 5.15 },
      { x: -8.62502, y: 5.15 },
    ],
    { translationM: { x: 20, y: 20 }, rotationCartesianDeg: -114.3 },
  );
  assert.equal(
    isFootprintContainedInUsableRoof(twentyMicrometreOverflow, usable.components),
    false,
  );
});

test("viewport rotation cannot change canonical alignment or full-layout capacity", () => {
  const roofPointsM = rotatedRectangle({ widthM: 17.85, heightM: 10.9, edgeAzimuthDeg: 114.3 });
  const roof: RoofArea = {
    id: "rotated-flat",
    name: "D1",
    roofKind: "flat",
    tiltDeg: 0,
    referenceEdgeIndex: 0,
    points: roofPointsM.map((point) => ({ x: point.x / MPP_IMAGE, y: point.y / MPP_IMAGE })),
  };
  const initial = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const aligned = alignAdvancedLayoutParallelToRoofEdge({ config: initial, roof, mppImage: MPP_IMAGE });
  const build = () => buildDirectAdvancedRoofLayout({
    roof,
    config: aligned,
    mppImage: MPP_IMAGE,
    zones: [],
    snowGuards: [],
    layoutRunId: "same-run",
    createPanelId: (index) => `panel-${index}`,
  });
  const previousRotation = getCurrentCanvasRotationDeg();
  try {
    setCurrentCanvasRotationDeg(0);
    const zero = build();
    setCurrentCanvasRotationDeg(-24.3);
    const rotated = build();
    assert.ok(zero);
    assert.deepEqual(rotated, zero);
  } finally {
    setCurrentCanvasRotationDeg(previousRotation);
  }
});

test("display rounds only at the boundary while fine rotations preserve decimals", () => {
  assert.equal(formatDisplayAngleDeg(114.3), "114°");
  assert.equal(formatDisplayAngleDeg(205.3), "205°");
  const initial = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const system = initial.advanced.system;
  assert.ok("primaryFaceAzimuthDeg" in system);
  const decimal: AdvancedSurfacePlanningV1 = {
    ...initial,
    advanced: {
      ...initial.advanced,
      system: { ...system, primaryFaceAzimuthDeg: 205.3 },
    },
  };
  const plusOne = rotateAdvancedWorkingOrientation(decimal, 1);
  const plusNinety = rotateAdvancedWorkingOrientation(decimal, 90);
  close(resolveAdvancedWorkingOrientationDeg(plusOne), 206.3);
  close(resolveAdvancedWorkingOrientationDeg(plusNinety), 295.3);
  close(
    resolveAdvancedWorkingOrientationDeg(rotateAdvancedWorkingOrientation(plusOne, -1)),
    205.3,
  );

  let repeated: AdvancedSurfacePlanningV1 = decimal;
  for (let index = 0; index < 100; index += 1) {
    repeated = rotateAdvancedWorkingOrientation(repeated, 1);
    repeated = rotateAdvancedWorkingOrientation(repeated, -1);
  }
  close(resolveAdvancedWorkingOrientationDeg(repeated), 205.3);
  close(
    resolveAdvancedWorkingOrientationDeg(JSON.parse(JSON.stringify(repeated))),
    205.3,
  );
});
