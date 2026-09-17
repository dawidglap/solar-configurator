import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  alignPolygonToRoofReference,
  createRoofContainmentSnapshot,
  createRoofRelativeRectangle,
  GEOMETRY_V2_ENGINE_VERSION,
  isFootprintContainedInUsableRoof,
  orthogonalizePolygonToRoofReference,
  resolveContainedPolygonTranslation,
  translateRoofOwnedPolygon,
  validatePlacementFootprint,
} from "../../src/lib/planning-core/geometry-v2";
import { moveZoneVertex } from "../../src/components_v2/zones/zoneVertexEditing";
import { usePlannerV2Store } from "../../src/components_v2/state/plannerV2Store";

type Pt = { x: number; y: number };

function rotatedRectangle(width: number, height: number, angleDeg: number, center = { x: 50, y: 50 }): Pt[] {
  const angle = angleDeg * Math.PI / 180;
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  return [
    { x: center.x - u.x * width / 2 - v.x * height / 2, y: center.y - u.y * width / 2 - v.y * height / 2 },
    { x: center.x + u.x * width / 2 - v.x * height / 2, y: center.y + u.y * width / 2 - v.y * height / 2 },
    { x: center.x + u.x * width / 2 + v.x * height / 2, y: center.y + u.y * width / 2 + v.y * height / 2 },
    { x: center.x - u.x * width / 2 + v.x * height / 2, y: center.y - u.y * width / 2 + v.y * height / 2 },
  ];
}

function edgeAngle(points: Pt[]): number {
  return Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180 / Math.PI;
}

test("quick rectangle on a 37 degree pitched roof is parallel to First", () => {
  const roof = rotatedRectangle(80, 50, 37);
  const result = createRoofRelativeRectangle({
    dragStart: { x: 38, y: 38 },
    dragEnd: { x: 59, y: 60 },
    ownerRoofPoints: roof,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
  });
  assert.equal(result.valid, true);
  assert.ok(Math.abs(edgeAngle(result.points) - 37) < 1e-9);
});

test("flat quick rectangle follows the explicitly selected Kante 3", () => {
  const roof = rotatedRectangle(80, 50, 12);
  const result = createRoofRelativeRectangle({
    dragStart: { x: 42, y: 42 },
    dragEnd: { x: 62, y: 58 },
    ownerRoofPoints: roof,
    roofKind: "flat",
    referenceEdgeIndex: 2,
  });
  assert.equal(result.valid, true);
  const angle = ((edgeAngle(result.points) % 180) + 180) % 180;
  assert.ok(Math.abs(angle - 12) < 1e-9);
});

test("roof-local geometry is independent of viewport pan and zoom", () => {
  const roof = rotatedRectangle(100, 70, 29);
  const worldStart = { x: 38, y: 37 };
  const worldEnd = { x: 63, y: 61 };
  const throughViewport = (point: Pt, viewport: { scale: number; x: number; y: number }): Pt => {
    const screen = {
      x: viewport.x + point.x * viewport.scale,
      y: viewport.y + point.y * viewport.scale,
    };
    return {
      x: (screen.x - viewport.x) / viewport.scale,
      y: (screen.y - viewport.y) / viewport.scale,
    };
  };
  const resultFor = (viewport: { scale: number; x: number; y: number }) => createRoofRelativeRectangle({
    dragStart: throughViewport(worldStart, viewport),
    dragEnd: throughViewport(worldEnd, viewport),
    ownerRoofPoints: roof,
    roofKind: "pitched" as const,
    referenceEdgeIndex: 0,
  });
  const first = resultFor({ scale: 0.7, x: -120, y: 85 });
  const second = resultFor({ scale: 4.2, x: 760, y: -310 });
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  first.points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - second.points[index].x) < 1e-9);
    assert.ok(Math.abs(point.y - second.points[index].y) < 1e-9);
  });
});

