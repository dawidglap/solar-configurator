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
  resolveModuleModeChangeIntent,
  resolveRoofModuleMode,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import { resolveStandardAutoLayoutCanvasAngle } from "../../src/components_v2/modules/legacyStandardApplicationPolicy";
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

test("canonical Standard generation resets manual rotation while additive generation preserves it", () => {
  const canonical = buildDirectStandardRoofLayout({
    roof: ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `canonical-${index}`,
  });
  const additive = buildDirectStandardRoofLayout({
    roof: ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `additive-${index}`,
    alignmentMode: "current",
  });
  assert.ok(canonical);
  assert.ok(additive);

  assert.equal(resolveStandardAutoLayoutCanvasAngle({
    roofId: ROOF.id,
    roofPolygon: ROOF.points,
    referenceEdgeIndex: ROOF.referenceEdgeIndex,
    gridAngleDeg: canonical.modules.gridAngleDeg,
    perRoofAngles: canonical.modules.perRoofAngles,
  }), 0);
  assert.equal(canonical.panels[0]?.angleDeg, 0);
  assert.equal(resolveStandardAutoLayoutCanvasAngle({
    roofId: ROOF.id,
    roofPolygon: ROOF.points,
    referenceEdgeIndex: ROOF.referenceEdgeIndex,
    gridAngleDeg: additive.modules.gridAngleDeg,
    perRoofAngles: additive.modules.perRoofAngles,
  }), 42);
  assert.equal(additive.panels[0]?.angleDeg, 42);
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

test("pristine Vollbelegung can alternate portrait and landscape with a fresh persisted baseline", () => {
  const portrait = buildDirectStandardRoofLayout({
    roof: ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    createPanelId: (index) => `portrait-${index}`,
  });
  assert.ok(portrait);
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...ROOF, surfacePlanning: portrait.config },
    panels: portrait.panels,
  }), false);

  const landscape = buildDirectStandardRoofLayout({
    roof: { ...ROOF, surfacePlanning: portrait.config },
    panel: PANEL,
    modules: portrait.modules,
    orientation: "landscape",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    createPanelId: (index) => `landscape-${index}`,
  });
  assert.ok(landscape);
  assert.ok(landscape.panels.every((panel) => panel.orientation === "landscape"));
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...ROOF, surfacePlanning: JSON.parse(JSON.stringify(landscape.config)) },
    panels: landscape.panels,
  }), false);

  const portraitAgain = buildDirectStandardRoofLayout({
    roof: { ...ROOF, surfacePlanning: landscape.config },
    panel: PANEL,
    modules: landscape.modules,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    createPanelId: (index) => `portrait-again-${index}`,
  });
  assert.ok(portraitAgain);
  assert.ok(portraitAgain.panels.every((panel) => panel.orientation === "portrait"));
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...ROOF, surfacePlanning: portraitAgain.config },
    panels: portraitAgain.panels,
  }), false);
});

