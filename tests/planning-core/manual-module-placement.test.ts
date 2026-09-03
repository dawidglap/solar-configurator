import assert from "node:assert/strict";
import test from "node:test";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
} from "../../src/lib/planning-core/advanced";
import {
  createInitialAdvancedPlanning,
  setAdvancedMountingOrientation,
  updateDefaultFlatSystem,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import {
  buildAdvancedManualCandidate,
  buildStandardManualCandidate,
  materializeManualAdvancedPanels,
  resolveManualAdvancedBlockDefinition,
  regroupK2PanelsAfterManualAdd,
  snapAdvancedManualCenter,
} from "../../src/components_v2/modules/manualPlacement";
import type { ModulesConfig, PanelInstance, PanelSpec, RoofArea } from "../../src/types/planner";
import { buildGuidedPlanningResult } from "../../src/components_v2/modules/advanced/guidedPlanningPresentation";
import { resolvePanelSelectionIds } from "../../src/components_v2/modules/panels/panelSelection";

const PANEL: PanelSpec = {
  id: "module-440",
  brand: "Fixture",
  model: "440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};

const MODULES: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "landscape",
  spacingM: 0.019,
  spacingXM: 0.019,
  spacingYM: 0.019,
  marginM: 0.3,
  showGrid: true,
  placingSingle: false,
};

const ROOF: RoofArea = {
  id: "roof-manual",
  name: "D1",
  points: [
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    { x: 160, y: 120 },
    { x: 0, y: 120 },
  ],
};

const BASE = { roof: ROOF, mppImage: 0.1, zones: [], snowGuards: [], panels: [] } as const;

test("Standard manual add creates one correctly oriented candidate and rejects margin/overlap", () => {
  const valid = buildStandardManualCandidate({
    ...BASE,
    centerPx: { x: 80, y: 60 },
    panel: PANEL,
    orientation: "portrait",
    angleDeg: 37,
    marginM: 0.3,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.modules.length, 1);
  assert.equal(valid.modules[0].angleDeg, 37);
  assert.ok(Math.abs(valid.modules[0].wPx - 11.34) < 1e-9);
  assert.ok(Math.abs(valid.modules[0].hPx - 17.22) < 1e-9);

  const outside = buildStandardManualCandidate({
    ...BASE,
    centerPx: { x: 2, y: 2 },
    panel: PANEL,
    orientation: "portrait",
    angleDeg: 37,
    marginM: 0.3,
  });
  assert.equal(outside.valid, false);
  assert.ok(outside.reasons.includes("outside-usable-roof"));

  const committed: PanelInstance = {
    id: "existing",
    roofId: ROOF.id,
    cx: 80,
    cy: 60,
    wPx: 11.34,
    hPx: 17.22,
    angleDeg: 37,
    orientation: "portrait",
    panelId: PANEL.id,
  };
  const overlap = buildStandardManualCandidate({
    ...BASE,
    panels: [committed],
    centerPx: { x: 80, y: 60 },
    panel: PANEL,
    orientation: "portrait",
    angleDeg: 37,
    marginM: 0.3,
  });
  assert.equal(overlap.valid, false);
  assert.ok(overlap.reasons.includes("panel-overlap"));

  const insufficientGap = buildStandardManualCandidate({
    ...BASE,
    panels: [committed],
    centerPx: { x: 80 + 11.34 + 0.1, y: 60 },
    panel: PANEL,
    orientation: "portrait",
    angleDeg: 37,
    marginM: 0.3,
    gapXM: 0.019,
    gapYM: 0.019,
  });
  assert.equal(insufficientGap.valid, false);
  assert.ok(insufficientGap.reasons.includes("panel-overlap"));
});

test("manual candidate rejects a reserved zone and snow guard using its footprint", () => {
  const common = {
    ...BASE,
    centerPx: { x: 80, y: 60 },
    panel: PANEL,
    orientation: "portrait" as const,
    angleDeg: 0,
    marginM: 0,
  };
  const reserved = buildStandardManualCandidate({
    ...common,
    zones: [{
      roofId: ROOF.id,
      type: "riservata",
      points: [{ x: 84, y: 58 }, { x: 90, y: 58 }, { x: 90, y: 62 }, { x: 84, y: 62 }],
    }],
  });
  assert.equal(reserved.valid, false);
  assert.ok(reserved.reasons.includes("reserved-zone"));

  const guarded = buildStandardManualCandidate({
    ...common,
    snowGuards: [{ roofId: ROOF.id, p1: { x: 70, y: 60 }, p2: { x: 90, y: 60 } }],
  });
  assert.equal(guarded.valid, false);
  assert.ok(guarded.reasons.includes("snow-guard"));
});

test("D-Dome manual add is one physical block with exactly two opposed modules", () => {
  const config = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  assert.equal(config.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  const candidate = buildAdvancedManualCandidate({
    ...BASE,
    centerPx: { x: 80, y: 60 },
    config,
  });
  assert.equal(candidate.valid, true);
  assert.equal(candidate.modules.length, 2);

  const panels = materializeManualAdvancedPanels({
    candidate,
    roofId: ROOF.id,
    config,
    layoutRunId: "manual-run",
    blockKey: "roof-manual:manual-run:block:0",
    montageFieldKey: "roof-manual:manual-run:field:0",
    createPanelId: (slot) => `panel-${slot}`,
  });
  assert.equal(panels.length, 2);
  assert.deepEqual(panels.map((panel) => panel.advanced?.slotIndex), [0, 1]);
  assert.equal(panels[0].advanced?.blockKey, panels[1].advanced?.blockKey);
  assert.equal(panels[0].advanced?.montageFieldKey, panels[1].advanced?.montageFieldKey);
  assert.equal(
    ((panels[1].advanced!.moduleFaceAzimuthDeg - panels[0].advanced!.moduleFaceAzimuthDeg) + 360) % 360,
    180,
  );
  assert.deepEqual(resolvePanelSelectionIds(panels, panels[1].id), ["panel-0", "panel-1"]);
  const positionsBefore = panels.map(({ cx, cy }) => ({ cx, cy }));
  const regrouped = regroupK2PanelsAfterManualAdd({
    panels,
    roof: ROOF,
    config,
    mppImage: 0.1,
  });
  assert.deepEqual(regrouped.map(({ cx, cy }) => ({ cx, cy })), positionsBefore);
  assert.equal(regrouped[0].advanced?.montageFieldKey, regrouped[1].advanced?.montageFieldKey);
  assert.match(regrouped[0].advanced?.montageFieldKey ?? "", /manual-regroup/);
});

test("S-Dome manual add creates exactly one advanced module", () => {
  const dDome = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const config = setAdvancedMountingOrientation({ config: dDome, orientation: "south" });
  assert.equal(config.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  const candidate = buildAdvancedManualCandidate({
    ...BASE,
    centerPx: { x: 80, y: 60 },
    config,
  });
  assert.equal(candidate.valid, true);
  assert.equal(candidate.modules.length, 1);
});

test("custom flat-system manual add rebuilds effective Montagefeld membership", () => {
  const config = updateDefaultFlatSystem({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    rowSpaceM: 2.7,
    moduleGapM: 0.03,
    nominalTiltDeg: 15,
  });
  const candidate = buildAdvancedManualCandidate({
    ...BASE,
    centerPx: { x: 80, y: 60 },
    config,
  });
  assert.equal(candidate.valid, true);
  const panels = materializeManualAdvancedPanels({
    candidate,
    roofId: ROOF.id,
    config,
    layoutRunId: "custom-run",
    blockKey: "roof-manual:custom-run:block:0",
    montageFieldKey: "roof-manual:custom-run:field:0",
    createPanelId: (slot) => `custom-panel-${slot}`,
  });
  const regrouped = regroupK2PanelsAfterManualAdd({
    panels,
    roof: ROOF,
    config,
    mppImage: 0.1,
  });

  assert.equal(regrouped.length, 2);
  assert.equal(regrouped[0].advanced?.montageFieldKey, regrouped[1].advanced?.montageFieldKey);
  assert.match(regrouped[0].advanced?.montageFieldKey ?? "", /manual-regroup/);
});

test("D-Dome rejects the entire pair when one side collides", () => {
  const config = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const initial = buildAdvancedManualCandidate({
    ...BASE,
    centerPx: { x: 80, y: 60 },
    config,
  });
  assert.equal(initial.valid, true);
  const firstSlot = initial.modules[0];
  const blocker: PanelInstance = {
    id: "blocker",
    roofId: ROOF.id,
    cx: firstSlot.cx,
    cy: firstSlot.cy,
    wPx: firstSlot.wPx,
    hPx: firstSlot.hPx,
    angleDeg: firstSlot.angleDeg,
    orientation: "landscape",
    panelId: PANEL.id,
  };
  const blocked = buildAdvancedManualCandidate({
    ...BASE,
    panels: [blocker],
    centerPx: { x: 80, y: 60 },
    config,
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.modules.length, 2);
  assert.ok(blocked.reasons.includes("panel-overlap"));
  assert.deepEqual(materializeManualAdvancedPanels({
    candidate: blocked,
    roofId: ROOF.id,
    config,
    layoutRunId: "blocked",
    blockKey: "blocked",
    montageFieldKey: "blocked-field",
    createPanelId: (slot) => `blocked-${slot}`,
  }), []);
});

test("advanced snapping is deterministic and Shift bypasses it", () => {
  const config = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const definition = resolveManualAdvancedBlockDefinition(config);
  assert.ok(definition);
  const existing: PanelInstance[] = [0, 1].map((slot) => ({
    id: `existing-${slot}`,
    roofId: ROOF.id,
    cx: 50 + slot * 4,
    cy: 50,
    wPx: 10,
    hPx: 10,
    angleDeg: 0,
    orientation: "landscape",
    panelId: PANEL.id,
    advanced: {
      layoutMode: "advanced",
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: "07-481-08@2023-05-05",
      advancedEngineVersion: "advanced-block-v1",
      geometryEngineVersion: "geometry-v2",
      blockKey: "block-a",
      slotIndex: slot,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.65,
      moduleFaceAzimuthDeg: slot ? 270 : 90,
      layoutRunId: "run",
    },
  }));
  const pointer = { x: 52.2, y: 76.2 };
  const bypassed = snapAdvancedManualCenter({
    pointerPx: pointer,
    roofId: ROOF.id,
    panels: existing,
    definition,
    mppImage: 0.1,
    disableSnap: true,
  });
  assert.deepEqual(bypassed, pointer);
  const first = snapAdvancedManualCenter({
    pointerPx: pointer,
    roofId: ROOF.id,
    panels: existing,
    definition,
    mppImage: 0.1,
    disableSnap: false,
  });
  const second = snapAdvancedManualCenter({
    pointerPx: pointer,
    roofId: ROOF.id,
    panels: existing,
    definition,
    mppImage: 0.1,
    disableSnap: false,
  });
  assert.deepEqual(first, second);
});

test("a fixed committed layout reports truthful actual counts after manual addition", () => {
  const result = buildGuidedPlanningResult({
    valid: true,
    quantityMode: "fixed",
    blocksPerRow: 5,
    rowCount: 3,
    requestedBlockCount: 16,
    validBlockCount: 16,
    requestedModuleCount: 32,
    validModuleCount: 32,
    powerW: 440,
    montageFieldCount: 2,
    manuallyAdjusted: true,
  });
  assert.equal(result.blockCount, 16);
  assert.equal(result.moduleCount, 32);
  assert.equal(result.powerKWp, 14.08);
  assert.equal(result.arrangementLabel, "5 × 3 · manuell angepasst");
});
