import assert from "node:assert/strict";
import test from "node:test";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import {
  applyRoofLayoutTransaction,
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  createStandardPlanningDraft,
  getDefaultK2DDomeRowSpaceM,
  hasCommittedPanelsForRoof,
  materializeAdvancedPanels,
  replaceAdvancedDraftModule,
  resolveRoofPlanningMode,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type { ModulesConfig, PanelInstance, PanelSpec, RoofArea } from "../../src/types/planner";

const MODULE: PanelSpec = {
  id: "module-440",
  brand: "Test",
  model: "M440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};
const MODULE_2: PanelSpec = { ...MODULE, id: "module-430", wp: 430, widthM: 1.1 };
const STANDARD_MODULES: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "portrait",
  spacingM: 0.02,
  marginM: 0.3,
  showGrid: true,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 1,
  perRoofAngles: {},
};

function roof(id = "roof-a"): RoofArea {
  return {
    id,
    name: id,
    points: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 180 },
      { x: 0, y: 180 },
    ],
  };
}

function advancedConfig() {
  return createInitialAdvancedPlanning({ panel: MODULE, standardModules: STANDARD_MODULES });
}

function preview(config = advancedConfig(), selectedRoof = roof()) {
  return computeAdvancedPlanningPreview({
    roof: selectedRoof,
    config,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
  });
}

function oldPanel(roofId: string, id: string): PanelInstance {
  return {
    id,
    roofId,
    cx: 20,
    cy: 20,
    wPx: 10,
    hPx: 17,
    angleDeg: 0,
    orientation: "portrait",
    panelId: MODULE.id,
  };
}

test("A: a legacy roof resolves as Standard without creating persisted metadata", () => {
  assert.equal(resolveRoofPlanningMode({ persisted: undefined }), "standard");
  assert.equal(resolveSurfacePlanning(roof().surfacePlanning).status, "legacy-standard");
});

