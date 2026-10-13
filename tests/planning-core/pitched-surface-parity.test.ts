import assert from "node:assert/strict";
import test from "node:test";

import { buildDirectStandardRoofLayout } from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import { buildStandardExistingLayoutReflow } from "../../src/components_v2/modules/panels/existingLayoutReflow";
import { createPanelPlacementValidator } from "../../src/components_v2/modules/manualPlacement";
import {
  computeUsableRoof,
  imagePointToRoofLocalM,
  projectedVectorToRoofLocalM,
  roofLocalPointMToImage,
} from "../../src/lib/planning-core/geometry-v2";
import type { ModulesConfig, PanelSpec, RoofArea } from "../../src/types/planner";

const MPP = 0.01;
const PITCH_DEG = 39;
const SURFACE_DEPTH_M = 6.56;
const PROJECTED_DEPTH_M = SURFACE_DEPTH_M * Math.cos(PITCH_DEG * Math.PI / 180);
const PROJECTION = { tiltDeg: PITCH_DEG, fallAzimuthDeg: 180 } as const;
const AIKO_A445: PanelSpec = {
  id: "AIKO-A445-MAH54Tm",
  brand: "AIKO",
  model: "A445-MAH54Tm",
  wp: 445,
  widthM: 1.134,
  heightM: 1.762,
  priceChf: 0,
};
const ROOF: RoofArea = {
  id: "real-39",
  name: "39 degree fixture",
  roofKind: "pitched",
  tiltDeg: PITCH_DEG,
  fallAzimuthDeg: 180,
  referenceEdgeIndex: 0,
  points: [
    { x: 0, y: 0 },
    { x: 10.34 / MPP, y: 0 },
    { x: 10.34 / MPP, y: PROJECTED_DEPTH_M / MPP },
    { x: 0, y: PROJECTED_DEPTH_M / MPP },
  ],
};
const MODULES: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "portrait",
  spacingM: 0.019,
  spacingXM: 0.019,
  spacingYM: 0.019,
  marginM: 0.2,
  showGrid: false,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 2 / 3,
};

function build(roof = ROOF) {
  const result = buildDirectStandardRoofLayout({
    roof,
    panel: AIKO_A445,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: MPP,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `panel-${index}`,
  });
  assert.ok(result);
  return result;
}

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("39 degree fixture places adjacent 8-module AIKO rows at exact physical row pitch", () => {
  const result = build();
  const rows = [...new Set(result.panels.map((panel) => panel.cy))].sort((a, b) => a - b);
  assert.ok(rows.length >= 2);
  assert.equal(result.panels.filter((panel) => Math.abs(panel.cy - rows[0]) < 1e-8).length, 8);
  assert.equal(result.panels.filter((panel) => Math.abs(panel.cy - rows[1]) < 1e-8).length, 8);

  const panel = result.panels[0];
  const widthSurface = projectedVectorToRoofLocalM(
    { x: panel.wPx, y: 0 }, MPP, PROJECTION,
  );
  const heightSurface = projectedVectorToRoofLocalM(
    { x: 0, y: panel.hPx }, MPP, PROJECTION,
  );
  close(Math.hypot(widthSurface.x, widthSurface.y), AIKO_A445.widthM);
  close(Math.hypot(heightSurface.x, heightSurface.y), AIKO_A445.heightM);

  const rowPitch = projectedVectorToRoofLocalM(
    { x: 0, y: rows[1] - rows[0] }, MPP, PROJECTION,
  );
  close(Math.hypot(rowPitch.x, rowPitch.y), AIKO_A445.heightM + 0.019);
  assert.equal(panel.standard?.geometrySpace, "roof-surface-v1");
});

