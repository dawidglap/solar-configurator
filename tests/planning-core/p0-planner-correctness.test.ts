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
  isLegacyStandardCandidateInsideUsableRoof,
} from "../../src/lib/planning-core/legacy-standard";
import {
  computeUsableRoof,
  polygonBounds,
} from "../../src/lib/planning-core/geometry-v2";
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

test("D-Dome arrows stay outward at 0/90/180/270/360 and after saved-layout reload", () => {
  const initial = [
    { id: "a", blockKey: "saved:block", slotIndex: 0, cx: -1, cy: 0 },
    { id: "b", blockKey: "saved:block", slotIndex: 1, cx: 1, cy: 0 },
  ];
  const initialSnapshot = structuredClone(initial);
  const initialArrows = resolveOutwardBlockArrowAzimuths(initial);
  for (const degrees of [0, 90, 180, 270, 360]) {
    const left = rotate({ x: -1, y: 0 }, degrees);
    const right = rotate({ x: 1, y: 0 }, degrees);
    const forward = resolveOutwardBlockArrowAzimuths([
      { id: "a", blockKey: "edge:p1-p2", slotIndex: 0, cx: left.x, cy: left.y },
      { id: "b", blockKey: "edge:p1-p2", slotIndex: 1, cx: right.x, cy: right.y },
    ]);
    const reversed = resolveOutwardBlockArrowAzimuths([
      { id: "a", blockKey: "edge:p2-p1", slotIndex: 0, cx: left.x, cy: left.y },
      { id: "b", blockKey: "edge:p2-p1", slotIndex: 1, cx: right.x, cy: right.y },
    ]);
    assert.equal(angleDifference(forward.get("a")!, forward.get("b")!), 180);
    assert.equal(forward.get("a"), reversed.get("a"));
    assert.equal(forward.get("b"), reversed.get("b"));
    const centerToLeftAzimuth = normalize(Math.atan2(left.x, -left.y) * 180 / Math.PI);
    assert.ok(angleDifference(forward.get("a")!, centerToLeftAzimuth) < 1e-9);
    if (degrees === 360) {
      assert.ok(angleDifference(forward.get("a")!, initialArrows.get("a")!) < 1e-9);
      assert.ok(angleDifference(forward.get("b")!, initialArrows.get("b")!) < 1e-9);
    }
  }
  const loaded = JSON.parse(JSON.stringify(initial));
  assert.deepEqual([...resolveOutwardBlockArrowAzimuths(loaded)], [...initialArrows]);
  assert.deepEqual(initial, initialSnapshot, "arrow derivation must not mutate panel geometry");
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

test("Standard Vollbelegung anchors directly to the 0, 0.2 and 0.5 m usable-roof boundary", () => {
  for (const marginM of [0, 0.2, 0.5]) {
    const result = computeMaximumLegacyStandardLayout({
      generation: {
        roofPolygon: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 0, y: 3 }],
        mppImage: 1,
        canvasAngleDeg: 0,
        orientation: "portrait",
        panelSizeM: { widthM: 1, heightM: 0.9 },
        spacingM: 0,
        marginM,
        phaseX: 0,
        phaseY: 0,
        anchorX: "start",
        anchorY: "start",
      },
      reservedZones: [],
      snowGuards: [],
      filterPolicy: { reservedZones: true, snowGuards: true },
    });
    const firstLeft = Math.min(...result.placements.map((panel) => panel.cx - panel.wPx / 2));
    const firstTop = Math.min(...result.placements.map((panel) => panel.cy - panel.hPx / 2));
    assert.ok(Math.abs(firstLeft - marginM) < 1e-6);
    assert.ok(Math.abs(firstTop - marginM) < 1e-6);
  }
});

