import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasAngleToCartesianDeg,
  computeUsableRoof,
  createRectangularPlacementUnit,
  generateGridPlacements,
  geographicAzimuthToCartesianDeg,
  imagePointToMetric,
  metricPointToImage,
  polygonArea,
  polygonBounds,
  rotateMetricPoint,
  transformMetricPolygon,
  validatePlacementFootprint,
  type MetricPoint,
  type MetricPolygon,
  type PlacementUnitGeometry,
} from "../../src/lib/planning-core/geometry-v2";

const EPSILON = 1e-6;

const RECTANGLE: MetricPolygon = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 4 },
  { x: 0, y: 4 },
];

const L_SHAPE: MetricPolygon = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 6 },
  { x: 0, y: 6 },
];

const U_SHAPE: MetricPolygon = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 6 },
  { x: 6, y: 6 },
  { x: 6, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 6 },
  { x: 0, y: 6 },
];

function close(
  actual: number,
  expected: number,
  label: string,
  tolerance = EPSILON,
) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function validRoof(polygon: MetricPolygon, marginM = 0) {
  const result = computeUsableRoof({ roofPolygonM: polygon, marginM });
  assert.equal(result.status, "valid");
  return result;
}

function squareFootprint(center: MetricPoint, sizeM: number, rotation = 0) {
  return transformMetricPolygon(
    createRectangularPlacementUnit({
      widthM: sizeM,
      heightM: sizeM,
      gapX: 0,
      gapY: 0,
    }).footprint,
    { translationM: center, rotationCartesianDeg: rotation },
  );
}

function sortedUnique(values: number[]) {
  return [...new Set(values.map((value) => Number(value.toFixed(9))))].sort(
    (a, b) => a - b,
  );
}

test("Geometry v2 uses explicit metric Cartesian/image conversion", () => {
  const adapter = { mppImage: 0.1, metricOriginPx: { x: 100, y: 200 } };
  const metric = imagePointToMetric({ x: 130, y: 170 }, adapter);
  assert.deepEqual(metric, { x: 3, y: 3 });
  assert.deepEqual(metricPointToImage(metric, adapter), { x: 130, y: 170 });
  assert.equal(geographicAzimuthToCartesianDeg(0), 90);
  assert.equal(geographicAzimuthToCartesianDeg(90), 0);
  assert.equal(canvasAngleToCartesianDeg(30), 330);
});

test("A. convex rectangle receives a true 0.5 m inset", () => {
  const usable = validRoof(RECTANGLE, 0.5);
  assert.equal(usable.components.length, 1);
  assert.deepEqual(polygonBounds(usable.components[0]), {
    minX: 0.5,
    minY: 0.5,
    maxX: 5.5,
    maxY: 3.5,
  });
  close(polygonArea(usable.components[0]), 15, "inset rectangle area");
});

test("B. rotated rectangle inset is rotation-independent in metric space", () => {
  const center = { x: 3, y: 2 };
  const rotated = RECTANGLE.map((point) => {
    const local = { x: point.x - center.x, y: point.y - center.y };
    const next = rotateMetricPoint(local, 31);
    return { x: next.x + center.x, y: next.y + center.y };
  });
  const usable = validRoof(rotated, 0.5);
  const unrotatedInset = usable.components[0].map((point) => {
    const local = { x: point.x - center.x, y: point.y - center.y };
    const next = rotateMetricPoint(local, -31);
    return { x: next.x + center.x, y: next.y + center.y };
  });
  const bounds = polygonBounds(unrotatedInset);
  close(bounds.minX, 0.5, "rotated inset minX");
  close(bounds.maxX, 5.5, "rotated inset maxX");
  close(bounds.minY, 0.5, "rotated inset minY");
  close(bounds.maxY, 3.5, "rotated inset maxY");
  close(polygonArea(usable.components[0]), 15, "rotated inset area", 1e-5);
});

test("C. trapezoid inset offsets its diagonal sides", () => {
  const trapezoid: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ];
  const usable = validRoof(trapezoid, 0.5);
  const points = usable.components[0];
  const bottom = points.filter((point) => Math.abs(point.y - 0.5) <= EPSILON);
  const top = points.filter((point) => Math.abs(point.y - 3.5) <= EPSILON);

  assert.equal(bottom.length, 2);
  assert.equal(top.length, 2);
  close(Math.min(...bottom.map((point) => point.x)), 0.640388, "bottom left");
  close(Math.max(...bottom.map((point) => point.x)), 5.359612, "bottom right");
  close(Math.min(...top.map((point) => point.x)), 1.390388, "top left");
  close(Math.max(...top.map((point) => point.x)), 4.609612, "top right");
});

