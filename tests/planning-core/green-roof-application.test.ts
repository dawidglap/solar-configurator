import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
  type AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import { resizeRectangularRoof } from "../../src/lib/planning-core/geometry-v2";
import {
  applyRoofLayoutTransaction,
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  materializeAdvancedPanels,
  setAdvancedModuleOrientation,
  setAdvancedMountingOrientation,
  setAdvancedSurfaceKind,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type {
  ModulesConfig,
  PanelInstance,
  PanelSpec,
  RoofArea,
} from "../../src/types/planner";

const MPP_IMAGE = 0.1;
const MODULE: PanelSpec = {
  id: "green-module-440",
  brand: "Test",
  model: "Green 440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};
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

function roof(points?: RoofArea["points"]): RoofArea {
  return {
    id: "green-roof",
    name: "Green roof",
    points: points ?? [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 180 },
      { x: 0, y: 180 },
    ],
  };
}

function flatConfig(): AdvancedSurfacePlanningV1 {
  return createInitialAdvancedPlanning({
    panel: MODULE,
    standardModules: STANDARD_MODULES,
  });
}

function greenConfig(
  orientation: "south" | "east-west" = "east-west",
): AdvancedSurfacePlanningV1 {
  const green = setAdvancedSurfaceKind({ config: flatConfig(), kind: "green" });
  return setAdvancedMountingOrientation({ config: green, orientation });
}

function preview(
  config: AdvancedSurfacePlanningV1,
  selectedRoof: RoofArea = roof(),
  zones: Array<{ id: string; roofId: string; points: RoofArea["points"] }> = [],
) {
  return computeAdvancedPlanningPreview({
    roof: selectedRoof,
    config,
    mppImage: MPP_IMAGE,
    zones,
    snowGuards: [],
  });
}

function oldPanel(): PanelInstance {
  return {
    id: "old-panel",
    roofId: "green-roof",
    cx: 10,
    cy: 10,
    wPx: 10,
    hPx: 17,
    angleDeg: 0,
    orientation: "portrait",
    panelId: MODULE.id,
  };
}

test("A/B: GreenRoof and Höhe UK remain draft inputs and clearance does not alter plan geometry", () => {
  const committed = flatConfig();
  const draft = greenConfig();
  assert.equal(committed.surface.kind, "flat");
  assert.equal(draft.surface.kind, "green");
  assert.equal(draft.advanced.undersideClearanceM, 0.3);
  assert.equal(committed.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);

  const before = preview(draft);
  const raised = {
    ...draft,
    advanced: { ...draft.advanced, undersideClearanceM: 0.6 },
  };
  const after = preview(raised);
  assert.equal(before.valid && after.valid, true);
  if (!before.valid || !after.valid) return;
  assert.deepEqual(after.blocks, before.blocks);
  assert.deepEqual(after.modules, before.modules);
});

test("C/D: Green South uses one generic module per block and East-West uses two", () => {
  const south = greenConfig("south");
  const southPreview = preview(south);
  assert.equal(south.advanced.system.systemId, GENERIC_SOUTH_SYSTEM_ID);
  assert.equal(southPreview.valid, true);
  if (southPreview.valid) {
    assert.equal(southPreview.moduleCount, southPreview.blockCount);
  }

  const eastWest = greenConfig("east-west");
  const eastWestPreview = preview(eastWest);
  assert.equal(eastWest.advanced.system.systemId, GENERIC_EAST_WEST_SYSTEM_ID);
  assert.equal(eastWestPreview.valid, true);
  if (eastWestPreview.valid) {
    assert.equal(eastWestPreview.moduleCount, eastWestPreview.blockCount * 2);
    assert.deepEqual(
      [...new Set(eastWestPreview.modules.map((module) => module.faceAzimuthDeg))],
      [90, 270],
    );
  }
});

test("E: GreenRoof generic preview supports portrait and landscape", () => {
  const base = greenConfig("south");
  const portrait = setAdvancedModuleOrientation({ config: base, orientation: "portrait" });
  const landscape = setAdvancedModuleOrientation({ config: base, orientation: "landscape" });
  const portraitPreview = preview(portrait);
  const landscapePreview = preview(landscape);
  assert.equal(portraitPreview.valid && landscapePreview.valid, true);
  if (!portraitPreview.valid || !landscapePreview.valid) return;
  assert.notDeepEqual(
    portraitPreview.modules[0].footprintPx,
    landscapePreview.modules[0].footprintPx,
  );
});

test("F/G/H: module and block gaps independently change generic pitch", () => {
  const base = greenConfig("south");
  assert.equal(base.advanced.system.systemId, GENERIC_SOUTH_SYSTEM_ID);
  if (base.advanced.system.systemId !== GENERIC_SOUTH_SYSTEM_ID) return;
  const withModuleX = {
    ...base,
    advanced: {
      ...base.advanced,
      system: { ...base.advanced.system, moduleGapX: 0.4 },
    },
  };
  const withModuleY = {
    ...base,
    advanced: {
      ...base.advanced,
      system: { ...base.advanced.system, moduleGapY: 0.5 },
    },
  };
  const withBlock = {
    ...base,
    advanced: {
      ...base.advanced,
      system: { ...base.advanced.system, blockGapX: 0.6, blockGapY: 0.7 },
    },
  };
  const previews = [base, withModuleX, withModuleY, withBlock].map((config) => preview(config));
  assert.ok(previews.every((current) => current.valid));
  if (!previews.every((current) => current.valid)) return;
  const [original, moduleX, moduleY, block] = previews;
  if (!original.valid || !moduleX.valid || !moduleY.valid || !block.valid) return;
  assert.equal(original.derived.kind, "generic");
  assert.equal(moduleX.derived.kind, "generic");
  assert.equal(moduleY.derived.kind, "generic");
  assert.equal(block.derived.kind, "generic");
  if (
    original.derived.kind !== "generic" ||
    moduleX.derived.kind !== "generic" ||
    moduleY.derived.kind !== "generic" ||
    block.derived.kind !== "generic"
  ) return;
  assert.ok(moduleX.derived.pitchXM > original.derived.pitchXM);
  assert.equal(moduleX.derived.pitchYM, original.derived.pitchYM);
  assert.ok(moduleY.derived.pitchYM > original.derived.pitchYM);
  assert.equal(moduleY.derived.pitchXM, original.derived.pitchXM);
  assert.ok(block.derived.pitchXM > original.derived.pitchXM);
  assert.ok(block.derived.pitchYM > original.derived.pitchYM);
});

test("I: a reserved polygon rejects complete GreenRoof blocks", () => {
  const config = greenConfig("east-west");
  const baseline = preview(config);
  const blocked = preview(config, roof(), [{
    id: "reserved-all",
    roofId: "green-roof",
    points: roof().points,
  }]);
  assert.equal(baseline.valid && blocked.valid, true);
  if (!baseline.valid || !blocked.valid) return;
  assert.ok(baseline.blockCount > 0);
  assert.equal(blocked.blockCount, 0);
  assert.equal(blocked.moduleCount, 0);
});

test("GreenRoof rejects invalid UK height, tilt and spacing without vendor claims", () => {
  const base = greenConfig("south");
  assert.equal(base.advanced.system.systemId, GENERIC_SOUTH_SYSTEM_ID);
  if (base.advanced.system.systemId !== GENERIC_SOUTH_SYSTEM_ID) return;
  const invalidClearance = {
    ...base,
    advanced: { ...base.advanced, undersideClearanceM: 0 },
  };
  const invalidTilt = {
    ...base,
    advanced: {
      ...base.advanced,
      system: { ...base.advanced.system, nominalTiltDeg: 46 },
    },
  };
  const invalidSpacing = {
    ...base,
    advanced: {
      ...base.advanced,
      system: { ...base.advanced.system, moduleGapX: -0.01 },
    },
  };
  for (const config of [invalidClearance, invalidTilt, invalidSpacing]) {
    const result = preview(config);
    assert.equal(result.valid, false);
    assert.equal(result.moduleCount, 0);
  }
});

test("J: manual roof resize recomputes the active GreenRoof preview", () => {
  const config = greenConfig("east-west");
  const selectedRoof = roof();
  const resized = resizeRectangularRoof({
    pointsPx: selectedRoof.points,
    mppImage: MPP_IMAGE,
    lengthM: 40,
    widthM: 18,
  });
  assert.equal(resized.valid, true);
  if (!resized.valid) return;
  const before = preview(config, selectedRoof);
  const after = preview(config, roof(resized.points));
  assert.equal(before.valid && after.valid, true);
  if (!before.valid || !after.valid) return;
  assert.ok(after.blockCount > before.blockCount);
});

test("K/L/M: Cancel preserves committed data; Apply and JSON reload preserve Höhe UK and generic metadata", () => {
  const selectedRoof = roof();
  const previousPanel = oldPanel();
  const draft = greenConfig("east-west");
  const computed = preview(draft, selectedRoof);
  assert.equal(computed.valid, true);
  if (!computed.valid) return;

  assert.equal(selectedRoof.surfacePlanning, undefined);
  assert.equal(previousPanel.id, "old-panel");

  const nextPanels = materializeAdvancedPanels({
    roofId: selectedRoof.id,
    config: draft,
    preview: computed,
    layoutRunId: "green-run",
    createPanelId: (index) => `green-${index}`,
  });
  const applied = applyRoofLayoutTransaction({
    roofs: [selectedRoof],
    panels: [previousPanel],
    roofId: selectedRoof.id,
    nextPanels,
    surfacePlanning: draft,
  });
  const loaded = JSON.parse(JSON.stringify(applied)) as typeof applied;
  const resolution = resolveSurfacePlanning(loaded.roofs[0].surfacePlanning);
  assert.equal(resolution.status, "supported-advanced");
  if (resolution.status !== "supported-advanced") return;
  assert.equal(resolution.config.surface.kind, "green");
  assert.equal(resolution.config.advanced.undersideClearanceM, 0.3);
  assert.equal(resolution.config.advanced.system.systemId, GENERIC_EAST_WEST_SYSTEM_ID);
  assert.equal(loaded.panels.some((panel) => panel.id === "old-panel"), false);
  assert.ok(loaded.panels.every((panel) => panel.advanced?.systemId === GENERIC_EAST_WEST_SYSTEM_ID));
});

test("M2: planner store export/import preserves applied GreenRoof configuration", async () => {
  const { usePlannerV2Store } = await import(
    "../../src/components_v2/state/plannerV2Store"
  );
  const config = greenConfig("south");
  const computed = preview(config);
  assert.equal(computed.valid, true);
  if (!computed.valid) return;
  const panels = materializeAdvancedPanels({
    roofId: "green-roof",
    config,
    preview: computed,
    layoutRunId: "store-green",
    createPanelId: (index) => `store-green-${index}`,
  });
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [roof()], panels: [] });
  usePlannerV2Store.getState().commitRoofLayout({
    roofId: "green-roof",
    panels,
    surfacePlanning: config,
  });
  const saved = JSON.parse(
    JSON.stringify(usePlannerV2Store.getState().exportState()),
  );
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().importState(saved);
  const loaded = usePlannerV2Store.getState();
  const resolution = loaded.getSurfacePlanning("green-roof");
  assert.equal(resolution.status, "supported-advanced");
  if (resolution.status === "supported-advanced") {
    assert.equal(resolution.config.advanced.undersideClearanceM, 0.3);
    assert.equal(resolution.config.advanced.system.systemId, GENERIC_SOUTH_SYSTEM_ID);
  }
  assert.equal(loaded.panels.length, panels.length);
  assert.ok(loaded.panels.every((panel) => panel.advanced?.systemId === GENERIC_SOUTH_SYSTEM_ID));
  usePlannerV2Store.getState().resetPlanner();
});

test("N/O: Flat K2 and implicit Standard remain unchanged", () => {
  const flat = flatConfig();
  assert.equal(flat.surface.kind, "flat");
  assert.equal(flat.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  assert.deepEqual(setAdvancedSurfaceKind({ config: flat, kind: "flat" }), flat);
  const south = setAdvancedMountingOrientation({ config: flat, orientation: "south" });
  assert.equal(south.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  assert.equal(preview(flat).valid, true);
  assert.equal(resolveSurfacePlanning(undefined).status, "legacy-standard");
});
