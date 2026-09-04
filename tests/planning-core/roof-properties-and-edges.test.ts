import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalLeftEndOfEdge,
  getCanonicalRoofEdges,
  getPitchedRoofEdgeRoles,
  resolveRoofReferenceEdgeIndex,
  resizeRectangularRoof,
} from "../../src/lib/planning-core/geometry-v2";
import { resolveK2ParallelRoofEdgeAlignment } from "../../src/lib/planning-core/advanced/roofEdgeAlignment";
import {
  orderStandardAutoLayoutPlacements,
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardAutoLayoutReferenceFrame,
} from "../../src/components_v2/modules/legacyStandardApplicationPolicy";
import {
  isRoofBuildingPlanningComplete,
  resolveRoofEdgeMarginM,
  resolveRoofSlopeForKind,
  shouldShowRoofFallDirection,
} from "../../src/lib/planning/roofProperties";
import {
  formatRoofSlopeDirection,
  resolveRoofFallAzimuth,
} from "../../src/components_v2/roof/roofOrientation";
import type { RoofArea } from "../../src/types/planner";
import {
  imageVectorFromGeographicAzimuth,
  resolveModuleDownhillAzimuth,
  selectModuleSlopeArrowIds,
} from "../../src/components_v2/modules/panels/moduleSlope";
import {
  buildRoofAnnotationModel,
  normalizeReadableAnnotationAngle,
} from "../../src/components_v2/canvas/roofAnnotationModel";
import {
  clearTransientRoofAnnotationPoints,
  getTransientRoofAnnotationPoints,
  publishTransientRoofAnnotationPoints,
  subscribeTransientRoofAnnotationPoints,
} from "../../src/components_v2/canvas/performance/transientRoofAnnotations";

const rectangle = [
  { x: 10, y: 10 },
  { x: 110, y: 10 },
  { x: 110, y: 70 },
  { x: 10, y: 70 },
];

test("canonical roof edges remove an explicit closing point and the phantom Kante 5", () => {
  const edges = getCanonicalRoofEdges([...rectangle, rectangle[0]]);
  assert.equal(edges.length, 4);
  assert.deepEqual(edges.map((edge) => edge.lengthPx), [100, 60, 100, 60]);
  const almostClosed = [...rectangle, { x: 10.2, y: 10.1 }];
  assert.equal(getCanonicalRoofEdges(almostClosed).length, 4);
});

test("canonical roof edges preserve pentagons and remove duplicate-adjacent vertices", () => {
  const pentagon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 12, y: 7 },
    { x: 5, y: 12 },
    { x: 0, y: 7 },
  ];
  assert.equal(getCanonicalRoofEdges(pentagon).length, 5);
  assert.equal(getCanonicalRoofEdges([pentagon[0], pentagon[0], ...pentagon.slice(1)]).length, 5);
});

test("pitched quadrilateral labels edge zero First without reordering the polygon", () => {
  const roles = getPitchedRoofEdgeRoles({ points: rectangle });
  assert.equal(roles.get(0), "first");
  assert.equal(roles.get(2), "eaves");
  assert.equal(roles.get(1), "gable-right");
  assert.equal(roles.get(3), "gable-left");
  assert.deepEqual(rectangle[0], { x: 10, y: 10 });
});

test("reference edge fallback is edge zero for pitched and longest real edge for flat", () => {
  assert.equal(resolveRoofReferenceEdgeIndex({ points: rectangle, roofKind: "pitched" }), 0);
  assert.equal(resolveRoofReferenceEdgeIndex({ points: rectangle, roofKind: "flat" }), 0);
  assert.equal(resolveRoofReferenceEdgeIndex({ points: rectangle, roofKind: "flat", requestedIndex: 2 }), 2);
  assert.equal(resolveRoofReferenceEdgeIndex({ points: rectangle, roofKind: "flat", requestedIndex: 8 }), 0);
});

test("topology-preserving rectangle resize keeps edge identity and never creates crossing or closure edge", () => {
  const closed = [...rectangle, rectangle[0]];
  const resized = resizeRectangularRoof({
    pointsPx: closed,
    mppImage: 0.1,
    lengthM: 12,
    widthM: 6,
  });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  assert.equal(resized.points.length, 4);
  assert.equal(getCanonicalRoofEdges(resized.points).length, 4);
  assert.equal(resolveRoofReferenceEdgeIndex({
    points: resized.points,
    roofKind: "pitched",
    requestedIndex: 0,
  }), 0);
});