test("D. L-shaped roof keeps placements on both branches", () => {
  const result = generateGridPlacements({
    usableRoof: validRoof(L_SHAPE),
    unit: createRectangularPlacementUnit({
      widthM: 1,
      heightM: 1,
      gapX: 0,
      gapY: 0,
    }),
  });
  assert.equal(result.count, 20);
  assert.ok(result.placements.some((placement) => placement.originM.x === 5.5));
  assert.ok(result.placements.some((placement) => placement.originM.y === 5.5));
});

test("E/N. U-shaped roof uses both valid intervals in the same row", () => {
  const result = generateGridPlacements({
    usableRoof: validRoof(U_SHAPE),
    unit: createRectangularPlacementUnit({
      widthM: 1,
      heightM: 1,
      gapX: 0,
      gapY: 0,
    }),
  });
  assert.equal(result.count, 32);
  assert.deepEqual(
    result.placements
      .filter((placement) => placement.originM.y === 2.5)
      .map((placement) => placement.originM.x),
    [0.5, 1.5, 6.5, 7.5],
  );

  const inset = validRoof(U_SHAPE, 0.25);
  assert.equal(inset.components.length, 1);
  assert.ok(polygonArea(inset.components[0]) < polygonArea(U_SHAPE));
});

test("F. an excessive margin returns empty with a diagnostic", () => {
  const result = computeUsableRoof({
    roofPolygonM: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    marginM: 1,
  });
  assert.equal(result.status, "empty");
  assert.deepEqual(result.components, []);
  assert.equal(result.diagnostics[0]?.code, "margin-consumed-roof");
});

test("a concave inset may return multiple deterministic usable components", () => {
  const narrowNeckRoof: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1.25 },
    { x: 5, y: 1.25 },
    { x: 5, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 3 },
    { x: 5, y: 3 },
    { x: 5, y: 1.75 },
    { x: 3, y: 1.75 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  const result = validRoof(narrowNeckRoof, 0.3);

  assert.equal(result.components.length, 2);
  assert.deepEqual(result.components.map(polygonBounds), [
    { minX: 0.3, minY: 0.3, maxX: 2.7, maxY: 2.7 },
    { minX: 5.3, minY: 0.3, maxX: 7.7, maxY: 2.7 },
  ]);
});

test("G/H. phaseX and phaseY independently shift columns and rows", () => {
  const roof = validRoof(RECTANGLE);
  const unit = createRectangularPlacementUnit({
    widthM: 1,
    heightM: 1,
    gapX: 0.5,
    gapY: 0.5,
  });
  const baseline = generateGridPlacements({ usableRoof: roof, unit });
  const phaseX = generateGridPlacements({ usableRoof: roof, unit, phaseX: 0.25 });
  const phaseY = generateGridPlacements({ usableRoof: roof, unit, phaseY: 0.25 });

  assert.notDeepEqual(
    sortedUnique(phaseX.placements.map((item) => item.originM.x)),
    sortedUnique(baseline.placements.map((item) => item.originM.x)),
  );
  assert.deepEqual(
    sortedUnique(phaseX.placements.map((item) => item.originM.y)),
    sortedUnique(baseline.placements.map((item) => item.originM.y)),
  );
  assert.notDeepEqual(
    sortedUnique(phaseY.placements.map((item) => item.originM.y)),
    sortedUnique(baseline.placements.map((item) => item.originM.y)),
  );
  assert.deepEqual(
    sortedUnique(phaseY.placements.map((item) => item.originM.x)),
    sortedUnique(baseline.placements.map((item) => item.originM.x)),
  );
});

test("I. start, center and end anchors are deterministic on X and Y", () => {
  const roof = validRoof([
    { x: 0, y: 0 },
    { x: 5.2, y: 0 },
    { x: 5.2, y: 5.2 },
    { x: 0, y: 5.2 },
  ]);
  const unit = createRectangularPlacementUnit({
    widthM: 1,
    heightM: 1,
    gapX: 0.5,
    gapY: 0.5,
  });
  const axis = (anchorX: "start" | "center" | "end", anchorY = anchorX) => {
    const result = generateGridPlacements({ usableRoof: roof, unit, anchorX, anchorY });
    return {
      x: sortedUnique(result.placements.map((item) => item.originM.x)),
      y: sortedUnique(result.placements.map((item) => item.originM.y)),
    };
  };

  assert.deepEqual(axis("start"), { x: [0.5, 2, 3.5], y: [0.5, 2, 3.5] });
  assert.deepEqual(axis("center"), { x: [1.1, 2.6, 4.1], y: [1.1, 2.6, 4.1] });
  assert.deepEqual(axis("end"), { x: [1.7, 3.2, 4.7], y: [1.7, 3.2, 4.7] });
});

