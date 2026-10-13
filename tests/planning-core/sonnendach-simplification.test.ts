import assert from "node:assert/strict";
import test from "node:test";

import {
  simplifySonnendachPolygon,
  SONNENDACH_SIMPLIFICATION,
} from "../../src/lib/planning/sonnendachPolygon";
import {
  ROOF_LABEL_MIN_ZOOM_RATIO,
  shouldShowRoofLabels,
} from "../../src/components_v2/canvas/roofLabelVisibility";
import { resolveRoofShapeModeHotkey } from "../../src/components_v2/layout/toolHotkeyPolicy";

function signedArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

test("Sonnendach noise is reduced from thirteen points to the semantic six sides", () => {
  const noisyHexagon = [
    { x: 0, y: 0 },
    { x: 4, y: 0.03 },
    { x: 8, y: -0.02 },
    { x: 10, y: 0 },
    { x: 11, y: 2.02 },
    { x: 12, y: 4 },
    { x: 12.03, y: 6 },
    { x: 12, y: 8 },
    { x: 9, y: 9.02 },
    { x: 6, y: 10 },
    { x: 3, y: 8.98 },
    { x: 0, y: 8 },
    { x: -0.02, y: 4 },
    { x: 0, y: 0 },
  ];
  const simplified = simplifySonnendachPolygon(noisyHexagon, 1);
  assert.equal(simplified.length, 6);
  assert.equal(Math.sign(signedArea(simplified)), Math.sign(signedArea(noisyHexagon)));
  assert.ok(
    Math.abs(Math.abs(signedArea(simplified)) - Math.abs(signedArea(noisyHexagon))) /
      Math.abs(signedArea(noisyHexagon)) <= SONNENDACH_SIMPLIFICATION.maxAreaChangeRatio,
  );
});

test("real short corners and simple rectangles are preserved", () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ];
  const roofWithSmallNotch = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 5.4, y: 8 },
    { x: 5.4, y: 7.65 },
    { x: 5, y: 7.65 },
    { x: 5, y: 8 },
    { x: 0, y: 8 },
  ];
  assert.deepEqual(simplifySonnendachPolygon(rectangle, 1), rectangle);
  assert.equal(simplifySonnendachPolygon(roofWithSmallNotch, 1).length, 8);
});

test("roof labels use a fit-scale-relative zoom threshold", () => {
  assert.equal(shouldShowRoofLabels(1.29, 1), false);
  assert.equal(shouldShowRoofLabels(ROOF_LABEL_MIN_ZOOM_RATIO, 1), true);
  assert.equal(shouldShowRoofLabels(0.65, 0.5), true);
});

test("N/T shape shortcuts are scoped to Gebäudeplanung with a selected roof", () => {
  assert.equal(resolveRoofShapeModeHotkey({ key: "N", step: "building", hasSelectedRoof: true }), "normal");
  assert.equal(resolveRoofShapeModeHotkey({ key: "t", step: "building", hasSelectedRoof: true }), "trapezio");
  assert.equal(resolveRoofShapeModeHotkey({ key: "t", step: "modules", hasSelectedRoof: true }), undefined);
  assert.equal(resolveRoofShapeModeHotkey({ key: "n", step: "building", hasSelectedRoof: false }), undefined);
});