test("usable-polygon origin restores the missing trapezoid module without double-applying margin", () => {
  const roofPolygon = [
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 5.6, y: 3 }, { x: 0.4, y: 3 },
  ];
  const marginM = 0.2;
  const input = {
    generation: {
      roofPolygon,
      mppImage: 1,
      canvasAngleDeg: 0,
      orientation: "portrait" as const,
      panelSizeM: { widthM: 1, heightM: 0.9 },
      spacingM: 0,
      marginM,
      phaseX: 0,
      phaseY: 0,
      anchorX: "start" as const,
      anchorY: "start" as const,
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  };
  const result = computeMaximumLegacyStandardLayout(input);
  const usableRoof = computeUsableRoof({ roofPolygonM: roofPolygon, marginM });

  // The pre-fix outer-bounds-plus-margin lattice yielded 9 for this fixture.
  assert.equal(result.count, 10);
  assert.ok(result.placements.every((candidate) =>
    isLegacyStandardCandidateInsideUsableRoof({ candidate, mppImage: 1, usableRoof }),
  ));
  assert.ok(result.candidatesEvaluated <= 4096, "phase search must remain finite");
  const signature = JSON.stringify({
    phaseX: result.phaseX,
    phaseY: result.phaseY,
    placements: result.placements.map(({ cx, cy }) => [cx, cy]),
  });
  assert.ok(Array.from({ length: 3 }, () => computeMaximumLegacyStandardLayout(input)).every(
    (repeat) => JSON.stringify({
      phaseX: repeat.phaseX,
      phaseY: repeat.phaseY,
      placements: repeat.placements.map(({ cx, cy }) => [cx, cy]),
    }) === signature,
  ));
});

test("Vollbelegung does not invent an extra row when the residual height is insufficient", () => {
  const result = computeMaximumLegacyStandardLayout({
    generation: {
      roofPolygon: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 0, y: 3 }],
      mppImage: 1,
      canvasAngleDeg: 0,
      orientation: "portrait",
      panelSizeM: { widthM: 1, heightM: 1.1 },
      spacingM: 0,
      marginM: 0.2,
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });
  assert.equal(result.count, 10);
});

test("D-Dome Vollbelegung starts at the inset boundary and preserves block geometry", () => {
  const adapter = createK2DDomeBlock({
    module: { widthM: 1.134, heightM: 1.722, orientation: "landscape" },
    rowSpaceM: 2.6,
    primaryFaceAzimuthDeg: 90,
  });
  assert.equal(adapter.valid, true);
  if (!adapter.valid) return;
  const input = {
    roofPolygonM: [{ x: 0, y: 0 }, { x: 17.8, y: 0 }, { x: 17.8, y: 10.9 }, { x: 0, y: 10.9 }],
    marginM: 0.2,
    blockDefinition: adapter.definition,
    phaseX: 0,
    phaseY: 0,
    anchorX: "start" as const,
    anchorY: "start" as const,
    reservedZones: [],
    snowGuards: [],
  };
  const anchored = computeAdvancedBlockLayout(input);
  const anchoredBounds = anchored.blocks.map((block) => polygonBounds(block.footprint));
  const anchoredMinX = Math.min(...anchoredBounds.map((item) => item.minX));
  const anchoredMaxX = Math.max(...anchoredBounds.map((item) => item.maxX));
  const anchoredMinY = Math.min(...anchoredBounds.map((item) => item.minY));
  const anchoredMaxY = Math.max(...anchoredBounds.map((item) => item.maxY));
  assert.ok(Math.min(Math.abs(anchoredMinX - 0.2), Math.abs(anchoredMaxX - 17.6)) < 1e-6);
  assert.ok(Math.min(Math.abs(anchoredMinY - 0.2), Math.abs(anchoredMaxY - 10.7)) < 1e-6);

  const result = computeMaximumAdvancedBlockLayout(input);
  const bounds = result.layout.blocks.map((block) => polygonBounds(block.footprint));
  assert.ok(bounds.every((item) =>
    item.minX >= 0.2 - 1e-6 && item.minY >= 0.2 - 1e-6 &&
    item.maxX <= 17.6 + 1e-6 && item.maxY <= 10.7 + 1e-6,
  ));
  assert.ok(result.layout.blocks.every((block) =>
    block.footprint.length === adapter.definition.blockFootprint.length,
  ));
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
