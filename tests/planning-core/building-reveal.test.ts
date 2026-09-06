import assert from "node:assert/strict";
import test from "node:test";

import {
  computeBuildingRevealTarget,
  interpolateBuildingRevealCamera,
  resolveHorizontalReferenceRotation,
  resolvePrimarySonnendachRoof,
  type SonnendachRevealRoof,
} from "../../src/lib/planning/viewport/buildingReveal";
import { shouldRequestBuildingReveal } from "../../src/components_v2/planner/plannerSessionPolicy";

function rectangle(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  sourceIndex: number,
): SonnendachRevealRoof {
  return {
    id,
    sourceIndex,
    roofKind: "pitched",
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function toScreen(
  point: { x: number; y: number },
  target: { scale: number; offsetX: number; offsetY: number; rotationDeg: number },
  image = { width: 2800, height: 1800 },
) {
  const radians = (target.rotationDeg * Math.PI) / 180;
  const center = { x: image.width / 2, y: image.height / 2 };
  const x = point.x - center.x;
  const y = point.y - center.y;
  const rotated = {
    x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
  };
  return {
    x: target.offsetX + rotated.x * target.scale,
    y: target.offsetY + rotated.y * target.scale,
  };
}

test("primary roof uses explicit source recommendation and ranking before geometry", () => {
  const large = rectangle("large", 100, 100, 800, 500, 0);
  const ranked = { ...rectangle("ranked", 300, 300, 200, 100, 1), sourceRank: 1 };
  const recommended = {
    ...rectangle("recommended", 500, 500, 100, 80, 2),
    recommended: true,
    sourceRank: 9,
  };
  assert.equal(resolvePrimarySonnendachRoof([large, ranked, recommended])?.id, "recommended");
  assert.equal(resolvePrimarySonnendachRoof([large, ranked])?.id, "ranked");
});

test("primary roof uses actual suitability then deterministic source order", () => {
  const medium = { ...rectangle("medium", 100, 100, 200, 100, 0), suitability: "mittel" };
  const goodLater = { ...rectangle("good-later", 300, 100, 200, 100, 2), suitability: "sehr gut" };
  const goodEarlier = { ...rectangle("good-earlier", 500, 100, 200, 100, 1), suitability: "sehr gut" };
  assert.equal(resolvePrimarySonnendachRoof([medium, goodLater, goodEarlier])?.id, "good-earlier");

  const first = rectangle("first", 0, 0, 50, 50, 0);
  const second = rectangle("second", 100, 0, 500, 500, 1);
  assert.equal(resolvePrimarySonnendachRoof([second, first])?.id, "first");
});

test("horizontal rotation follows reference edge and avoids a needless 180 degree flip", () => {
  assert.ok(Math.abs(resolveHorizontalReferenceRotation(27) + 27) < 1e-9);
  assert.ok(Math.abs(resolveHorizontalReferenceRotation(175) - 5) < 1e-9);
  assert.ok(Math.abs(resolveHorizontalReferenceRotation(-174) + 6) < 1e-9);
});

test("target rotation makes the canonical First horizontal on screen", () => {
  const angle = 27 * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  const origin = { x: 1000, y: 700 };
  const primary: SonnendachRevealRoof = {
    id: "primary",
    sourceIndex: 0,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
    points: [
      origin,
      { x: origin.x + direction.x * 360, y: origin.y + direction.y * 360 },
      {
        x: origin.x + direction.x * 360 + normal.x * 180,
        y: origin.y + direction.y * 360 + normal.y * 180,
      },
      { x: origin.x + normal.x * 180, y: origin.y + normal.y * 180 },
    ],
  };
  const target = computeBuildingRevealTarget({
    roofs: [primary],
    image: { width: 2800, height: 1800 },
    viewport: { width: 1600, height: 1000 },
    insets: { left: 320, right: 140, top: 90, bottom: 70 },
    minScale: 0.6,
    maxScale: 4.8,
  });
  assert.ok(target);
  const start = toScreen(primary.points[0], target);
  const end = toScreen(primary.points[1], target);
  assert.ok(Math.abs(start.y - end.y) < 1e-8);
});

test("camera target fits the complete roof group in the usable viewport without mutating geometry", () => {
  const primary = {
    ...rectangle("primary", 900, 700, 300, 180, 0),
    recommended: true,
  };
  const secondary = rectangle("secondary", 1220, 720, 240, 160, 1);
  const roofs = [primary, secondary];
  const before = structuredClone(roofs);
  const target = computeBuildingRevealTarget({
    roofs,
    image: { width: 2800, height: 1800 },
    viewport: { width: 1600, height: 1000 },
    insets: { left: 320, right: 140, top: 90, bottom: 70 },
    currentRotationDeg: 0,
    minScale: 0.6,
    maxScale: 4.8,
  });
  assert.ok(target);
  assert.equal(target.primaryRoofId, "primary");
  assert.ok(target.scale > 0.6);
  assert.deepEqual(roofs, before);

  const allPoints = roofs.flatMap((roof) => roof.points);
  const screenXs = allPoints.map((point) => target.offsetX + point.x * target.scale);
  const screenYs = allPoints.map((point) => target.offsetY + point.y * target.scale);
  assert.ok(Math.min(...screenXs) > 320);
  assert.ok(Math.max(...screenXs) < 1460);
  assert.ok(Math.min(...screenYs) > 90);
  assert.ok(Math.max(...screenYs) < 930);
});

test("framing includes the primary building group and excludes a neighbouring building", () => {
  const primary = {
    ...rectangle("primary", 900, 700, 240, 160, 0),
    buildingId: "building-a",
    suitability: "4",
  };
  const sameBuilding = {
    ...rectangle("same-building", 1160, 720, 240, 160, 1),
    buildingId: "building-a",
  };
  const neighbour = {
    ...rectangle("neighbour", 2300, 200, 300, 220, 2),
    buildingId: "building-b",
  };
  const target = computeBuildingRevealTarget({
    roofs: [primary, sameBuilding, neighbour],
    image: { width: 2800, height: 1800 },
    viewport: { width: 1600, height: 1000 },
    insets: { left: 320, right: 140, top: 90, bottom: 70 },
    minScale: 0.6,
    maxScale: 4.8,
  });
  assert.ok(target);
  for (const point of [...primary.points, ...sameBuilding.points].map((item) => toScreen(item, target))) {
    assert.ok(point.x > 320 && point.x < 1460);
    assert.ok(point.y > 90 && point.y < 930);
  }
  assert.ok(neighbour.points.map((item) => toScreen(item, target)).some((point) => point.x > 1460));
});

test("camera interpolation is coordinated and finishes exactly at the target", () => {
  const from = { scale: 0.6, offsetX: -10, offsetY: -20, rotationDeg: 0 };
  const to = { scale: 2.4, offsetX: -900, offsetY: -500, rotationDeg: -27 };
  assert.deepEqual(interpolateBuildingRevealCamera(from, to, 0), from);
  assert.deepEqual(interpolateBuildingRevealCamera(from, to, 1), to);
  const middle = interpolateBuildingRevealCamera(from, to, 0.5);
  assert.equal(middle.scale, 1.5);
  assert.equal(middle.rotationDeg, -13.5);
});

test("only a genuine new-address session can request the reveal", () => {
  assert.equal(shouldRequestBuildingReveal("new", 2), true);
  assert.equal(shouldRequestBuildingReveal("new", 0), false);
  assert.equal(shouldRequestBuildingReveal("existing", 2), false);
});
