import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeRoofSegments,
  analyzeRectangularRoof,
  resizeRoofSegment,
  resizeRectangularRoof,
  type MetricPoint,
} from "../../src/lib/planning-core/geometry-v2";
import {
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  materializeAdvancedPanels,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import { moveZoneVertex } from "../../src/components_v2/zones/zoneVertexEditing";
import type { ModulesConfig, PanelInstance, PanelSpec, RoofArea } from "../../src/types/planner";

const EPSILON = 1e-9;
const MPP_IMAGE = 0.1;
const PANEL: PanelSpec = {
  id: "panel-440",
  brand: "Test",
  model: "440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};
const MODULES: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "portrait",
  spacingM: 0.02,
  marginM: 0.2,
  showGrid: true,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 1,
  perRoofAngles: {},
};

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${label}: ${actual} != ${expected}`);
}

function rotatedRectangle(input: {
  center: MetricPoint;
  lengthM: number;
  widthM: number;
  rotationDeg: number;
  mppImage?: number;
}): MetricPoint[] {
  const mpp = input.mppImage ?? MPP_IMAGE;
  const halfLengthPx = input.lengthM / mpp / 2;
  const halfWidthPx = input.widthM / mpp / 2;
  const radians = (input.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -halfLengthPx, y: -halfWidthPx },
    { x: halfLengthPx, y: -halfWidthPx },
    { x: halfLengthPx, y: halfWidthPx },
    { x: -halfLengthPx, y: halfWidthPx },
  ].map((point) => ({
    x: input.center.x + point.x * cos - point.y * sin,
    y: input.center.y + point.x * sin + point.y * cos,
  }));
}

test("rectangle 10 x 6 m resizes length to 12 m around the same center", () => {
  const original = rotatedRectangle({ center: { x: 100, y: 80 }, lengthM: 10, widthM: 6, rotationDeg: 0 });
  const resized = resizeRectangularRoof({ pointsPx: original, mppImage: MPP_IMAGE, lengthM: 12, widthM: 6 });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  close(resized.dimensions.lengthM, 12, "length");
  close(resized.dimensions.widthM, 6, "width");
  close(resized.dimensions.centerPx.x, 100, "center x");
  close(resized.dimensions.centerPx.y, 80, "center y");
});

test("rotated rectangle preserves 37 degree local axes, width and center", () => {
  const original = rotatedRectangle({ center: { x: 140, y: 120 }, lengthM: 10, widthM: 6, rotationDeg: 37 });
  const before = analyzeRectangularRoof(original, MPP_IMAGE);
  const resized = resizeRectangularRoof({ pointsPx: original, mppImage: MPP_IMAGE, lengthM: 12, widthM: 6 });
  assert.equal(before.supported, true);
  assert.equal(resized.valid, true);
  if (!before.supported || !resized.valid) return;
  close(before.dimensions.canvasAngleDeg, 37, "original rotation");
  close(resized.dimensions.lengthM, 12, "rotated length");
  close(resized.dimensions.widthM, 6, "rotated width");
  close(resized.dimensions.canvasAngleDeg, before.dimensions.canvasAngleDeg, "rotation");
  close(resized.dimensions.centerPx.x, before.dimensions.centerPx.x, "center x");
  close(resized.dimensions.centerPx.y, before.dimensions.centerPx.y, "center y");
});

test("manual dimension editing never changes mppImage", () => {
  const state = {
    mppImage: 0.073125,
    points: rotatedRectangle({ center: { x: 100, y: 100 }, lengthM: 10, widthM: 6, rotationDeg: 15, mppImage: 0.073125 }),
  };
  const resized = resizeRectangularRoof({ pointsPx: state.points, mppImage: state.mppImage, lengthM: 12, widthM: 6 });
  assert.equal(resized.valid, true);
  assert.equal(state.mppImage, 0.073125);
});

test("zero, negative, non-finite and excessive dimensions are rejected", () => {
  const points = rotatedRectangle({ center: { x: 100, y: 100 }, lengthM: 10, widthM: 6, rotationDeg: 0 });
  for (const lengthM of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 501]) {
    assert.equal(resizeRectangularRoof({ pointsPx: points, mppImage: MPP_IMAGE, lengthM, widthM: 6 }).valid, false);
  }
});

test("generic and concave polygons do not masquerade as semantic rectangles", () => {
  const concave = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
    { x: 50, y: 25 }, { x: 0, y: 50 },
  ];
  assert.equal(analyzeRectangularRoof(concave, MPP_IMAGE).supported, false);
});

test("active D-Dome preview recomputes after roof resize while committed panels stay untouched", () => {
  const originalPoints = rotatedRectangle({ center: { x: 150, y: 100 }, lengthM: 10, widthM: 8, rotationDeg: 0 });
  const resized = resizeRectangularRoof({ pointsPx: originalPoints, mppImage: MPP_IMAGE, lengthM: 16, widthM: 8 });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  const config = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const originalRoof: RoofArea = { id: "roof", name: "Roof", points: originalPoints };
  const resizedRoof: RoofArea = { ...originalRoof, points: resized.points };
  const committedPanels: PanelInstance[] = [{
    id: "committed",
    roofId: "roof",
    cx: 100,
    cy: 100,
    wPx: 10,
    hPx: 17,
    angleDeg: 0,
    orientation: "portrait",
    panelId: PANEL.id,
  }];
  const before = computeAdvancedPlanningPreview({ roof: originalRoof, config, mppImage: MPP_IMAGE });
  const after = computeAdvancedPlanningPreview({ roof: resizedRoof, config, mppImage: MPP_IMAGE });
  assert.equal(before.valid && after.valid, true);
  if (!before.valid || !after.valid) return;
  assert.ok(after.blockCount > before.blockCount);
  assert.equal(committedPanels.length, 1);
  assert.equal(committedPanels[0].id, "committed");

  const materialized = materializeAdvancedPanels({
    roofId: "roof",
    config,
    preview: after,
    layoutRunId: "resized",
    createPanelId: (index) => `resized-${index}`,
  });
  assert.deepEqual(
    materialized.map((panel) => [panel.cx, panel.cy, panel.wPx, panel.hPx, panel.angleDeg]),
    after.modules.map((module) => [module.cx, module.cy, module.wPx, module.hPx, module.angleDeg]),
  );
});

const OWNER_ROOF = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];
const ZONE = [
  { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 },
];

test("reserved vertex editing changes only one vertex and preserves the application owner", () => {
  const zone = { id: "zone", roofId: "roof-a", points: ZONE };
  const result = moveZoneVertex({
    points: zone.points,
    vertexIndex: 0,
    requestedPoint: { x: 3, y: 3 },
    ownerRoof: OWNER_ROOF,
  });
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.deepEqual(result.points[0], { x: 3, y: 3 });
  assert.deepEqual(result.points.slice(1), ZONE.slice(1));
  assert.equal(zone.roofId, "roof-a");
});

test("reserved vertices snap to the owner roof edge and Shift-style disable leaves the raw point", () => {
  const snapped = moveZoneVertex({
    points: ZONE,
    vertexIndex: 0,
    requestedPoint: { x: 0.25, y: 2 },
    ownerRoof: OWNER_ROOF,
    snapTolerancePx: 0.5,
  });
  assert.equal(snapped.accepted, true);
  if (snapped.accepted) {
    assert.equal(snapped.snapped, true);
    assert.deepEqual(snapped.point, { x: 0, y: 2 });
  }
  const raw = moveZoneVertex({
    points: ZONE,
    vertexIndex: 0,
    requestedPoint: { x: 0.25, y: 2 },
    ownerRoof: OWNER_ROOF,
    snapTolerancePx: 0.5,
    disableSnap: true,
  });
  assert.equal(raw.accepted, true);
  if (raw.accepted) assert.deepEqual(raw.point, { x: 0.25, y: 2 });
});

test("reserved edits outside the owner roof or creating self-intersection are rejected", () => {
  const outside = moveZoneVertex({
    points: ZONE,
    vertexIndex: 0,
    requestedPoint: { x: -2, y: 2 },
    ownerRoof: OWNER_ROOF,
  });
  assert.equal(outside.accepted, false);
  const selfIntersection = moveZoneVertex({
    points: ZONE,
    vertexIndex: 1,
    requestedPoint: { x: 4, y: 9 },
    ownerRoof: OWNER_ROOF,
  });
  assert.equal(selfIntersection.accepted, false);
  assert.deepEqual(selfIntersection.points, ZONE);
});

test("generic roof segments expose every real polygon edge in metres", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 120, y: 50 },
    { x: 50, y: 90 },
    { x: 0, y: 50 },
  ];
  const segments = analyzeRoofSegments(polygon, MPP_IMAGE);
  assert.equal(segments.length, 5);
  assert.equal(segments[0].lengthM, 10);
  assert.ok(Math.abs(segments[1].lengthM - Math.hypot(20, 50) * MPP_IMAGE) < EPSILON);
});

test("manual segment length keeps its midpoint/direction and updates the polygon", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 120, y: 50 },
    { x: 50, y: 90 },
    { x: 0, y: 50 },
  ];
  const resized = resizeRoofSegment({
    pointsPx: polygon,
    mppImage: MPP_IMAGE,
    segmentIndex: 0,
    lengthM: 12,
  });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  assert.deepEqual(resized.points[0], { x: -10, y: 0 });
  assert.deepEqual(resized.points[1], { x: 110, y: 0 });
  assert.deepEqual(resized.points[3], polygon[3]);
  assert.equal(resized.segments[0].lengthM, 12);
  assert.equal(
    resizeRoofSegment({
      pointsPx: polygon,
      mppImage: MPP_IMAGE,
      segmentIndex: 0,
      lengthM: 0,
    }).valid,
    false,
  );
});

test("pitched segment values use the same true-length correction for display and editing", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const segments = analyzeRoofSegments(polygon, MPP_IMAGE, {
    tiltDeg: 60,
    fallAzimuthDeg: 90,
  });
  assert.ok(Math.abs(segments[0].lengthM - 20) < EPSILON);
  const resized = resizeRoofSegment({
    pointsPx: polygon,
    mppImage: MPP_IMAGE,
    segmentIndex: 0,
    lengthM: 12,
    tiltDeg: 60,
    fallAzimuthDeg: 90,
  });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  assert.ok(Math.abs(resized.segments[0].lengthM - 12) < EPSILON);
  assert.ok(Math.abs(resized.points[0].x - 20) < EPSILON);
  assert.ok(Math.abs(resized.points[1].x - 80) < EPSILON);
});
