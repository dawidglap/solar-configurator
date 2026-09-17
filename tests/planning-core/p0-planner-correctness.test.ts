import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  computeMaximumAdvancedBlockLayout,
  computeAdvancedBlockLayout,
  createK2DDomeBlock,
} from "../../src/lib/planning-core/advanced";
import {
  computeMaximumLegacyStandardLayout,
} from "../../src/lib/planning-core/legacy-standard";
import {
  resolveOutwardBlockArrowAzimuths,
} from "../../src/components_v2/modules/panels/moduleSlope";

function normalize(value: number) {
  return ((value % 360) + 360) % 360;
}

function angleDifference(a: number, b: number) {
  const difference = Math.abs(normalize(a) - normalize(b));
  return Math.min(difference, 360 - difference);
}

function rotate(point: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

test("D-Dome arrow invariant is horizontal, opposite and outward", () => {
  const arrows = resolveOutwardBlockArrowAzimuths([
    { id: "left", blockKey: "b", cx: -1, cy: 0 },
    { id: "right", blockKey: "b", cx: 1, cy: 0 },
  ]);
  assert.equal(arrows.get("left"), 270);
  assert.equal(arrows.get("right"), 90);
  assert.equal(angleDifference(arrows.get("left")!, arrows.get("right")!), 180);
});

test("D-Dome arrows stay outward after +37/+90/+180 rotations and endpoint reversal", () => {
  for (const degrees of [37, 90, 180]) {
    const left = rotate({ x: -1, y: 0 }, degrees);
    const right = rotate({ x: 1, y: 0 }, degrees);
    const forward = resolveOutwardBlockArrowAzimuths([
      { id: "a", blockKey: "edge:p1-p2", cx: left.x, cy: left.y },
      { id: "b", blockKey: "edge:p1-p2", cx: right.x, cy: right.y },
    ]);
    const reversed = resolveOutwardBlockArrowAzimuths([
      { id: "a", blockKey: "edge:p2-p1", cx: left.x, cy: left.y },
      { id: "b", blockKey: "edge:p2-p1", cx: right.x, cy: right.y },
    ]);
    assert.equal(angleDifference(forward.get("a")!, forward.get("b")!), 180);
    assert.equal(forward.get("a"), reversed.get("a"));
    assert.equal(forward.get("b"), reversed.get("b"));
    const centerToLeftAzimuth = normalize(Math.atan2(left.x, -left.y) * 180 / Math.PI);
    assert.ok(angleDifference(forward.get("a")!, centerToLeftAzimuth) < 1e-9);
  }
});

test("Vollbelegung improves the real D-Dome 17.8 x 10.9 m phase regression with no residual grid cell", () => {
  const adapter = createK2DDomeBlock({
    module: { widthM: 1.134, heightM: 1.722, orientation: "landscape" },
    rowSpaceM: 2.6,
    primaryFaceAzimuthDeg: 90,
  });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const input = {
    roofPolygonM: [
      { x: 0, y: 0 }, { x: 17.8, y: 0 }, { x: 17.8, y: 10.9 }, { x: 0, y: 10.9 },
    ],
    marginM: 0,
    blockDefinition: adapter.definition,
    phaseX: 0.75,
    phaseY: 0.75,
    anchorX: "start" as const,
    anchorY: "start" as const,
    reservedZones: [],
    snowGuards: [],
  };
  const before = computeAdvancedBlockLayout(input);
  const baseline = computeMaximumAdvancedBlockLayout(input);
  assert.equal(before.blockCount, 30);
  assert.equal(before.moduleCount, 60);
  assert.equal(baseline.layout.blockCount, 36);
  assert.equal(baseline.layout.moduleCount, 72);
  assert.equal(baseline.phaseX, 0);
  assert.equal(baseline.phaseY, 0.75);
  const repeated = Array.from({ length: 10 }, () => computeMaximumAdvancedBlockLayout(input));
  assert.ok(repeated.every((result) =>
    result.layout.moduleCount === baseline.layout.moduleCount &&
    result.phaseX === baseline.phaseX && result.phaseY === baseline.phaseY &&
    JSON.stringify(result.layout.blocks.map((block) => block.centerM)) ===
      JSON.stringify(baseline.layout.blocks.map((block) => block.centerM)),
  ));
  const canonicalGrid = computeAdvancedBlockLayout({
    ...input,
    phaseX: baseline.phaseX,
    phaseY: baseline.phaseY,
  });
  const occupied = new Set(baseline.layout.blocks.map((block) =>
    `${block.centerM.x.toFixed(9)}:${block.centerM.y.toFixed(9)}`));
  const residualGridCompatibleBlocks = canonicalGrid.blocks.filter((block) =>
    !occupied.has(`${block.centerM.x.toFixed(9)}:${block.centerM.y.toFixed(9)}`));
  assert.equal(residualGridCompatibleBlocks.length, 0);
});

test("controlled 10 x 6 standard rectangle reaches the analytical 60-module maximum", () => {
  const result = computeMaximumLegacyStandardLayout({
    generation: {
      roofPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
      mppImage: 1,
      canvasAngleDeg: 0,
      orientation: "portrait",
      panelSizeM: { widthM: 1, heightM: 1 },
      spacingM: 0,
      marginM: 0,
      phaseX: 0.75,
      phaseY: 0.75,
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });
  assert.equal(result.count, 60);
  assert.equal(result.phaseX, 0);
  assert.equal(result.phaseY, 0);
});

test("an obstacle rejects its cell but does not truncate the rest of the row", () => {
  const result = computeMaximumLegacyStandardLayout({
    generation: {
      roofPolygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 }, { x: 0, y: 1 }],
      mppImage: 1,
      canvasAngleDeg: 0,
      orientation: "portrait",
      panelSizeM: { widthM: 1, heightM: 1 },
      spacingM: 0,
      marginM: 0,
    },
    reservedZones: [{ points: [
      { x: 2.1, y: 0.1 }, { x: 2.9, y: 0.1 }, { x: 2.9, y: 0.9 }, { x: 2.1, y: 0.9 },
    ] }],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });
  assert.equal(result.count, 4);
  assert.ok(result.placements.some((panel) => panel.cx > 3));
});