test("quick rectangle refuses a release that crosses the owner roof boundary", () => {
  const roof = rotatedRectangle(40, 30, 18);
  const result = createRoofRelativeRectangle({
    dragStart: { x: 48, y: 48 },
    dragEnd: { x: 90, y: 90 },
    ownerRoofPoints: roof,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "outside-owner-roof");
});

test("rigid move translates every vertex equally and rejects an outside release", () => {
  const roof = rotatedRectangle(100, 80, 0);
  const zone = rotatedRectangle(20, 10, 0);
  const moved = translateRoofOwnedPolygon({ points: zone, delta: { x: 7, y: -4 }, ownerRoofPoints: roof });
  assert.equal(moved.valid, true);
  moved.points.forEach((point, index) => {
    assert.equal(point.x - zone[index].x, 7);
    assert.equal(point.y - zone[index].y, -4);
  });
  const invalid = translateRoofOwnedPolygon({ points: zone, delta: { x: 100, y: 0 }, ownerRoofPoints: roof });
  assert.equal(invalid.valid, false);
});

test("whole-obstacle drag stops against all four rectangular roof edges", () => {
  const roof = rotatedRectangle(100, 80, 0);
  const zone = rotatedRectangle(20, 10, 0);
  const snapshot = createRoofContainmentSnapshot(roof);
  const cases = [
    { requestedDelta: { x: -200, y: 0 }, expected: { x: -40, y: 0 } },
    { requestedDelta: { x: 200, y: 0 }, expected: { x: 40, y: 0 } },
    { requestedDelta: { x: 0, y: -200 }, expected: { x: 0, y: -35 } },
    { requestedDelta: { x: 0, y: 200 }, expected: { x: 0, y: 35 } },
  ];
  cases.forEach(({ requestedDelta, expected }) => {
    const result = resolveContainedPolygonTranslation({ points: zone, requestedDelta, snapshot });
    assert.equal(result.valid, true);
    assert.ok(Math.abs(result.delta.x - expected.x) < 1e-5);
    assert.ok(Math.abs(result.delta.y - expected.y) < 1e-5);
    assert.equal(isFootprintContainedInUsableRoof(result.points, [[...roof]]), true);
  });
});

test("diagonal drag reaches the corner and subsequent motion slides along the roof edge", () => {
  const roof = rotatedRectangle(100, 80, 0);
  const zone = rotatedRectangle(20, 10, 0);
  const snapshot = createRoofContainmentSnapshot(roof);
  const corner = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: 200, y: 175 },
    snapshot,
  });
  assert.equal(corner.valid, true);
  assert.ok(Math.abs(corner.delta.x - 40) < 1e-5);
  assert.ok(Math.abs(corner.delta.y - 35) < 1e-5);

  const atLeftWall = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: -100, y: 0 },
    snapshot,
  });
  assert.equal(atLeftWall.valid, true);
  const slid = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: -100, y: 22 },
    previousValidDelta: atLeftWall.delta,
    snapshot,
  });
  assert.equal(slid.valid, true);
  assert.ok(Math.abs(slid.delta.x + 40) < 1e-5);
  assert.ok(Math.abs(slid.delta.y - 22) < 1e-5);
});

test("containment follows trapezoid and multi-edge roof polygons rather than their bounding boxes", () => {
  const trapezoid = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 75, y: 80 }, { x: 25, y: 80 },
  ];
  const zone = rotatedRectangle(12, 10, 0, { x: 50, y: 40 });
  const trapezoidResult = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: 60, y: 20 },
    snapshot: createRoofContainmentSnapshot(trapezoid),
  });
  assert.equal(trapezoidResult.valid, true);
  assert.equal(isFootprintContainedInUsableRoof(trapezoidResult.points, [[...trapezoid]]), true);
  assert.ok(trapezoidResult.delta.x < 44, "the sloped edge constrains before the bbox edge");

  const hexagon = [
    { x: 10, y: 0 }, { x: 90, y: 0 }, { x: 110, y: 40 },
    { x: 90, y: 90 }, { x: 10, y: 90 }, { x: -10, y: 40 },
  ];
  const polygonResult = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: -100, y: 24 },
    snapshot: createRoofContainmentSnapshot(hexagon),
  });
  assert.equal(polygonResult.valid, true);
  assert.equal(isFootprintContainedInUsableRoof(polygonResult.points, [[...hexagon]]), true);
});