test("roof-local point round-trips for roof, projected module and Randabstand vertices", () => {
  const result = build();
  const usable = computeUsableRoof({
    roofPolygonM: ROOF.points.map((point) => ({ x: point.x * MPP, y: point.y * MPP })),
    marginM: MODULES.marginM,
  });
  assert.equal(usable.status, "valid");
  const panel = result.panels[0];
  const points = [
    ...ROOF.points,
    { x: panel.cx - panel.wPx / 2, y: panel.cy - panel.hPx / 2 },
    { x: panel.cx + panel.wPx / 2, y: panel.cy + panel.hPx / 2 },
    ...usable.components.flat().map((point) => ({ x: point.x / MPP, y: point.y / MPP })),
  ];
  points.forEach((point) => {
    const physical = imagePointToRoofLocalM(point, { x: 0, y: 0 }, MPP, PROJECTION);
    const projected = roofLocalPointMToImage(physical, { x: 0, y: 0 }, MPP, PROJECTION);
    close(projected.x, point.x);
    close(projected.y, point.y);
  });
});

test("canonical validator accepts the committed 19 mm physical neighbour spacing", () => {
  const result = build();
  const rows = [...new Set(result.panels.map((panel) => panel.cy))].sort((a, b) => a - b);
  const candidate = result.panels.find((panel) => Math.abs(panel.cy - rows[1]) < 1e-8);
  assert.ok(candidate);
  const validator = createPanelPlacementValidator({
    roof: ROOF,
    marginM: MODULES.marginM,
    mppImage: MPP,
    zones: [],
    snowGuards: [],
    panels: result.panels,
    excludePanelIds: new Set([candidate.id]),
    moduleGapXM: 0.019,
    moduleGapYM: 0.019,
  });
  assert.equal(validator([candidate]), true);
});

test("roof resize and regeneration keep catalog size and row pitch fixed", () => {
  const initial = build();
  const resizedRoof: RoofArea = {
    ...ROOF,
    points: ROOF.points.map((point) => ({
      x: point.x * 1.08,
      y: point.y * 1.12,
    })),
  };
  const regenerated = build(resizedRoof);
  for (const result of [initial, regenerated]) {
    const panel = result.panels[0];
    const width = projectedVectorToRoofLocalM({ x: panel.wPx, y: 0 }, MPP, PROJECTION);
    const height = projectedVectorToRoofLocalM({ x: 0, y: panel.hPx }, MPP, PROJECTION);
    close(Math.hypot(width.x, width.y), AIKO_A445.widthM);
    close(Math.hypot(height.x, height.y), AIKO_A445.heightM);
  }
});

test("spacing reflow removes a legacy residual band without changing module identities", () => {
  const generated = build();
  const rows = [...new Set(generated.panels.map((panel) => panel.cy))].sort((a, b) => a - b);
  const legacyOffsetPx = 0.45 / MPP;
  const displaced = generated.panels.map((panel) => ({
    ...panel,
    cy: panel.cy + (Math.abs(panel.cy - rows[1]) < 1e-8 ? legacyOffsetPx : 0),
    standard: panel.standard ? { ...panel.standard, geometrySpace: undefined } : undefined,
  }));
  const reflow = buildStandardExistingLayoutReflow({
    roof: ROOF,
    panel: AIKO_A445,
    currentPanels: displaced,
    previousModules: MODULES,
    nextModules: MODULES,
    moduleTilt: { mode: "inherit-roof" },
    thermalFieldLimits: {
      kind: "pitched-grid",
      maxRowDirectionM: 17.6,
      maxColumnDirectionM: 17.6,
      thermalSeparationGapM: 0.14,
    },
    mppImage: MPP,
    zones: [],
    snowGuards: [],
  });
  assert.ok(reflow);
  assert.deepEqual(reflow.panels.map((panel) => panel.id), displaced.map((panel) => panel.id));
  const nextRows = [...new Set(reflow.panels.map((panel) => panel.cy))].sort((a, b) => a - b);
  const rowPitch = projectedVectorToRoofLocalM(
    { x: 0, y: nextRows[1] - nextRows[0] }, MPP, PROJECTION,
  );
  close(Math.hypot(rowPitch.x, rowPitch.y), AIKO_A445.heightM + 0.019);
});