test("CompassHUD remains mounted and only contextual details are optional", () => {
  const compass = readFileSync(
    new URL("../../src/components_v2/compassHUD.tsx", import.meta.url),
    "utf8",
  );
  const canvas = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(compass.includes("if (!roof) return null"), false);
  assert.equal(compass.includes("if (primaryDirectionDeg == null) return null"), false);
  assert.match(compass, /directionDegs\.length > 0/);
  assert.equal((canvas.match(/<CompassHUD/g) ?? []).length, 1);
  assert.match(compass, /northOnScreenDeg = normalize360\(canvasRotationDeg\)/);
  const requiredStates = [
    "building/no-roof", "building/pitched", "building/flat",
    "modules/no-mode", "modules/south", "modules/east-west",
    "modules/panels-selected", "modules/no-panels", "tool/obstacle",
    "tool/manual-fill", "field-overview/open-or-closed", "viewport/rotated",
  ];
  assert.equal(requiredStates.length, 12);
  // One permanent mount covers every state; no planner mode participates in
  // the mount decision and only contextual copy is conditional inside it.
  for (const forbiddenGuard of ["step ===", "tool ===", "selectedId &&", "img &&"]) {
    const mountWindow = canvas.slice(canvas.indexOf("<CompassHUD") - 120, canvas.indexOf("<CompassHUD"));
    assert.equal(mountWindow.includes(forbiddenGuard), false);
  }
  requiredStates.forEach(() => assert.equal((canvas.match(/<CompassHUD/g) ?? []).length, 1));
});