test("roof ownership wins over an adjacent roof and is viewport-rotation independent", () => {
  const owner = rotatedRectangle(100, 80, 0);
  const adjacent = rotatedRectangle(100, 80, 0, { x: 150, y: 50 });
  const zone = rotatedRectangle(20, 10, 0);
  const snapshot = createRoofContainmentSnapshot(owner);
  const direct = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: { x: 110, y: 0 },
    snapshot,
  });
  assert.equal(direct.valid, true);
  assert.ok(Math.abs(direct.delta.x - 40) < 1e-5);
  assert.equal(isFootprintContainedInUsableRoof(direct.points, [[...adjacent]]), false);

  const angle = 71 * Math.PI / 180;
  const rotate = (point: Pt): Pt => ({
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  });
  const unrotate = (point: Pt): Pt => ({
    x: point.x * Math.cos(angle) + point.y * Math.sin(angle),
    y: -point.x * Math.sin(angle) + point.y * Math.cos(angle),
  });
  const physicalDelta = { x: 110, y: 18 };
  const reconstructed = unrotate(rotate(physicalDelta));
  const rotatedViewportResult = resolveContainedPolygonTranslation({
    points: zone,
    requestedDelta: reconstructed,
    snapshot,
  });
  assert.equal(rotatedViewportResult.valid, true);
  assert.ok(Math.abs(rotatedViewportResult.delta.x - 40) < 1e-5);
  assert.ok(Math.abs(rotatedViewportResult.delta.y - 18) < 1e-5);
});

test("vertex editing rejects an edge that crosses outside a concave owner roof", () => {
  const concaveRoof = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 },
    { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 },
  ];
  const zone = [{ x: 8, y: 8 }, { x: 25, y: 8 }, { x: 25, y: 24 }, { x: 8, y: 24 }];
  const result = moveZoneVertex({
    points: zone,
    vertexIndex: 2,
    requestedPoint: { x: 82, y: 82 },
    ownerRoof: concaveRoof,
    disableSnap: true,
  });
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.reason, "outside-owner-roof");
  assert.deepEqual(result.points, zone);
});

test("600 pointer samples remain transient and produce one simulated final commit", () => {
  const roof = rotatedRectangle(100, 80, 0);
  const zone = rotatedRectangle(20, 10, 0);
  const snapshot = createRoofContainmentSnapshot(roof);
  let previous = { x: 0, y: 0 };
  let storeCommits = 0;
  for (let index = 0; index < 600; index += 1) {
    const result = resolveContainedPolygonTranslation({
      points: zone,
      requestedDelta: { x: index / 4, y: Math.sin(index / 20) * 20 },
      previousValidDelta: previous,
      snapshot,
    });
    if (result.valid) previous = result.delta;
    assert.equal(storeCommits, 0);
  }
  storeCommits += 1;
  assert.equal(storeCommits, 1);

  const source = readFileSync(
    new URL("../../src/components_v2/zones/MovableZone.tsx", import.meta.url),
    "utf8",
  );
  const frameBody = source.slice(
    source.indexOf("frameRef.current = createLatestFrameScheduler"),
    source.indexOf("stage.off(\".zone-move\")"),
  );
  assert.equal(frameBody.includes("onChange("), false);
  assert.equal(frameBody.includes("history.push"), false);
  assert.ok(source.includes('stage.on("pointercancel.zone-move touchcancel.zone-move", () => endMove(false))'));
  assert.ok(source.includes('const onBlur = () => endMove(false)'));
  assert.ok(source.includes('if (event.key !== "Escape" || !movingRef.current) return'));
});