test("pristine flat Vollbelegung alternates Süd and Ost-West with complete fresh systems", () => {
  const flatRoof = { ...ROOF, roofKind: "flat" as const, tiltDeg: 0 };
  const southConfig = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    orientation: "south",
  });
  const south = buildDirectAdvancedRoofLayout({
    roof: flatRoof,
    config: southConfig,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    layoutRunId: "south-1",
    createPanelId: (index) => `south-1-${index}`,
  });
  assert.ok(south);
  assert.ok(south.panels.length > 0);
  assert.ok(south.panels.every((panel) => panel.advanced?.systemId === K2_S_DOME_SYSTEM_ID));
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: south.config },
    panels: south.panels,
  }), false);
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "south",
    requestedMode: "east-west",
    committedPanelCount: south.panels.length,
    pristineGeneratedLayout: true,
    regeneratePristineLayout: true,
  }), "regenerate");

  const eastWest = buildDirectAdvancedRoofLayout({
    roof: { ...flatRoof, surfacePlanning: south.config },
    config: setAdvancedMountingOrientation({ config: south.config, orientation: "east-west" }),
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    layoutRunId: "east-west-1",
    createPanelId: (index) => `east-west-1-${index}`,
  });
  assert.ok(eastWest);
  assert.ok(eastWest.panels.every((panel) => panel.advanced?.systemId === K2_D_DOME_SYSTEM_ID));
  const eastWestBlocks = new Map<string, PanelInstance[]>();
  for (const item of eastWest.panels) {
    const blockKey = item.advanced?.blockKey;
    assert.ok(blockKey);
    eastWestBlocks.set(blockKey, [...(eastWestBlocks.get(blockKey) ?? []), item]);
  }
  assert.ok(eastWestBlocks.size > 0);
  for (const blockPanels of eastWestBlocks.values()) {
    assert.equal(blockPanels.length, 2);
    assert.deepEqual(blockPanels.map((panel) => panel.advanced?.slotIndex).sort(), [0, 1]);
  }
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: JSON.parse(JSON.stringify(eastWest.config)) },
    panels: eastWest.panels,
  }), false);

  const southAgain = buildDirectAdvancedRoofLayout({
    roof: { ...flatRoof, surfacePlanning: eastWest.config },
    config: setAdvancedMountingOrientation({ config: eastWest.config, orientation: "south" }),
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    layoutRunId: "south-2",
    createPanelId: (index) => `south-2-${index}`,
  });
  assert.ok(southAgain);
  assert.ok(southAgain.panels.every((panel) =>
    panel.advanced?.systemId === K2_S_DOME_SYSTEM_ID && panel.advanced.slotIndex === 0));
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: southAgain.config },
    panels: southAgain.panels,
  }), false);

  const eastWestAgain = buildDirectAdvancedRoofLayout({
    roof: { ...flatRoof, surfacePlanning: southAgain.config },
    config: setAdvancedMountingOrientation({ config: southAgain.config, orientation: "east-west" }),
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    maximizeCoverage: true,
    layoutRunId: "east-west-2",
    createPanelId: (index) => `east-west-2-${index}`,
  });
  assert.ok(eastWestAgain);
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: eastWestAgain.config },
    panels: eastWestAgain.panels,
  }), false);

  const deletedBlockKey = eastWestAgain.panels[0]?.advanced?.blockKey;
  const manuallyDeletedBlock = eastWestAgain.panels.filter(
    (panel) => panel.advanced?.blockKey !== deletedBlockKey,
  );
  assert.equal(hasManualRoofLayoutChanges({
    roof: { ...flatRoof, surfacePlanning: eastWestAgain.config },
    panels: manuallyDeletedBlock,
  }), true);
  assert.equal(resolveModuleModeChangeIntent({
    currentMode: "east-west",
    requestedMode: "south",
    committedPanelCount: manuallyDeletedBlock.length,
    pristineGeneratedLayout: false,
    regeneratePristineLayout: true,
  }), "confirm");
});

test("a legacy Standard layout without a generated fingerprint stays protected", () => {
  const legacyPanel: PanelInstance = {
    id: "legacy-panel",
    roofId: ROOF.id,
    cx: 30,
    cy: 30,
    wPx: 11.34,
    hPx: 17.22,
    angleDeg: 0,
    orientation: "portrait",
    panelId: PANEL.id,
  };
  assert.equal(hasManualRoofLayoutChanges({ roof: ROOF, panels: [legacyPanel] }), true);
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
  assert.equal(modulesPanel.includes("<LayoutRegenerationDialog"), false);
  assert.ok(modulesPanel.includes("previewEnabled: false"));
  assert.match(modulesPanel, /selectedDraft\.previewEnabled !== false\s*:\s*false/);
  assert.equal(modulesPanel.includes("generateStandardMode"), false);
  assert.equal(modulesPanel.includes("generateAdvancedMode"), false);
  assert.equal(modulesPanel.includes("Vorschau als Module platzieren"), false);
  assert.equal(modulesPanel.includes(">Belegung<"), false);
  assert.equal(modulesPanel.includes("Parallel zum First"), false);
  assert.equal(advancedPanel.includes("Parallel zur Dachkante"), false);
  assert.ok(advancedPanel.includes("Wähle Süd oder Ost-West"));
  assert.ok(advancedPanel.includes("activeMode && previewEnabled"));
  assert.ok(toolbar.includes('actionId="planner-fill-layout"'));
  assert.ok(toolbar.includes('actionId="planner-regenerate-layout"'));
  assert.ok(toolbar.includes("Zuerst Hochformat oder Querformat wählen"));
  assert.ok(toolbar.includes("Zuerst Süd oder Ost-West wählen"));
});