test("explicit flat Referenzkante overrides the rectangle/longest-edge alignment fallback", () => {
  const alignment = resolveK2ParallelRoofEdgeAlignment({
    roofPointsPx: rectangle,
    mppImage: 0.1,
    referenceEdgeIndex: 1,
  });
  assert.equal(alignment?.source, "explicit-reference-edge");
  assert.equal(alignment?.edgeIndex, 1);
  assert.equal(alignment?.faceAzimuthDeg, 90);
});

test("new Standard layout axis starts from the plan-coordinate left end of First", () => {
  const points = [
    { x: 100, y: 20 },
    { x: 20, y: 60 },
    { x: 60, y: 140 },
    { x: 140, y: 100 },
  ];
  const first = getCanonicalRoofEdges(points)[0];
  assert.deepEqual(getCanonicalLeftEndOfEdge(first), points[1]);
  const angle = resolveStandardAutoLayoutCanvasAngle({
    roofId: "roof",
    roofPolygon: points,
    referenceEdgeIndex: 0,
  });
  assert.ok(Math.abs(angle - -26.56505117707799) < 1e-9);

  const frame = resolveStandardAutoLayoutReferenceFrame({
    roofPolygon: points,
    referenceEdgeIndex: 0,
    fallAzimuthDeg: 153.434948822922,
  });
  assert.ok(frame);
  assert.deepEqual(frame.origin, points[1]);
  const at = (along: number, downhill: number, id: string) => ({
    id,
    cx: frame.origin.x + frame.alongFirst.x * along + frame.downhill.x * downhill,
    cy: frame.origin.y + frame.alongFirst.y * along + frame.downhill.y * downhill,
  });
  const ordered = orderStandardAutoLayoutPlacements([
    at(0, 20, "next-row"),
    at(20, 10, "first-row-right"),
    at(0, 10, "first-row-left"),
  ], {
    roofPolygon: points,
    referenceEdgeIndex: 0,
    fallAzimuthDeg: 153.434948822922,
  });
  assert.deepEqual(ordered.map((placement) => placement.id), [
    "first-row-left",
    "first-row-right",
    "next-row",
  ]);
});

test("per-roof edge margin overrides layout/global fallback and survives JSON roundtrip", () => {
  const roof: RoofArea = {
    id: "roof",
    name: "Roof",
    points: rectangle,
    tiltDeg: 20,
    azimuthDeg: 180,
    referenceEdgeIndex: 0,
    edgeMarginM: 0.45,
  };
  assert.equal(resolveRoofEdgeMarginM(roof, 0.2), 0.45);
  const loaded = JSON.parse(JSON.stringify(roof)) as RoofArea;
  assert.equal(loaded.referenceEdgeIndex, 0);
  assert.equal(loaded.edgeMarginM, 0.45);
  assert.deepEqual(isRoofBuildingPlanningComplete({
    roof: loaded,
    roofKind: "pitched",
    standardMarginM: 0.2,
  }), { complete: true, missing: [] });
});

test("fall direction is contextual and an explicit canonical value wins over legacy Sonnendach conversion", () => {
  assert.equal(resolveRoofSlopeForKind("pitched", 0), 0);
  assert.equal(resolveRoofSlopeForKind("pitched", 20), 20);
  assert.equal(resolveRoofSlopeForKind("flat", 20), 0);
  assert.equal(shouldShowRoofFallDirection("pitched", 0), true);
  assert.equal(shouldShowRoofFallDirection("flat", 0), false);
  assert.equal(shouldShowRoofFallDirection("flat", 0.01), false);
  assert.equal(shouldShowRoofFallDirection("flat", 2), false);
  assert.equal(resolveRoofFallAzimuth({ source: "sonnendach", azimuthDeg: 76 }), 256);
  assert.equal(resolveRoofFallAzimuth({
    source: "sonnendach",
    azimuthDeg: 76,
    fallAzimuthDeg: 90,
  }), 90);
});

test("module downhill arrows use geographic azimuth in image coordinates", () => {
  assert.deepEqual(imageVectorFromGeographicAzimuth(0), { x: 0, y: -1 });
  const east = imageVectorFromGeographicAzimuth(90);
  assert.ok(Math.abs(east.x - 1) < 1e-12);
  assert.ok(Math.abs(east.y) < 1e-12);
  const south = imageVectorFromGeographicAzimuth(180);
  assert.ok(Math.abs(south.x) < 1e-12);
  assert.ok(Math.abs(south.y - 1) < 1e-12);
  const west = imageVectorFromGeographicAzimuth(270);
  assert.ok(Math.abs(west.x + 1) < 1e-12);
  assert.ok(Math.abs(west.y) < 1e-12);
});

