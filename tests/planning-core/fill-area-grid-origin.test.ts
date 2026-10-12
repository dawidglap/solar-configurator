import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAdvancedBlockLayout,
  createK2DDomeBlock,
} from "../../src/lib/planning-core/advanced";
import {
  computeUsableRoof,
  generateGridPlacements,
  polygonBounds,
  rotateMetricPoint,
  validatePlacementFootprint,
  type MetricPoint,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";
import { computeLegacyStandardLayout } from "../../src/lib/planning-core/legacy-standard";

const RECT: MetricPolygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

const UNIT = {
  footprint: [
    { x: -1, y: -0.5 },
    { x: 1, y: -0.5 },
    { x: 1, y: 0.5 },
    { x: -1, y: 0.5 },
  ],
  pitchM: { x: 2.2, y: 1.2 },
};

function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} != ${expected}`);
}

function hasFootprintCorner(footprint: MetricPolygon, point: MetricPoint) {
  return footprint.some((corner) =>
    Math.abs(corner.x - point.x) < 1e-8 && Math.abs(corner.y - point.y) < 1e-8,
  );
}

test("zero-margin fill starts the first full footprint exactly at pointer-down", () => {
  const usableRoof = computeUsableRoof({ roofPolygonM: RECT, marginM: 0 });
  const layout = generateGridPlacements({
    usableRoof,
    unit: UNIT,
    fillBoundaryM: { start: { x: 0, y: 0 }, end: { x: 8, y: 6 } },
  });
  assert.ok(layout.placements.length > 0);
  assert.ok(layout.placements.some((placement) =>
    hasFootprintCorner(placement.footprint, { x: 0, y: 0 }),
  ));
  assert.ok(layout.placements.every((placement) =>
    validatePlacementFootprint({ footprint: placement.footprint, usableRoof }).valid,
  ));
});

test("uniform and per-edge Randabstand are applied once, with no fill inset", () => {
  const uniform = computeUsableRoof({ roofPolygonM: RECT, marginM: 0.2 });
  const uniformLayout = generateGridPlacements({
    usableRoof: uniform,
    unit: UNIT,
    fillBoundaryM: { start: { x: 0.2, y: 0.2 }, end: { x: 9, y: 7 } },
  });
  assert.ok(uniformLayout.placements.some((placement) =>
    hasFootprintCorner(placement.footprint, { x: 0.2, y: 0.2 }),
  ));

  const perEdge = computeUsableRoof({
    roofPolygonM: RECT,
    marginM: 0,
    edgeMarginsM: [0.3, 0.6, 0.8, 0.4],
  });
  const perEdgeLayout = generateGridPlacements({
    usableRoof: perEdge,
    unit: UNIT,
    fillBoundaryM: { start: { x: 0.4, y: 0.3 }, end: { x: 9, y: 7 } },
  });
  assert.ok(perEdgeLayout.placements.some((placement) =>
    hasFootprintCorner(placement.footprint, { x: 0.4, y: 0.3 }),
  ));
});

test("module gap occurs only between modules and an exact three-column area keeps all three", () => {
  const roof: MetricPolygon = [
    { x: 0, y: 0 }, { x: 6.4, y: 0 }, { x: 6.4, y: 2 }, { x: 0, y: 2 },
  ];
  const usableRoof = computeUsableRoof({ roofPolygonM: roof, marginM: 0 });
  const layout = generateGridPlacements({
    usableRoof,
    unit: UNIT,
    fillBoundaryM: { start: { x: 0, y: 0 }, end: { x: 6.4, y: 2 } },
  });
  const xBounds = layout.placements.map((placement) => polygonBounds(placement.footprint));
  assert.equal(layout.placements.length, 3);
  assert.deepEqual(xBounds.map((bounds) => Number(bounds.minX.toFixed(8))), [0, 2.2, 4.4]);
  close(xBounds.at(-1)!.maxX, 6.4);
});

test("reverse drag anchors the opposite outer footprint corner at pointer-down", () => {
  const usableRoof = computeUsableRoof({ roofPolygonM: RECT, marginM: 0 });
  const layout = generateGridPlacements({
    usableRoof,
    unit: UNIT,
    fillBoundaryM: { start: { x: 10, y: 8 }, end: { x: 0, y: 0 } },
  });
  assert.ok(layout.placements.some((placement) =>
    hasFootprintCorner(placement.footprint, { x: 10, y: 8 }),
  ));
});

test("rotated fill uses the clicked point in the grid-local coordinate system", () => {
  const angle = 31;
  const rotatedRoof = RECT.map((point) => rotateMetricPoint(point, angle));
  const start = rotateMetricPoint({ x: 0, y: 0 }, angle);
  const end = rotateMetricPoint({ x: 9, y: 7 }, angle);
  const usableRoof = computeUsableRoof({ roofPolygonM: rotatedRoof, marginM: 0 });
  const layout = generateGridPlacements({
    usableRoof,
    unit: UNIT,
    rotationCartesianDeg: angle,
    fillBoundaryM: { start, end },
  });
  assert.ok(layout.placements.some((placement) => hasFootprintCorner(placement.footprint, start)));
});

test("obstacles remain canonical validation constraints around an origin-aligned fill", () => {
  const usableRoof = computeUsableRoof({ roofPolygonM: RECT, marginM: 0 });
  const obstacle: MetricPolygon = [
    { x: 2.1, y: 0 }, { x: 4.3, y: 0 }, { x: 4.3, y: 8 }, { x: 2.1, y: 8 },
  ];
  const layout = generateGridPlacements({
    usableRoof,
    unit: UNIT,
    fillBoundaryM: { start: { x: 0, y: 0 }, end: { x: 10, y: 8 } },
    reservedZones: [{ id: "obstacle", polygon: obstacle }],
  });
  assert.ok(layout.placements.length > 0);
  assert.ok(layout.rejected["reserved-zone"] > 0);
  assert.ok(layout.placements.every((placement) =>
    validatePlacementFootprint({
      footprint: placement.footprint,
      usableRoof,
      reservedZones: [{ id: "obstacle", polygon: obstacle }],
    }).valid,
  ));
});

test("legacy Standard generation receives the exact fill origin without a half-cell or gap", () => {
  const layout = computeLegacyStandardLayout({
    generation: {
      roofPolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
      mppImage: 0.1,
      canvasAngleDeg: 0,
      orientation: "portrait",
      panelSizeM: { widthM: 1, heightM: 2 },
      spacingM: 0.1,
      marginM: 0,
      edgeMarginsM: [0, 0, 0, 0],
      fillBoundary: { start: { x: 0, y: 0 }, end: { x: 32, y: 40 } },
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });
  const firstRow = layout.placements
    .filter((candidate) => Math.abs(candidate.cy - 10) < 1e-8)
    .slice(0, 3);
  assert.deepEqual(firstRow.map((candidate) => candidate.cx - candidate.wPx / 2), [0, 11, 22]);
});

test("D-Dome aligns the complete physical block boundary and preserves both slots", () => {
  const adapter = createK2DDomeBlock({
    module: { widthM: 1.134, heightM: 1.722, orientation: "landscape" },
    rowSpaceM: 2.6,
    primaryFaceAzimuthDeg: 90,
  });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const layout = computeAdvancedBlockLayout({
    roofPolygonM: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }],
    marginM: 0,
    blockDefinition: adapter.definition,
    fillBoundaryM: { start: { x: 0, y: 0 }, end: { x: 20, y: 12 } },
  });
  const boundaryBlock = layout.blocks.find((block) => {
    const bounds = polygonBounds(block.footprint);
    return Math.abs(bounds.minX) < 1e-8 && Math.abs(bounds.minY) < 1e-8;
  });
  assert.ok(boundaryBlock);
  const slots = layout.modules
    .filter((module) => module.blockKey === boundaryBlock.blockKey)
    .map((module) => module.slotIndex)
    .sort();
  assert.deepEqual(slots, [0, 1]);
});
