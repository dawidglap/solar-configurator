import assert from "node:assert/strict";
import test from "node:test";

import {
  computeLegacyStandardCandidates,
  computeMaximizedLegacyStandardCandidates,
  isLegacyStandardCandidateInsideUsableRoof,
  type LegacyStandardCandidate,
  type LegacyStandardGenerationInput,
} from "../../src/lib/planning-core/legacy-standard";
import {
  computeUsableRoof,
  type MetricPolygon,
} from "../../src/lib/planning-core/geometry-v2";
import { createPanelPlacementValidator } from "../../src/components_v2/modules/manualPlacement";
import { buildStandardExistingLayoutReflow } from "../../src/components_v2/modules/panels/existingLayoutReflow";
import type { ModulesConfig, PanelInstance, RoofArea } from "../../src/types/planner";

function generation(
  roofPolygon: MetricPolygon,
  overrides: Partial<LegacyStandardGenerationInput> = {},
): LegacyStandardGenerationInput {
  return {
    roofPolygon,
    mppImage: 1,
    canvasAngleDeg: 0,
    orientation: "portrait",
    panelSizeM: { widthM: 4, heightM: 4 },
    spacingM: 0,
    marginM: 0,
    phaseX: 0,
    phaseY: 0,
    anchorX: "start",
    anchorY: "start",
    coverageRatio: 1,
    ...overrides,
  };
}

function usable(roofPolygonM: MetricPolygon, marginM: number) {
  return computeUsableRoof({ roofPolygonM, marginM });
}

function candidate(input: Partial<LegacyStandardCandidate> = {}): LegacyStandardCandidate {
  return {
    cx: 5,
    cy: 5,
    wPx: 8,
    hPx: 8,
    angleDeg: 0,
    ...input,
  };
}

test("Schrägdach rejects a module whose corners are inside but whose footprint bridges a concave notch", () => {
  const concaveRoof: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 6, y: 10 },
    { x: 6, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];
  const bridge = candidate({ cx: 5, cy: 3, wPx: 4, hPx: 4 });

  assert.equal(isLegacyStandardCandidateInsideUsableRoof({
    candidate: bridge,
    mppImage: 1,
    usableRoof: usable(concaveRoof, 0),
  }), false);

  const generated = computeMaximizedLegacyStandardCandidates(generation(concaveRoof, {
    panelSizeM: { widthM: 4, heightM: 4 },
    phaseX: 0.75,
    phaseY: 0.5,
  }));
  assert.equal(generated.some((item) =>
    Math.abs(item.cx - bridge.cx) < 1e-9 && Math.abs(item.cy - bridge.cy) < 1e-9
  ), false);
});

test("Schrägdach Randabstand accepts an exact tangent footprint and rejects a 1 mm violation", () => {
  const roof: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const inset = usable(roof, 1);

  assert.equal(isLegacyStandardCandidateInsideUsableRoof({
    candidate: candidate(),
    mppImage: 1,
    usableRoof: inset,
  }), true);
  assert.equal(isLegacyStandardCandidateInsideUsableRoof({
    candidate: candidate({ cx: 4.999 }),
    mppImage: 1,
    usableRoof: inset,
  }), false);
});

test("Schrägdach rejects a center-inside module when one rotated corner leaves the roof", () => {
  const roof: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(isLegacyStandardCandidateInsideUsableRoof({
    candidate: candidate({ cx: 8.5, cy: 5, wPx: 4, hPx: 2, angleDeg: 20 }),
    mppImage: 1,
    usableRoof: usable(roof, 0),
  }), false);
});

test("every generated portrait and landscape module is exact-polygon-safe on a rotated >4-edge roof", () => {
  const roof: MetricPolygon = [
    { x: 1, y: 0 },
    { x: 12, y: 2 },
    { x: 11, y: 7 },
    { x: 7, y: 6 },
    { x: 5, y: 9 },
    { x: 0, y: 7 },
  ];
  const usableRoof = usable(roof, 0.3);

  for (const orientation of ["portrait", "landscape"] as const) {
    const input = generation(roof, {
      canvasAngleDeg: 13.75,
      orientation,
      panelSizeM: { widthM: 1.134, heightM: 1.762 },
      spacingXM: 0.019,
      spacingYM: 0.027,
      marginM: 0.3,
    });
    const generated = computeLegacyStandardCandidates(input);
    assert.ok(generated.length > 0);
    assert.ok(generated.every((item) => isLegacyStandardCandidateInsideUsableRoof({
      candidate: item,
      mppImage: input.mppImage,
      usableRoof,
    })));
  }
});

test("endpoint-order equivalent roof polygons keep the same polygon-safe capacity", () => {
  const roof: MetricPolygon = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 6 },
    { x: 8, y: 6 },
    { x: 8, y: 4 },
    { x: 0, y: 4 },
  ];
  const reversed = [roof[1], roof[0], ...roof.slice(2).reverse()];
  const first = computeLegacyStandardCandidates(generation(roof, {
    panelSizeM: { widthM: 1, heightM: 1 },
    marginM: 0.2,
  }));
  const second = computeLegacyStandardCandidates(generation(reversed, {
    panelSizeM: { widthM: 1, heightM: 1 },
    marginM: 0.2,
  }));

  assert.equal(second.length, first.length);
});

test("irregular Schrägdach reflows 119 mm to 19 mm with zero invalid panels", () => {
  const mppImage = 0.1;
  const roof: RoofArea = {
    id: "irregular-pitched",
    name: "D1",
    roofKind: "pitched",
    tiltDeg: 24,
    edgeMarginM: 0.3,
    points: [
      { x: 0, y: 0 },
      { x: 220, y: 0 },
      { x: 220, y: 150 },
      { x: 145, y: 150 },
      { x: 125, y: 115 },
      { x: 95, y: 115 },
      { x: 75, y: 150 },
      { x: 0, y: 150 },
    ],
  };
  const previousModules: ModulesConfig = {
    gridAngleDeg: 0,
    orientation: "portrait",
    spacingM: 0.119,
    spacingXM: 0.119,
    spacingYM: 0.119,
    marginM: 0.3,
    showGrid: false,
    placingSingle: false,
  };
  const widthPx = 1.134 / mppImage;
  const heightPx = 1.722 / mppImage;
  const panels: PanelInstance[] = Array.from({ length: 6 }, (_, index) => ({
    id: `existing-${index}`,
    roofId: roof.id,
    panelId: "panel-445",
    cx: 45 + (index % 3) * (widthPx + 1.19),
    cy: 40 + Math.floor(index / 3) * (heightPx + 1.19),
    wPx: widthPx,
    hPx: heightPx,
    angleDeg: 0,
    orientation: "portrait",
  }));
  const result = buildStandardExistingLayoutReflow({
    roof,
    currentPanels: panels,
    previousModules,
    nextModules: {
      ...previousModules,
      spacingM: 0.019,
      spacingXM: 0.019,
      spacingYM: 0.019,
    },
    moduleTilt: { mode: "inherit-roof" },
    thermalFieldLimits: {
      kind: "pitched-grid",
      maxRowDirectionM: 17.6,
      maxColumnDirectionM: 17.6,
      thermalSeparationGapM: 0.14,
    },
    mppImage,
    zones: [],
    snowGuards: [],
  });
  assert.ok(result);
  assert.equal(result.panels.length, panels.length);
  const validate = createPanelPlacementValidator({
    roof,
    marginM: 0.3,
    mppImage,
    zones: [],
    snowGuards: [],
    panels: [],
  });
  assert.equal(validate(result.panels), true);
});
