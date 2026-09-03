import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStandardModuleTilt,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import {
  alignStandardModulesParallelToFirst,
  buildStandardPanelMetadata,
  buildStandardSurfacePlanning,
  createStandardPlanningDraft,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type { ModulesConfig, RoofArea } from "../../src/types/planner";

const modules: ModulesConfig = {
  gridAngleDeg: 0,
  orientation: "portrait",
  spacingM: 0.019,
  marginM: 0.3,
  showGrid: true,
  placingSingle: false,
};

const roof: RoofArea = {
  id: "roof-pitched",
  name: "D1",
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  tiltDeg: 25,
  fallAzimuthDeg: 180,
};

test("legacy Standard module tilt inherits the current roof slope without migration", () => {
  assert.equal(resolveSurfacePlanning(undefined).status, "legacy-standard");
  assert.deepEqual(resolveStandardModuleTilt({ roofSlopeDeg: 25 }), {
    mode: "inherit-roof",
    effectiveTiltDeg: 25,
  });
});

test("inherit mode follows later roof slope changes while custom mode stays explicit", () => {
  const inherited = { mode: "inherit-roof" } as const;
  assert.equal(resolveStandardModuleTilt({ moduleTilt: inherited, roofSlopeDeg: 25 }).effectiveTiltDeg, 25);
  assert.equal(resolveStandardModuleTilt({ moduleTilt: inherited, roofSlopeDeg: 30 }).effectiveTiltDeg, 30);

  const custom = { mode: "custom", customTiltDeg: 15 } as const;
  assert.equal(resolveStandardModuleTilt({ moduleTilt: custom, roofSlopeDeg: 25 }).effectiveTiltDeg, 15);
  assert.equal(resolveStandardModuleTilt({ moduleTilt: custom, roofSlopeDeg: 30 }).effectiveTiltDeg, 15);
});

test("custom Standard tilt survives canonical JSON save/load", () => {
  const config = buildStandardSurfacePlanning({
    roof,
    moduleTilt: { mode: "custom", customTiltDeg: 17 },
  });
  const loaded = resolveSurfacePlanning(JSON.parse(JSON.stringify(config)));
  assert.equal(loaded.status, "supported-standard");
  if (loaded.status !== "supported-standard") return;
  assert.deepEqual(loaded.config.moduleTilt, { mode: "custom", customTiltDeg: 17 });
  assert.equal(resolveStandardModuleTilt({
    moduleTilt: loaded.config.moduleTilt,
    roofSlopeDeg: loaded.config.surface.slopeDeg,
  }).effectiveTiltDeg, 17);
});

test("invalid custom Standard tilt is rejected structurally", () => {
  const config = buildStandardSurfacePlanning({ roof, moduleTilt: { mode: "inherit-roof" } });
  const loaded = resolveSurfacePlanning({ ...config, moduleTilt: { mode: "custom", customTiltDeg: -1 } });
  assert.equal(loaded.status, "invalid-document");
});

test("draft and applied panel metadata distinguish inherit from custom", () => {
  const draft = createStandardPlanningDraft({
    panelSpecId: "panel-1",
    modules,
    moduleTilt: { mode: "custom", customTiltDeg: 15 },
  });
  assert.deepEqual(draft.moduleTilt, { mode: "custom", customTiltDeg: 15 });
  assert.deepEqual(buildStandardPanelMetadata({ roofSlopeDeg: 25, moduleTilt: draft.moduleTilt }), {
    layoutMode: "standard",
    moduleTiltMode: "custom",
    effectiveTiltDeg: 15,
  });
  assert.deepEqual(buildStandardPanelMetadata({ roofSlopeDeg: 25 }), {
    layoutMode: "standard",
    moduleTiltMode: "inherit-roof",
    effectiveTiltDeg: 25,
  });
});

test("Parallel zum First clears only the selected roof override and preserves legacy inputs", () => {
  const aligned = alignStandardModulesParallelToFirst({
    roofId: "roof-pitched",
    modules: {
      ...modules,
      gridAngleDeg: 12,
      perRoofAngles: { "roof-pitched": 128, "roof-other": 42 },
      gridPhaseX: 0.25,
    },
  });
  assert.equal(aligned.gridAngleDeg, 0);
  assert.deepEqual(aligned.perRoofAngles, { "roof-other": 42 });
  assert.equal(aligned.gridPhaseX, 0.25);
});

test("applied Standard tilt config and panel metadata survive planner export/import", async () => {
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  const config = buildStandardSurfacePlanning({
    roof,
    moduleTilt: { mode: "custom", customTiltDeg: 17 },
  });
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({
    layers: [{ ...roof, surfacePlanning: config }],
    panels: [{
      id: "panel-applied",
      roofId: roof.id,
      cx: 25,
      cy: 25,
      wPx: 10,
      hPx: 20,
      angleDeg: 0,
      orientation: "portrait",
      panelId: "panel-1",
      standard: {
        layoutMode: "standard",
        moduleTiltMode: "custom",
        effectiveTiltDeg: 17,
      },
    }],
  });
  const saved = usePlannerV2Store.getState().exportState();
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().importState(JSON.parse(JSON.stringify(saved)));
  const loaded = usePlannerV2Store.getState();
  assert.deepEqual(loaded.layers[0].surfacePlanning, config);
  assert.deepEqual(loaded.panels[0].standard, {
    layoutMode: "standard",
    moduleTiltMode: "custom",
    effectiveTiltDeg: 17,
  });
  usePlannerV2Store.getState().resetPlanner();
});

test("tilt and fine-adjustment drafts do not mutate committed Standard panels", async () => {
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  const committedPanel = {
    id: "committed",
    roofId: roof.id,
    cx: 20,
    cy: 20,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
    orientation: "portrait" as const,
    panelId: "panel-1",
  };
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [roof], panels: [committedPanel], roofPlanningDrafts: {} });
  usePlannerV2Store.getState().setRoofPlanningDraft(roof.id, createStandardPlanningDraft({
    panelSpecId: "panel-1",
    modules: { ...modules, gridPhaseX: 0.5, perRoofAngles: { [roof.id]: 128 } },
    moduleTilt: { mode: "custom", customTiltDeg: 15 },
  }));
  assert.deepEqual(usePlannerV2Store.getState().panels, [committedPanel]);
  assert.equal("roofPlanningDrafts" in usePlannerV2Store.getState().exportState(), false);
  usePlannerV2Store.getState().clearRoofPlanningDraft(roof.id);
  assert.deepEqual(usePlannerV2Store.getState().panels, [committedPanel]);
  usePlannerV2Store.getState().resetPlanner();
});
