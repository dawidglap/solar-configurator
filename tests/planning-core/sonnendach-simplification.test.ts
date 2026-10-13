import assert from "node:assert/strict";
import test from "node:test";

import {
  simplifySonnendachPolygon,
  simplifySonnendachPolygonWithReport,
  isSimpleSonnendachPolygon,
  SONNENDACH_SIMPLIFICATION,
} from "../../src/lib/planning/sonnendachPolygon";
import { normalizeSonnendachImportGeometry } from "../../src/lib/planning/sonnendachImport";
import {
  ROOF_LABEL_MIN_ZOOM_RATIO,
  shouldShowRoofLabels,
} from "../../src/components_v2/canvas/roofLabelVisibility";
import { resolveRoofShapeModeHotkey } from "../../src/components_v2/layout/toolHotkeyPolicy";
import { getCanonicalRoofEdges } from "../../src/lib/planning-core/geometry-v2";

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

test("the production topbar import boundary stores normalized geometry, not the raw ring", () => {
  const metresPerPixel = 0.05;
  const metricRing = [
    { x: 0, y: 0 }, { x: 4, y: 0.03 }, { x: 8, y: -0.02 },
    { x: 10, y: 0 }, { x: 11, y: 2.02 }, { x: 12, y: 4 },
    { x: 12.03, y: 6 }, { x: 12, y: 8 }, { x: 9, y: 9.02 },
    { x: 6, y: 10 }, { x: 3, y: 8.98 }, { x: 0, y: 8 },
    { x: -0.02, y: 4 }, { x: 0, y: 0 },
  ];
  const pointsPx = metricRing.map((point) => ({
    x: 700 + point.x / metresPerPixel,
    y: 420 + point.y / metresPerPixel,
  }));
  const imported = normalizeSonnendachImportGeometry(
    { id: "real-shape-equivalent", pointsPx },
    metresPerPixel,
  );

  assert.equal(imported.report.before.length, 13);
  assert.ok(imported.roof.pointsPx.length < imported.report.before.length);
  assert.equal(imported.roof.pointsPx.length, imported.report.after.length);
  assert.ok(imported.report.removed.some((item) => item.reason === "near-collinear"));
  assert.ok(imported.report.areaChangeRatio <= SONNENDACH_SIMPLIFICATION.maxAreaChangeRatio);
  assert.equal(imported.report.windingPreserved, true);
  assert.equal(imported.report.valid, true);
  assert.equal(isSimpleSonnendachPolygon(imported.roof.pointsPx), true);
});

test("raw Sonnendach result reaches the planner store and rendered Kante model already normalized", async () => {
  const metresPerPixel = 0.05;
  const pointsPx = [
    { x: 700, y: 420 }, { x: 780, y: 420.6 }, { x: 860, y: 419.6 },
    { x: 900, y: 420 }, { x: 920, y: 460.4 }, { x: 940, y: 500 },
    { x: 940.6, y: 540 }, { x: 940, y: 580 }, { x: 880, y: 600.4 },
    { x: 820, y: 620 }, { x: 760, y: 599.6 }, { x: 700, y: 580 },
    { x: 699.6, y: 500 }, { x: 700, y: 420 },
  ];
  const imported = normalizeSonnendachImportGeometry({ id: "api-roof", pointsPx }, metresPerPixel);
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().addRoof({
    id: imported.roof.id,
    name: "Imported roof",
    points: imported.roof.pointsPx,
    source: "sonnendach",
  });
  const stored = usePlannerV2Store.getState().layers[0];
  assert.equal(stored.points.length, 6);
  assert.equal(getCanonicalRoofEdges(stored.points).length, 6);
  usePlannerV2Store.getState().resetPlanner();
});

test("diagnostics retain source indices, metric edge lengths, angles and removal reasons", () => {
  const report = simplifySonnendachPolygonWithReport([
    { x: 0, y: 0 },
    { x: 5, y: 0.02 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
    { x: 0, y: 0 },
  ], 1);
  assert.deepEqual(report.before.map((vertex) => vertex.sourceIndex), [0, 1, 2, 3, 4]);
  assert.ok(report.before.every((vertex) => vertex.outgoingEdgeM > 0));
  assert.ok(report.removed.some((vertex) => vertex.sourceIndex === 1 && vertex.reason === "near-collinear"));
  assert.ok(report.removed.some((vertex) => vertex.sourceIndex === 5 && vertex.reason === "closing-duplicate"));
});

test("metric simplification is independent of snapshot pixel scale", () => {
  const metric = [
    { x: 0, y: 0 }, { x: 4, y: 0.03 }, { x: 8, y: -0.02 },
    { x: 10, y: 0 }, { x: 12, y: 4 }, { x: 12.03, y: 6 },
    { x: 12, y: 8 }, { x: 6, y: 10 }, { x: 0, y: 8 },
    { x: -0.02, y: 4 }, { x: 0, y: 0 },
  ];
  const retainedAtScale = (mpp: number) => simplifySonnendachPolygonWithReport(
    metric.map((point) => ({ x: point.x / mpp, y: point.y / mpp })),
    mpp,
  ).after.map((vertex) => vertex.sourceIndex);
  assert.deepEqual(retainedAtScale(0.025), retainedAtScale(0.2));
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
