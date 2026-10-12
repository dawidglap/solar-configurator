import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRightAngleSymbolGeometry,
  resolveRightAngleMarkerWorldScale,
} from "../../src/components_v2/canvas/roofRightAngleSymbol";

function distanceToInfiniteLine(
  point: { x: number; y: number },
  unitDirection: { x: number; y: number },
) {
  return Math.abs(point.x * unitDirection.y - point.y * unitDirection.x);
}

test("right-angle dot stays strictly inside the sides and arc", () => {
  const firstSide = { x: 1, y: 0 };
  const secondSide = { x: 0, y: 1 };
  const bisector = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const geometry = buildRightAngleSymbolGeometry({
    firstSideUnit: firstSide,
    secondSideUnit: secondSide,
    bisectorUnit: bisector,
    worldUnitsPerMarkerPx: 1,
  });

  const dotCenterDistance = Math.hypot(geometry.dot.x, geometry.dot.y);
  assert.ok(distanceToInfiniteLine(geometry.dot, firstSide) > geometry.dot.radius);
  assert.ok(distanceToInfiniteLine(geometry.dot, secondSide) > geometry.dot.radius);
  assert.ok(dotCenterDistance + geometry.dot.radius < geometry.arcRadius);
});

test("right-angle mark keeps its proportions after the 25 percent visual reduction", () => {
  const angle = 37 * Math.PI / 180;
  const firstSide = { x: Math.cos(angle), y: Math.sin(angle) };
  const secondSide = { x: -Math.sin(angle), y: Math.cos(angle) };
  const bisector = {
    x: (firstSide.x + secondSide.x) * Math.SQRT1_2,
    y: (firstSide.y + secondSide.y) * Math.SQRT1_2,
  };
  const geometry = buildRightAngleSymbolGeometry({
    firstSideUnit: firstSide,
    secondSideUnit: secondSide,
    bisectorUnit: bisector,
    worldUnitsPerMarkerPx: 2,
  });

  assert.ok(Math.abs(Math.hypot(geometry.firstSide.end.x, geometry.firstSide.end.y) - 120) < 1e-12);
  assert.ok(Math.abs(Math.hypot(geometry.secondSide.end.x, geometry.secondSide.end.y) - 120) < 1e-12);
  assert.ok(Math.abs(geometry.arcRadius - 82.5) < 1e-12);
  assert.ok(Math.abs(geometry.dot.radius - 9.75) < 1e-12);
  assert.ok(Math.abs(geometry.strokeWidth - 13.5) < 1e-12);
});

test("right-angle marker follows zoom, hides at overview scale, and clamps at close zoom", () => {
  const fitScale = 0.2;
  const projectedOuterRadius = (currentScale: number) => {
    const worldScale = resolveRightAngleMarkerWorldScale({ currentScale, fitScale });
    if (worldScale == null) return null;
    return buildRightAngleSymbolGeometry({
      firstSideUnit: { x: 1, y: 0 },
      secondSideUnit: { x: 0, y: 1 },
      bisectorUnit: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      worldUnitsPerMarkerPx: worldScale,
    }).firstSide.end.x * currentScale;
  };

  assert.equal(projectedOuterRadius(fitScale), null);
  assert.equal(projectedOuterRadius(fitScale * 1.1), null);
  assert.ok(Math.abs((projectedOuterRadius(fitScale * 2) ?? 0) - 30) < 1e-12);
  assert.ok(Math.abs((projectedOuterRadius(fitScale * 4) ?? 0) - 60) < 1e-12);
  assert.ok(Math.abs((projectedOuterRadius(fitScale * 8) ?? 0) - 60) < 1e-12);
});

test("roof renderer replaces only classified 90 degree labels with a non-listening vector symbol", () => {
  const source = readFileSync("src/components_v2/canvas/RoofShapesLayer.tsx", "utf8");
  const rightAngleBranch = source.slice(
    source.indexOf("if (k.ref === 90)"),
    source.indexOf("const pos =", source.indexOf("if (k.ref === 90)")),
  );

  assert.match(source, /const near = k\.diff <= TOL_HINT/);
  assert.match(rightAngleBranch, /buildRightAngleSymbolGeometry/);
  assert.match(rightAngleBranch, /<KonvaLine/g);
  assert.match(rightAngleBranch, /<KonvaPath/);
  assert.match(rightAngleBranch, /<KonvaCircle/);
  assert.match(rightAngleBranch, /listening=\{false\}/);
  assert.match(source, /text=\{`\$\{k\.ref\}°`\}/);
  assert.equal(rightAngleBranch.includes("KonvaText"), false);
});
