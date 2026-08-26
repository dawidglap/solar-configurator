import assert from "node:assert/strict";
import test from "node:test";

import { computeLegacyStandardLayout } from "../../src/lib/planning-core/legacy-standard";
import {
  computeUsableRoof,
  createRectangularPlacementUnit,
  generateGridPlacements,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";

const NO_FILTERS = { reservedZones: false, snowGuards: false };

function legacyLayout(input: {
  polygon: MetricPolygon;
  widthM?: number;
  heightM?: number;
  spacingM?: number;
  marginM?: number;
  phaseY?: number;
  anchorY?: "start" | "center" | "end";
  coverageRatio?: number;
}) {
  return computeLegacyStandardLayout({
    generation: {
      roofPolygon: input.polygon,
      mppImage: 1,
      canvasAngleDeg: 0,
      orientation: "portrait",
      panelSizeM: {
        widthM: input.widthM ?? 1,
        heightM: input.heightM ?? 1,
      },
      spacingM: input.spacingM ?? 0,
      marginM: input.marginM ?? 0,
      phaseX: 0,
      phaseY: input.phaseY ?? 0,
      anchorX: "start",
      anchorY: input.anchorY ?? "start",
      coverageRatio: input.coverageRatio ?? 1,
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: NO_FILTERS,
  });
}

function v2Layout(input: {
  polygon: MetricPolygon;
  widthM?: number;
  heightM?: number;
  gapX?: number;
  gapY?: number;
  marginM?: number;
  phaseY?: number;
  anchorY?: "start" | "center" | "end";
}) {
  const usableRoof = computeUsableRoof({
    roofPolygonM: input.polygon,
    marginM: input.marginM ?? 0,
  });
  return generateGridPlacements({
    usableRoof,
    unit: createRectangularPlacementUnit({
      widthM: input.widthM ?? 1,
      heightM: input.heightM ?? 1,
      gapX: input.gapX ?? 0,
      gapY: input.gapY ?? 0,
    }),
    phaseY: input.phaseY,
    anchorY: input.anchorY,
  });
}

function centers(points: Array<{ x: number; y: number }>) {
  return points
    .map((point) => [Number(point.x.toFixed(9)), Number(point.y.toFixed(9))])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

test("legacy-v1 and geometry-v2 agree on the basic no-margin rectangle", () => {
  const rectangle: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  const legacy = legacyLayout({
    polygon: rectangle,
    widthM: 1,
    heightM: 2,
    spacingM: 0.1,
  });
  const v2 = v2Layout({
    polygon: rectangle,
    widthM: 1,
    heightM: 2,
    gapX: 0.1,
    gapY: 0.1,
  });

  assert.equal(legacy.count, 18);
  assert.equal(v2.count, 18);
  assert.deepEqual(
    centers(legacy.placements.map((item) => ({ x: item.cx, y: item.cy }))),
    centers(v2.placements.map((item) => item.originM)),
  );
});

test("legacy-v1 ignores phaseY while geometry-v2 moves rows", () => {
  const rectangle: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 0, y: 6 },
  ];
  const legacyBaseline = legacyLayout({ polygon: rectangle });
  const legacyPhaseY = legacyLayout({ polygon: rectangle, phaseY: 0.5 });
  const v2Baseline = v2Layout({ polygon: rectangle });
  const v2PhaseY = v2Layout({ polygon: rectangle, phaseY: 0.5 });

  assert.deepEqual(legacyPhaseY.placements, legacyBaseline.placements);
  assert.notDeepEqual(
    centers(v2PhaseY.placements.map((item) => item.originM)),
    centers(v2Baseline.placements.map((item) => item.originM)),
  );
});

test("geometry-v2 keeps both U-roof intervals that legacy-v1 drops", () => {
  const uShape: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 6 },
    { x: 6, y: 6 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 6 },
    { x: 0, y: 6 },
  ];
  const legacy = legacyLayout({ polygon: uShape });
  const v2 = v2Layout({ polygon: uShape });

  assert.equal(legacy.count, 18);
  assert.equal(v2.count, 32);
  assert.deepEqual(
    legacy.placements
      .filter((item) => item.cy === 2.5)
      .map((item) => item.cx),
    [0.5, 1.5],
  );
  assert.deepEqual(
    v2.placements
      .filter((item) => item.originM.y === 2.5)
      .map((item) => item.originM.x),
    [0.5, 1.5, 6.5, 7.5],
  );
});

test("true trapezoid inset intentionally differs from legacy scanline margin", () => {
  const trapezoid: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ];
  const legacy = legacyLayout({ polygon: trapezoid, marginM: 0.5 });
  const v2 = v2Layout({ polygon: trapezoid, marginM: 0.5 });

  assert.equal(legacy.count, 7);
  assert.equal(v2.count, 8);
  assert.notDeepEqual(
    centers(legacy.placements.map((item) => ({ x: item.cx, y: item.cy }))),
    centers(v2.placements.map((item) => item.originM)),
  );
});

test("coverage remains a legacy/application policy outside the v2 kernel", () => {
  const rectangle: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  const legacyHalfCoverage = legacyLayout({
    polygon: rectangle,
    widthM: 1,
    heightM: 2,
    spacingM: 0.1,
    coverageRatio: 0.5,
  });
  const completeV2Kernel = v2Layout({
    polygon: rectangle,
    widthM: 1,
    heightM: 2,
    gapX: 0.1,
    gapY: 0.1,
  });

  assert.equal(legacyHalfCoverage.count, 9);
  assert.equal(completeV2Kernel.count, 18);
});
