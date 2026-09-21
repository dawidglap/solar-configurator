import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyConfirmedModuleModeChange,
  resolveModuleModeChangeIntent,
  type RoofPlanningDraft,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
  type SurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import { GEOMETRY_V2_ENGINE_VERSION } from "../../src/lib/planning-core/geometry-v2";
import type { PanelInstance, RoofArea } from "../../src/types/planner";

function roof(id: string, surfacePlanning?: SurfacePlanningV1): RoofArea {
  return {
    id,
    name: id,
    roofKind: "flat",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    ...(surfacePlanning ? { surfacePlanning } : {}),
  };
}

function panel(roofId: string, index: number): PanelInstance {
  return {
    id: `${roofId}-${index}`,
    roofId,
    cx: index,
    cy: index,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
    orientation: "landscape",
    panelId: "module-a",
    advanced: {
      systemId: "generic-south",
      adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
      layoutMode: "advanced",
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      blockKey: `block-${index}`,
      slotIndex: 0,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 10,
      moduleFaceAzimuthDeg: 180,
      montageFieldKey: "F1",
      thermalFieldKey: "T1",
      layoutRunId: "old-run",
    },
  };
}

const southConfig: AdvancedSurfacePlanningV1 = {
  schemaVersion: 1,
  mode: "advanced",
  surface: { kind: "flat", slopeDeg: 0, fallAzimuthDeg: 180 },
  generatedLayoutFingerprint: "old-layout",
  advanced: {
    inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
    advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
    geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
    module: {
      panelSpecId: "module-a",
      widthM: 1.134,
      heightM: 1.722,
      orientation: "landscape",
      powerW: 440,
    },
    system: {
      systemId: "generic-south",
      adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
      nominalTiltDeg: 10,
      faceAzimuthDeg: 180,
      moduleGapX: 0.019,
      moduleGapY: 0,
      blockGapX: 0,
      blockGapY: 0.5,
    },
    layout: { marginM: 0.3, phaseX: 0, phaseY: 0, anchorX: "start", anchorY: "start" },
  },
};

const eastWestConfig: AdvancedSurfacePlanningV1 = {
  ...southConfig,
  generatedLayoutFingerprint: "must-be-cleared",
  advanced: {
    ...southConfig.advanced,
    system: {
      systemId: "generic-east-west",
      adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
      nominalTiltDeg: 10,
      primaryFaceAzimuthDeg: 90,
      interModuleGapM: 0.078,
      moduleGapX: 0.019,
      blockGapX: 0,
      blockGapY: 0.5,
    },
  },
};

test("mode-switch intent distinguishes empty, pristine Standard and protected layouts", () => {
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "south", requestedMode: "south", committedPanelCount: 66 }), "noop");
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "south", requestedMode: "east-west", committedPanelCount: 66 }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "east-west", requestedMode: "south", committedPanelCount: 30 }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "portrait", requestedMode: "landscape", committedPanelCount: 20 }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "landscape", requestedMode: "portrait", committedPanelCount: 20 }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({ currentMode: "south", requestedMode: "east-west", committedPanelCount: 0 }), "switch");
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "portrait",
    requestedMode: "landscape",
    committedPanelCount: 27,
    pristineGeneratedLayout: true,
    regeneratePristineLayout: true,
  }), "regenerate");
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "portrait",
    requestedMode: "landscape",
    committedPanelCount: 26,
    pristineGeneratedLayout: false,
    regeneratePristineLayout: true,
  }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "south",
    requestedMode: "east-west",
    committedPanelCount: 30,
    pristineGeneratedLayout: true,
    regeneratePristineLayout: false,
  }), "confirm");
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "portrait",
    requestedMode: "landscape",
    committedPanelCount: 0,
    pristineGeneratedLayout: true,
    regeneratePristineLayout: true,
  }), "switch");
});