test("canonical module downhill semantics distinguish roof fall, South high side and opposing pairs", () => {
  assert.equal(resolveModuleDownhillAzimuth({
    kind: "pitched",
    roofFallAzimuthDeg: 180,
  }), 180);
  assert.equal(resolveModuleDownhillAzimuth({
    kind: "flat-south",
    moduleFaceAzimuthDeg: 0,
  }), 180);
  assert.equal(resolveModuleDownhillAzimuth({
    kind: "flat-south",
    moduleFaceAzimuthDeg: 90,
  }), 270);
  assert.equal(resolveModuleDownhillAzimuth({
    kind: "flat-south",
    moduleFaceAzimuthDeg: 180,
  }), 0);

  const left = resolveModuleDownhillAzimuth({
    kind: "flat-opposing",
    blockCenterPx: { x: 100, y: 100 },
    moduleCenterPx: { x: 80, y: 100 },
    moduleFaceAzimuthDeg: 90,
  });
  const right = resolveModuleDownhillAzimuth({
    kind: "flat-opposing",
    blockCenterPx: { x: 100, y: 100 },
    moduleCenterPx: { x: 120, y: 100 },
    moduleFaceAzimuthDeg: 270,
  });
  assert.equal(left, 270);
  assert.equal(right, 90);
  assert.equal(((right! - left!) + 360) % 360, 180);
});

test("module downhill arrows are limited to the first three modules of every rotated row", () => {
  const angleDeg = 37;
  const radians = angleDeg * Math.PI / 180;
  const world = (u: number, v: number) => ({
    x: u * Math.cos(radians) - v * Math.sin(radians),
    y: u * Math.sin(radians) + v * Math.cos(radians),
  });
  const modules = [0, 1].flatMap((row) =>
    [0, 1, 2, 3, 4].map((column) => ({
      id: `r${row}c${column}`,
      ...world(column * 12, row * 20),
      hPx: 10,
    })),
  ).map(({ id, x, y, hPx }) => ({ id, cx: x, cy: y, hPx }));

  const selected = selectModuleSlopeArrowIds({
    modules: [...modules].reverse(),
    rowAxisCanvasDeg: angleDeg,
  });

  assert.deepEqual([...selected].sort(), [
    "r0c0", "r0c1", "r0c2",
    "r1c0", "r1c1", "r1c2",
  ]);
});

test("roof annotation model derives four semantic pitched edges without a phantom closing edge", () => {
  const model = buildRoofAnnotationModel({
    points: [...rectangle, rectangle[0]],
    mppImage: 0.1,
    roofKind: "pitched",
    tiltDeg: 20,
    fallAzimuthDeg: 180,
    referenceEdgeIndex: 0,
  });
  assert.equal(model.edges.length, 4);
  assert.deepEqual(model.edges.map((edge) => edge.label.split(" · ")[0]), [
    "FIRST", "ORTGANG RECHTS", "TRAUFE", "ORTGANG LINKS",
  ]);
  assert.equal(model.edges.filter((edge) => edge.isReference).length, 1);
});

test("roof annotation model keeps every real pentagon edge and readable label rotations", () => {
  const pentagon = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 7 },
    { x: 5, y: 12 }, { x: 0, y: 7 },
  ];
  const model = buildRoofAnnotationModel({
    points: pentagon,
    mppImage: 0.1,
    roofKind: "flat",
    referenceEdgeIndex: 0,
  });
  assert.equal(model.edges.length, 5);
  assert.equal(model.edges[0].label.startsWith("REFERENZKANTE"), true);
  assert.equal(model.edges.every((edge) => Math.abs(edge.readableAngleDeg) <= 90), true);
  assert.equal(normalizeReadableAnnotationAngle(190), 10);
});

test("compact pitched-roof info uses canonical German fall direction", () => {
  assert.equal(formatRoofSlopeDirection(25, 180), "25° · Süd");
  assert.equal(formatRoofSlopeDirection(18, 90), "18° · Ost");
});

test("transient roof annotations update independently from persisted roof state", () => {
  let notifications = 0;
  const unsubscribe = subscribeTransientRoofAnnotationPoints("roof", () => notifications += 1);
  const points = rectangle.map((point) => ({ x: point.x + 7, y: point.y - 3 }));
  publishTransientRoofAnnotationPoints("roof", points);
  assert.deepEqual(getTransientRoofAnnotationPoints("roof"), points);
  clearTransientRoofAnnotationPoints("roof");
  assert.equal(getTransientRoofAnnotationPoints("roof"), null);
  assert.equal(notifications, 2);
  unsubscribe();
});
