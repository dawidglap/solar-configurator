import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  createInitialAdvancedPlanning,
  fingerprintRoofPanels,
  hasManualRoofLayoutChanges,
  resolveRoofModuleMode,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type {
  ModulesConfig,
  PanelInstance,
  PanelSpec,
  RoofArea,
} from "../../src/types/planner";

const PANEL: PanelSpec = {
  id: "panel-440",
  brand: "Fixture",
  model: "M440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};

const MODULES: ModulesConfig = {
  gridAngleDeg: 17,
  orientation: "portrait",
  spacingM: 0.019,
  spacingXM: 0.019,
  spacingYM: 0.019,
  marginM: 0.3,
  showGrid: true,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 0.5,
  perRoofAngles: { "roof-direct": 42 },
};

const ROOF: RoofArea = {
  id: "roof-direct",
  name: "D1",
  roofKind: "pitched",
  referenceEdgeIndex: 0,
  tiltDeg: 25,
  points: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 180 },
    { x: 0, y: 180 },
  ],
};

test("a new roof has no module mode even though legacy geometry still resolves Standard", () => {
  assert.equal(resolveRoofModuleMode({ roof: ROOF, roofId: ROOF.id, panels: [] }), undefined);
  assert.equal(resolveSurfacePlanning(ROOF.surfacePlanning).status, "legacy-standard");

  const flat = { ...ROOF, roofKind: "flat" as const, tiltDeg: 0 };
  assert.equal(resolveRoofModuleMode({ roof: flat, roofId: flat.id, panels: [] }), undefined);
});

test("first pitched mode selection creates real maximum-valid panels aligned to First", () => {
  const generated = buildDirectStandardRoofLayout({
    roof: ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "landscape",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `generated-${index}`,
  });
  assert.ok(generated);
  assert.ok(generated.panels.length > 0);
  assert.equal(generated.modules.orientation, "landscape");
  assert.equal(generated.modules.coverageRatio, 1);
  assert.equal(generated.modules.showGrid, false);
  assert.equal(generated.modules.perRoofAngles?.[ROOF.id], undefined);
  assert.equal(resolveRoofModuleMode({
    roof: { ...ROOF, surfacePlanning: generated.config },
    roofId: ROOF.id,
    panels: generated.panels,
  }), "landscape");
  const reloaded = resolveSurfacePlanning(JSON.parse(JSON.stringify(generated.config)));
  assert.equal(reloaded.status, "supported-standard");
  assert.equal(
    reloaded.status === "supported-standard" ? reloaded.config.moduleLayoutMode : undefined,
    "landscape",
  );
  assert.equal(
    reloaded.status === "supported-standard" ? reloaded.config.generatedLayoutFingerprint : undefined,
    generated.config.generatedLayoutFingerprint,
  );
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...ROOF, surfacePlanning: generated.config },
    panels: generated.panels,
  }), false);
});

test("flat South and East-West restore from the persisted system discriminator", () => {
  const flatRoof = { ...ROOF, roofKind: "flat" as const, tiltDeg: 0 };
  const base = createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES });
  const south = setAdvancedMountingOrientation({ config: base, orientation: "south" });
  const eastWest = setAdvancedMountingOrientation({ config: base, orientation: "east-west" });

  assert.equal(south.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  assert.equal(eastWest.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  assert.equal(resolveRoofModuleMode({ roof: { ...flatRoof, surfacePlanning: south }, roofId: flatRoof.id, panels: [] }), "south");
  assert.equal(resolveRoofModuleMode({ roof: { ...flatRoof, surfacePlanning: eastWest }, roofId: flatRoof.id, panels: [] }), "east-west");
});