test("confirmed D1 Süd to Ost-West is one roof-local clear and preserves D2", () => {
  const d1Panels = Array.from({ length: 66 }, (_, index) => panel("d1", index));
  const d2Panels = Array.from({ length: 30 }, (_, index) => panel("d2", index));
  const d2Draft = { targetMode: "advanced", config: southConfig } satisfies RoofPlanningDraft;
  const result = applyConfirmedModuleModeChange({
    roofs: [roof("d1", southConfig), roof("d2", southConfig)],
    panels: [...d1Panels, ...d2Panels],
    roofPlanningDrafts: { d1: { targetMode: "advanced", config: southConfig }, d2: d2Draft },
    selectedPanelIds: [d1Panels[0].id, d2Panels[0].id],
    roofId: "d1",
    nextSurfacePlanning: eastWestConfig,
  });

  assert.equal(result.panels.filter((item) => item.roofId === "d1").length, 0);
  assert.equal(result.panels.filter((item) => item.roofId === "d2").length, 30);
  assert.deepEqual(result.selectedPanelIds, [d2Panels[0].id]);
  assert.equal(result.roofPlanningDrafts.d1, undefined);
  assert.equal(result.roofPlanningDrafts.d2, d2Draft);
  assert.equal(result.roofs[0].surfacePlanning?.generatedLayoutFingerprint, undefined);
  assert.equal(result.roofs[1].surfacePlanning?.generatedLayoutFingerprint, "old-layout");
  const changed = resolveSurfacePlanning(result.roofs[0].surfacePlanning);
  assert.equal(changed.status, "supported-advanced");
  if (changed.status === "supported-advanced") {
    assert.equal(changed.config.advanced.system.systemId, "generic-east-west");
  }
});

test("mode-switch dialog owns the destructive decision before draft mutation", () => {
  const panelSource = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const dialogSource = readFileSync(
    new URL("../../src/components_v2/panels/LayoutModeChangeDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panelSource, /if \(intent === "confirm"\) \{\s*setPendingLayoutMode\(mode\);\s*return;/);
  assert.match(panelSource, /confirmModuleModeChange\(\{/);
  assert.match(dialogSource, /Ausrichtung ändern\?/);
  assert.match(dialogSource, /Alle Module auf dieser Dachfläche werden entfernt\./);
  assert.match(dialogSource, /Module entfernen & wechseln/);
  assert.match(dialogSource, /Manuelle Änderungen an der Modulbelegung werden dabei gelöscht\./);
  assert.match(dialogSource, /Ändern & neu belegen/);
  assert.match(panelSource, /hasManualRoofLayoutChanges\(\{ roof: selectedRoof, panels \}\)/);
  assert.match(panelSource, /intent === "regenerate"/);
  assert.match(panelSource, /buildDirectStandardRoofLayout\(/);
  assert.match(panelSource, /commitRoofLayout\(\{[\s\S]*panels: candidate\.panels,[\s\S]*surfacePlanning: candidate\.config/);
  assert.equal(dialogSource.includes("window.confirm"), false);
});

test("store confirmation is one undoable mutation and preserves roof objects", async () => {
  const [{ usePlannerV2Store }, { history }] = await Promise.all([
    import("../../src/components_v2/state/plannerV2Store"),
    import("../../src/components_v2/state/history"),
  ]);
  usePlannerV2Store.getState().resetPlanner();
  history.clear();
  const d1Panels = Array.from({ length: 66 }, (_, index) => panel("d1", index));
  const d2Panels = Array.from({ length: 30 }, (_, index) => panel("d2", index));
  const zones = [{
    id: "zone-d1",
    roofId: "d1",
    type: "riservata" as const,
    points: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }],
  }];
  const snowGuards = [{
    id: "snow-d1",
    roofId: "d1",
    p1: { x: 10, y: 10 },
    p2: { x: 20, y: 10 },
  }];
  usePlannerV2Store.setState({
    layers: [roof("d1", southConfig), roof("d2", southConfig)],
    panels: [...d1Panels, ...d2Panels],
    selectedPanelIds: [d1Panels[0].id],
    zones,
    snowGuards,
    roofPlanningDrafts: {},
  });

  usePlannerV2Store.getState().confirmModuleModeChange({
    roofId: "d1",
    nextSurfacePlanning: eastWestConfig,
  });
  let state = usePlannerV2Store.getState();
  assert.equal(state.panels.filter((item) => item.roofId === "d1").length, 0);
  assert.equal(state.panels.filter((item) => item.roofId === "d2").length, 30);
  assert.deepEqual(state.selectedPanelIds, []);
  assert.deepEqual(state.zones, zones);
  assert.deepEqual(state.snowGuards, snowGuards);

  history.undo();
  state = usePlannerV2Store.getState();
  assert.equal(state.panels.filter((item) => item.roofId === "d1").length, 66);
  assert.equal(state.panels.filter((item) => item.roofId === "d2").length, 30);
  assert.deepEqual(state.selectedPanelIds, [d1Panels[0].id]);
  assert.deepEqual(state.zones, zones);
  assert.deepEqual(state.snowGuards, snowGuards);
  history.clear();
  usePlannerV2Store.getState().resetPlanner();
});