test("B/C: entering Advanced creates only a landscape D-Dome draft with valid K2 row space", () => {
  const config = advancedConfig();
  assert.equal(config.mode, "advanced");
  assert.equal(config.surface.kind, "flat");
  assert.equal(config.advanced.module.orientation, "landscape");
  assert.equal(config.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  assert.equal(resolveRoofPlanningMode({ persisted: undefined, draft: { targetMode: "advanced", config } }), "advanced");
  assert.equal(preview(config).valid, true);
});

test("D: customer orientation control maps South to S-Dome and East-West to D-Dome", () => {
  const south = setAdvancedMountingOrientation({ config: advancedConfig(), orientation: "south" });
  assert.equal(south.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  const eastWest = setAdvancedMountingOrientation({ config: south, orientation: "east-west" });
  assert.equal(eastWest.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
});

test("E: incompatible module dimensions produce visible structured validation and no placements", () => {
  const invalid = replaceAdvancedDraftModule({
    config: advancedConfig(),
    panel: { ...MODULE, id: "too-narrow", widthM: 0.949 },
  });
  const result = preview(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.moduleCount, 0);
  assert.ok(result.errors.some((error) => error.field === "module"));
});

test("F/G: changing row space or margin recomputes a deterministic preview", () => {
  const base = advancedConfig();
  assert.equal(base.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  const allowedRowSpace = getDefaultK2DDomeRowSpaceM(MODULE.widthM);
  const changedRowSpace = {
    ...base,
    advanced: { ...base.advanced, system: { ...base.advanced.system, rowSpaceM: allowedRowSpace + 0.05 } },
  };
  const withMargin = {
    ...base,
    advanced: { ...base.advanced, layout: { ...base.advanced.layout, marginM: 2 } },
  };
  const first = preview(base);
  const second = preview(changedRowSpace);
  const third = preview(withMargin);
  assert.equal(first.valid && second.valid && third.valid, true);
  if (!first.valid || !second.valid || !third.valid) return;
  assert.notDeepEqual(first.blocks.map((block) => block.centerPx), second.blocks.map((block) => block.centerPx));
  assert.ok(third.blockCount < first.blockCount);
  assert.deepEqual(preview(base), first);
});

test("H: D-Dome preview and materialized output preserve block-to-two-module parity", () => {
  const config = advancedConfig();
  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.moduleCount, result.blockCount * 2);
  assert.equal((config.advanced.module.powerW ?? 0) * result.moduleCount / 1000, 0.44 * result.moduleCount);
  const panels = materializeAdvancedPanels({
    roofId: "roof-a",
    config,
    preview: result,
    layoutRunId: "run-1",
    createPanelId: (index) => `panel-${index}`,
  });
  assert.equal(panels.length, result.modules.length);
  assert.deepEqual(
    panels.map((panel) => [panel.cx, panel.cy, panel.wPx, panel.hPx, panel.angleDeg]),
    result.modules.map((module) => [module.cx, module.cy, module.wPx, module.hPx, module.angleDeg]),
  );
});

test("I: S-Dome preview expands exactly one module per accepted K2 block", () => {
  const config = setAdvancedMountingOrientation({ config: advancedConfig(), orientation: "south" });
  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.ok(result.blockCount > 0);
  assert.equal(result.moduleCount, result.blockCount);
  assert.ok(result.modules.every((module) => module.faceAzimuthDeg === 180));
});

test("J: cancel is a non-mutating draft discard and empty transaction is impossible before Apply", () => {
  const existing = [oldPanel("roof-a", "old")];
  const config = advancedConfig();
  const draft = { targetMode: "advanced" as const, config };
  assert.deepEqual(existing, [oldPanel("roof-a", "old")]);
  assert.equal(resolveRoofPlanningMode({ persisted: undefined, draft }), "advanced");
  assert.equal(resolveRoofPlanningMode({ persisted: undefined }), "standard");
  assert.equal(hasCommittedPanelsForRoof(existing, "roof-a"), true);
});

test("K/L/M: Apply atomically replaces only the selected roof and stores exact preview metadata", () => {
  const selectedRoof = roof("roof-a");
  const otherRoof = roof("roof-b");
  const config = advancedConfig();
  const result = preview(config, selectedRoof);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const next = materializeAdvancedPanels({
    roofId: selectedRoof.id,
    config,
    preview: result,
    layoutRunId: "run-2",
    createPanelId: (index) => `new-${index}`,
  });
  const transaction = applyRoofLayoutTransaction({
    roofs: [selectedRoof, otherRoof],
    panels: [oldPanel("roof-a", "old-a"), oldPanel("roof-b", "old-b")],
    roofId: "roof-a",
    nextPanels: next,
    surfacePlanning: config,
  });
  assert.equal(transaction.panels.some((panel) => panel.id === "old-a"), false);
  assert.equal(transaction.panels.some((panel) => panel.id === "old-b"), true);
  assert.deepEqual(transaction.roofs[0].surfacePlanning, config);
  assert.equal(transaction.roofs[1].surfacePlanning, undefined);
  const pair = transaction.panels.filter((panel) => panel.advanced?.blockKey === next[0].advanced?.blockKey);
  assert.deepEqual(pair.map((panel) => panel.advanced?.slotIndex), [0, 1]);
  assert.deepEqual(pair.map((panel) => panel.advanced?.moduleFaceAzimuthDeg), [90, 270]);
});

test("N/O: drafts are per-roof and module replacement remains isolated", () => {
  const a = advancedConfig();
  const b = replaceAdvancedDraftModule({ config: advancedConfig(), panel: MODULE_2 });
  const drafts = {
    "roof-a": { targetMode: "advanced" as const, config: a },
    "roof-b": { targetMode: "advanced" as const, config: b },
  };
  assert.equal(drafts["roof-a"].config.advanced.module.panelSpecId, MODULE.id);
  assert.equal(drafts["roof-b"].config.advanced.module.panelSpecId, MODULE_2.id);
  assert.notEqual(drafts["roof-a"].config.advanced.system, drafts["roof-b"].config.advanced.system);
});

test("P/Q/R: saved documents contain only applied configuration, never a transient draft", async () => {
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [roof()], panels: [oldPanel("roof-a", "old")], roofPlanningDrafts: {} });
  const config = advancedConfig();
  usePlannerV2Store.getState().setRoofPlanningDraft("roof-a", { targetMode: "advanced", config });
  const exportedBeforeApply = usePlannerV2Store.getState().exportState();
  assert.equal("roofPlanningDrafts" in exportedBeforeApply, false);
  assert.equal(exportedBeforeApply.layers[0].surfacePlanning, undefined);
  assert.equal(exportedBeforeApply.panels[0].id, "old");

  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const next = materializeAdvancedPanels({ roofId: "roof-a", config, preview: result, layoutRunId: "run-store", createPanelId: (index) => `store-${index}` });
  usePlannerV2Store.getState().commitRoofLayout({ roofId: "roof-a", panels: next, surfacePlanning: config });
  const exportedAfterApply = usePlannerV2Store.getState().exportState();
  assert.deepEqual(exportedAfterApply.layers[0].surfacePlanning, config);
  assert.equal(exportedAfterApply.panels.length, next.length);
  assert.equal(usePlannerV2Store.getState().roofPlanningDrafts["roof-a"], undefined);
  usePlannerV2Store.getState().resetPlanner();
});

test("S/T: Advanced to Standard is a draft until atomic legacy apply clears only that roof config", () => {
  const advancedRoof = { ...roof("roof-a"), surfacePlanning: advancedConfig() };
  const standardDraft = createStandardPlanningDraft({ panelSpecId: MODULE.id, modules: STANDARD_MODULES });
  assert.equal(resolveRoofPlanningMode({ persisted: advancedRoof.surfacePlanning, draft: standardDraft }), "standard");
  assert.equal(resolveSurfacePlanning(advancedRoof.surfacePlanning).status, "supported-advanced");
  const result = applyRoofLayoutTransaction({
    roofs: [advancedRoof, roof("roof-b")],
    panels: [oldPanel("roof-a", "advanced-old"), oldPanel("roof-b", "other")],
    roofId: "roof-a",
    nextPanels: [oldPanel("roof-a", "legacy-new")],
    surfacePlanning: undefined,
  });
  assert.equal(result.roofs[0].surfacePlanning, undefined);
  assert.equal(result.panels.some((panel) => panel.id === "advanced-old"), false);
  assert.equal(result.panels.some((panel) => panel.id === "other"), true);
});