test("reference-aligned orthogonalization creates a valid rectangle without changing owner", () => {
  const roof = rotatedRectangle(120, 90, 22);
  const irregular = [
    { x: 38, y: 38 },
    { x: 61, y: 44 },
    { x: 60, y: 59 },
    { x: 36, y: 54 },
  ];
  const result = orthogonalizePolygonToRoofReference({
    points: irregular,
    ownerRoofPoints: roof,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
  });
  assert.equal(result.valid, true);
  assert.equal(result.points.length, 4);
  const first = { x: result.points[1].x - result.points[0].x, y: result.points[1].y - result.points[0].y };
  const second = { x: result.points[2].x - result.points[1].x, y: result.points[2].y - result.points[1].y };
  assert.ok(Math.abs(first.x * second.x + first.y * second.y) < 1e-8);
});

test("parallel alignment is rigid and invalid roof exits are not committed", () => {
  const roof = rotatedRectangle(120, 90, 30);
  const zone = rotatedRectangle(20, 10, 4);
  const result = alignPolygonToRoofReference({
    points: zone,
    ownerRoofPoints: roof,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
  });
  assert.equal(result.valid, true);
  const beforeLengths = zone.map((point, index) => Math.hypot(
    zone[(index + 1) % zone.length].x - point.x,
    zone[(index + 1) % zone.length].y - point.y,
  ));
  const afterLengths = result.points.map((point, index) => Math.hypot(
    result.points[(index + 1) % result.points.length].x - point.x,
    result.points[(index + 1) % result.points.length].y - point.y,
  ));
  beforeLengths.forEach((length, index) => assert.ok(Math.abs(length - afterLengths[index]) < 1e-9));
});

test("rectangle pointer frames stay transient and zone persistence happens only at commit sites", () => {
  const source = readFileSync(
    new URL("../../src/components_v2/canvas/hooks/useDrawingTools.ts", import.meta.url),
    "utf8",
  );
  const moveBody = source.slice(source.indexOf("const onStageMouseMove"), source.indexOf("React.useEffect(() => () => pointerChannel.destroy"));
  assert.equal(moveBody.includes("onZoneCommit"), false);
  assert.equal(moveBody.includes("updateZone"), false);
  assert.ok(source.includes("pointerChannel.publish"));
  assert.ok(source.includes("shapeKind: 'rectangle'"));
});

test("legacy zone JSON remains valid without optional reference metadata", () => {
  const legacy = { id: "legacy-zone", roofId: "roof-a", type: "riservata", points: rotatedRectangle(10, 8, 0) };
  const loaded = JSON.parse(JSON.stringify(legacy));
  assert.equal(loaded.edgeReference, undefined);
  assert.equal(loaded.shapeKind, undefined);
  assert.equal(loaded.points.length, 4);
});

test("quick rectangle remains the canonical reserved obstacle for module collision", () => {
  const roof = rotatedRectangle(100, 80, 0);
  const obstacle = createRoofRelativeRectangle({
    dragStart: { x: 42, y: 44 },
    dragEnd: { x: 58, y: 56 },
    ownerRoofPoints: roof,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
  });
  assert.equal(obstacle.valid, true);
  const result = validatePlacementFootprint({
    footprint: rotatedRectangle(8, 8, 0),
    usableRoof: {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "valid",
      components: [roof],
      marginM: 0,
      diagnostics: [],
    },
    reservedZones: [{ id: "quick-rectangle", polygon: obstacle.points }],
  });
  assert.deepEqual(result.reasons, ["reserved-zone"]);
});

test("rectangle owner, reference and shape metadata survive planner export/import", () => {
  const zone = {
    id: "zone-roundtrip",
    roofId: "roof-roundtrip",
    type: "riservata" as const,
    points: rotatedRectangle(10, 8, 17),
    edgeReference: { edgeIndex: 2 },
    shapeKind: "rectangle" as const,
  };
  usePlannerV2Store.setState({ zones: [zone], selectedZoneId: undefined });
  const exported = usePlannerV2Store.getState().exportState();
  usePlannerV2Store.setState({ zones: [] });
  usePlannerV2Store.getState().importState(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(usePlannerV2Store.getState().zones, [zone]);
});