test("J. gapX changes only X pitch and gapY changes only Y pitch", () => {
  const roof = validRoof([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  const generate = (gapX: number, gapY: number) =>
    generateGridPlacements({
      usableRoof: roof,
      unit: createRectangularPlacementUnit({ widthM: 1, heightM: 1, gapX, gapY }),
    }).placements;
  const baseline = generate(0.5, 0.25);
  const xChanged = generate(0.8, 0.25);
  const yChanged = generate(0.5, 0.75);

  assert.notDeepEqual(
    sortedUnique(xChanged.map((item) => item.originM.x)),
    sortedUnique(baseline.map((item) => item.originM.x)),
  );
  assert.deepEqual(
    sortedUnique(xChanged.map((item) => item.originM.y)),
    sortedUnique(baseline.map((item) => item.originM.y)),
  );
  assert.deepEqual(
    sortedUnique(yChanged.map((item) => item.originM.x)),
    sortedUnique(baseline.map((item) => item.originM.x)),
  );
  assert.notDeepEqual(
    sortedUnique(yChanged.map((item) => item.originM.y)),
    sortedUnique(baseline.map((item) => item.originM.y)),
  );
});

test("K. generic footprint containment handles inside, crossing, contact and outside", () => {
  const roof = validRoof([
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ]);
  const validate = (footprint: MetricPolygon) =>
    validatePlacementFootprint({ footprint, usableRoof: roof });

  assert.equal(validate(squareFootprint({ x: 2, y: 2 }, 2)).valid, true);
  assert.equal(validate(squareFootprint({ x: 3.5, y: 2 }, 2)).valid, false);
  assert.equal(validate(squareFootprint({ x: 3.25, y: 2 }, 2, 45)).valid, false);
  assert.equal(validate(squareFootprint({ x: 3, y: 2 }, 2)).valid, true);
  assert.equal(validate(squareFootprint({ x: 6, y: 2 }, 1)).valid, false);
});

test("L/M. reserved overlap and edge contact both reject the footprint", () => {
  const roof = validRoof(RECTANGLE);
  const reserved = {
    polygon: [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
    ],
  };

  const cornerOverlap = validatePlacementFootprint({
    footprint: squareFootprint({ x: 1.75, y: 0.75 }, 1),
    usableRoof: roof,
    reservedZones: [reserved],
  });
  const edgeContact = validatePlacementFootprint({
    footprint: squareFootprint({ x: 1.5, y: 1.5 }, 1),
    usableRoof: roof,
    reservedZones: [reserved],
  });
  const containsReserved = validatePlacementFootprint({
    footprint: squareFootprint({ x: 2.5, y: 1.5 }, 3),
    usableRoof: roof,
    reservedZones: [reserved],
  });
  const insideReserved = validatePlacementFootprint({
    footprint: squareFootprint({ x: 2.5, y: 1.5 }, 0.5),
    usableRoof: roof,
    reservedZones: [reserved],
  });

  assert.deepEqual(cornerOverlap.reasons, ["reserved-zone"]);
  assert.deepEqual(edgeContact.reasons, ["reserved-zone"]);
  assert.ok(containsReserved.reasons.includes("reserved-zone"));
  assert.deepEqual(insideReserved.reasons, ["reserved-zone"]);
});

test("snow guard segment and explicit clearance use the generic collision layer", () => {
  const roof = validRoof(RECTANGLE);
  const footprint = squareFootprint({ x: 2, y: 2 }, 1);
  const crossing = validatePlacementFootprint({
    footprint,
    usableRoof: roof,
    snowGuards: [
      { start: { x: 1, y: 2 }, end: { x: 3, y: 2 }, clearanceM: 0 },
    ],
  });
  const clearanceContact = validatePlacementFootprint({
    footprint,
    usableRoof: roof,
    snowGuards: [
      { start: { x: 1, y: 2.7 }, end: { x: 3, y: 2.7 }, clearanceM: 0.2 },
    ],
  });
  assert.deepEqual(crossing.reasons, ["snow-guard"]);
  assert.deepEqual(clearanceContact.reasons, ["snow-guard"]);
});

test("a non-rectangular placement unit uses the same polygon validation", () => {
  const triangularUnit: PlacementUnitGeometry = {
    footprint: [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0, y: 0.5 },
    ],
    pitchM: { x: 1.25, y: 1.25 },
  };
  const result = generateGridPlacements({
    usableRoof: validRoof(RECTANGLE),
    unit: triangularUnit,
  });
  assert.ok(result.count > 0);
  assert.ok(result.placements.every((placement) => placement.footprint.length === 3));
});