test("first East-West selection materializes whole two-module blocks", () => {
  const flatRoof = { ...ROOF, roofKind: "flat" as const, tiltDeg: 0 };
  const config = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    orientation: "east-west",
  });
  const generated = buildDirectAdvancedRoofLayout({
    roof: flatRoof,
    config,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    layoutRunId: "direct-run",
    createPanelId: (index) => `advanced-${index}`,
  });
  assert.ok(generated);
  assert.ok(generated.panels.length > 0);
  assert.equal(generated.panels.length % 2, 0);
  const byBlock = new Map<string, PanelInstance[]>();
  for (const panel of generated.panels) {
    const key = panel.advanced?.blockKey;
    assert.ok(key);
    byBlock.set(key, [...(byBlock.get(key) ?? []), panel]);
  }
  for (const blockPanels of byBlock.values()) {
    assert.equal(blockPanels.length, 2);
    assert.deepEqual(blockPanels.map((panel) => panel.advanced?.slotIndex).sort(), [0, 1]);
  }
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: generated.config },
    panels: generated.panels,
  }), false);
  const reloaded = resolveSurfacePlanning(JSON.parse(JSON.stringify(generated.config)));
  assert.equal(reloaded.status, "supported-advanced");
  assert.equal(
    reloaded.status === "supported-advanced" ? reloaded.config.generatedLayoutFingerprint : undefined,
    generated.config.generatedLayoutFingerprint,
  );
});

test("the deterministic baseline detects move, delete and manual add without a stale boolean", () => {
  const generated = buildDirectStandardRoofLayout({
    roof: ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `baseline-${index}`,
  });
  assert.ok(generated);
  const persistedRoof = { ...ROOF, surfacePlanning: generated.config };
  assert.equal(generated.config.generatedLayoutFingerprint, fingerprintRoofPanels(generated.panels, ROOF.id));

  const moved = generated.panels.map((panel, index) => index === 0 ? { ...panel, cx: panel.cx + 1 } : panel);
  assert.equal(hasManualRoofLayoutChanges({ roof: persistedRoof, panels: moved }), true);
  assert.equal(hasManualRoofLayoutChanges({ roof: persistedRoof, panels: generated.panels.slice(1) }), true);
  assert.equal(hasManualRoofLayoutChanges({
    roof: persistedRoof,
    panels: [...generated.panels, { ...generated.panels[0], id: "manual-extra" }],
  }), true);
});

test("legacy panels infer orientation only when all non-advanced modules agree", () => {
  const panel = (id: string, orientation: "portrait" | "landscape"): PanelInstance => ({
    id,
    roofId: ROOF.id,
    cx: 10,
    cy: 10,
    wPx: 10,
    hPx: 17,
    angleDeg: 0,
    orientation,
    panelId: PANEL.id,
  });
  assert.equal(resolveRoofModuleMode({ roof: ROOF, roofId: ROOF.id, panels: [panel("a", "portrait"), panel("b", "portrait")] }), "portrait");
  assert.equal(resolveRoofModuleMode({ roof: ROOF, roofId: ROOF.id, panels: [panel("a", "portrait"), panel("b", "landscape")] }), undefined);
});

test("customer UI is mode-explicit, direct and free of obsolete full-layout controls", () => {
  const modulesPanel = readFileSync(new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url), "utf8");
  const advancedPanel = readFileSync(new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url), "utf8");

  assert.ok(modulesPanel.includes("requestModuleMode(orientation)"));
  assert.ok(modulesPanel.includes("Layout neu erstellen?"));
  assert.ok(modulesPanel.includes("Manuelle Änderungen werden dabei ersetzt."));
  assert.equal(modulesPanel.includes("Vorschau als Module platzieren"), false);
  assert.equal(modulesPanel.includes(">Belegung<"), false);
  assert.equal(modulesPanel.includes("Parallel zum First"), false);
  assert.equal(advancedPanel.includes("Parallel zur Dachkante"), false);
  assert.ok(advancedPanel.includes("Wähle Süd oder Ost-West"));
  assert.ok(advancedPanel.includes("activeMode\n      ? computeAdvancedPlanningPreview"));
  assert.ok(toolbar.includes('actionId="planner-fill-layout"'));
  assert.ok(toolbar.includes('actionId="planner-regenerate-layout"'));
  assert.ok(toolbar.includes("Zuerst Hochformat oder Querformat wählen"));
  assert.ok(toolbar.includes("Zuerst Süd oder Ost-West wählen"));
});