test("flat roof list and dimensions reuse the canonical geometric-orientation resolver", () => {
  const modulesPanel = readFileSync(new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url), "utf8");
  const dimensions = readFileSync(new URL("../../src/components_v2/panels/RoofDimensionsControl.tsx", import.meta.url), "utf8");
  const compass = readFileSync(new URL("../../src/components_v2/compassHUD.tsx", import.meta.url), "utf8");
  assert.ok(modulesPanel.includes("resolveRoofGeometricOrientationDeg(l.points"));
  assert.ok(dimensions.includes("resolveRoofGeometricOrientationDeg(roof.points"));
  assert.ok(modulesPanel.includes('rowKind === "flat"'));
  assert.ok(modulesPanel.includes('title="Geometrische Dachausrichtung"'));
  assert.ok(compass.includes('resolveInitialSonnendachRoofType(roof) === "flat"'));
  assert.ok(compass.includes("isFlat\n    ? primaryModuleAzimuthDeg"));
});

test("configuration-only drafts resolve the active mode without materialized panels", () => {
  const standardDraft = {
    targetMode: "standard" as const,
    previewEnabled: false,
    panelSpecId: PANEL.id,
    modules: { ...MODULES, orientation: "landscape" as const },
    moduleTilt: { mode: "inherit-roof" as const },
  };
  assert.equal(resolveRoofModuleMode({
    roof: ROOF,
    roofId: ROOF.id,
    panels: [],
    draft: standardDraft,
  }), "landscape");
  const advancedDraft = {
    targetMode: "advanced" as const,
    previewEnabled: false,
    config: setAdvancedMountingOrientation({
      config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
      orientation: "east-west" as const,
    }),
  };
  assert.equal(resolveRoofModuleMode({
    roof: { ...ROOF, roofKind: "flat" },
    roofId: ROOF.id,
    panels: [],
    draft: advancedDraft,
  }), "east-west");
  assert.equal(resolveRoofModuleMode({
    roof: ROOF,
    roofId: ROOF.id,
    panels: [],
    draft: advancedDraft,
  }), undefined);
});

test("reference-edge hierarchy and generation triggers keep their intended alignment semantics", () => {
  const annotations = readFileSync(new URL("../../src/components_v2/canvas/RoofAnnotationsLayer.tsx", import.meta.url), "utf8");
  const referenceLayer = readFileSync(new URL("../../src/components_v2/canvas/RoofReferenceEdgeLayer.tsx", import.meta.url), "utf8");
  const annotationModel = readFileSync(new URL("../../src/components_v2/canvas/roofAnnotationModel.ts", import.meta.url), "utf8");
  const toolbar = readFileSync(new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url), "utf8");
  const fill = readFileSync(new URL("../../src/components_v2/modules/fill/FillAreaController.tsx", import.meta.url), "utf8");

  assert.ok(annotations.includes("<RoofReferenceEdgeLayer"));
  assert.ok(annotations.includes('subdued={step === "modules"}'));
  assert.ok(annotationModel.includes('? "FIRST"'));
  assert.ok(annotationModel.includes('? "REFERENZKANTE"'));
  assert.ok(annotationModel.includes("resolveCanonicalRoofReferenceEdge"));
  assert.ok(referenceLayer.includes("plannerTheme.referenceEdge"));
  assert.ok(referenceLayer.includes("resolveCanonicalRoofReferenceEdge"));
  assert.ok(referenceLayer.includes("listening={false}"));
  assert.equal(referenceLayer.includes("<Rect"), false);
  assert.equal(referenceLayer.includes("<Text"), false);
  assert.ok(toolbar.includes("alignAdvancedLayoutParallelToRoofEdge"));
  assert.match(fill, /alignmentMode:\s*["']current["']/);
});
