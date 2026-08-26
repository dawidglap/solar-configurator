import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import {
  alignAdvancedLayoutParallelToRoofEdge,
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  materializeAdvancedPanels,
  replaceAdvancedDraftModule,
  setAdvancedFixedQuantity,
  setAdvancedMountingOrientation,
  setAdvancedQuantityMode,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type {
  AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import type { ModulesConfig, PanelSpec, RoofArea } from "../../src/types/planner";

const MODULE: PanelSpec = {
  id: "module-440",
  brand: "Test",
  model: "M440",
  wp: 440,
  widthM: 1.134,
  heightM: 1.722,
  priceChf: 0,
};
const MODULE_2: PanelSpec = {
  ...MODULE,
  id: "module-430",
  model: "M430",
  widthM: 1.1,
  wp: 430,
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

function rectangleRoof(input: {
  widthM?: number;
  heightM?: number;
  rotationDeg?: number;
  id?: string;
} = {}): RoofArea {
  const widthM = input.widthM ?? 30;
  const heightM = input.heightM ?? 20;
  const rotation = ((input.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const mppImage = 0.1;
  const halfWidthPx = widthM / mppImage / 2;
  const halfHeightPx = heightM / mppImage / 2;
  const center = { x: 400, y: 300 };
  const points = [
    { x: -halfWidthPx, y: -halfHeightPx },
    { x: halfWidthPx, y: -halfHeightPx },
    { x: halfWidthPx, y: halfHeightPx },
    { x: -halfWidthPx, y: halfHeightPx },
  ].map((point) => ({
    x: center.x + point.x * cos - point.y * sin,
    y: center.y + point.x * sin + point.y * cos,
  }));
  return { id: input.id ?? "roof-a", name: "Roof", points };
}

function initialConfig(): AdvancedSurfacePlanningV1 {
  return createInitialAdvancedPlanning({
    panel: MODULE,
    standardModules: STANDARD_MODULES,
  });
}

function fixedConfig(
  system: "d-dome" | "s-dome" = "d-dome",
): AdvancedSurfacePlanningV1 {
  const oriented = system === "s-dome"
    ? setAdvancedMountingOrientation({ config: initialConfig(), orientation: "south" })
    : initialConfig();
  return setAdvancedFixedQuantity({
    config: setAdvancedQuantityMode({ config: oriented, mode: "fixed" }),
    blocksPerRow: 5,
    rowCount: 3,
  });
}

function preview(
  config: AdvancedSurfacePlanningV1,
  roof = rectangleRoof(),
  zones: Array<{ roofId: string; id?: string; points: Array<{ x: number; y: number }> }> = [],
) {
  return computeAdvancedPlanningPreview({
    roof,
    config,
    mppImage: 0.1,
    zones,
    snowGuards: [],
  });
}

test("fixed D-Dome 5 x 3 produces exact topology, 15 blocks and 30 modules", () => {
  const config = fixedConfig("d-dome");
  assert.equal(config.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.quantity.mode, "fixed");
  assert.equal(result.quantity.requestedBlockCount, 15);
  assert.equal(result.quantity.requestedModuleCount, 30);
  assert.equal(result.blockCount, 15);
  assert.equal(result.moduleCount, 30);
  assert.deepEqual(
    result.blocks.map((block) => block.blockKey),
    Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 5 }, (_, column) => `r${row}:c${column}`),
    ).flat(),
  );
});

test("fixed S-Dome 5 x 3 produces 15 blocks and 15 modules", () => {
  const config = fixedConfig("s-dome");
  assert.equal(config.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.quantity.requestedBlockCount, 15);
  assert.equal(result.quantity.requestedModuleCount, 15);
  assert.equal(result.blockCount, 15);
  assert.equal(result.moduleCount, 15);
});

test("a reserved collision keeps the requested 5 x 3 matrix and reports 14 of 15", () => {
  const config = fixedConfig("d-dome");
  const roof = rectangleRoof();
  const baseline = preview(config, roof);
  assert.equal(baseline.valid, true);
  if (!baseline.valid) return;
  const target = baseline.blocks[7].centerPx;
  const result = preview(config, roof, [{
    roofId: roof.id,
    id: "reserved-one",
    points: [
      { x: target.x - 1, y: target.y - 1 },
      { x: target.x + 1, y: target.y - 1 },
      { x: target.x + 1, y: target.y + 1 },
      { x: target.x - 1, y: target.y + 1 },
    ],
  }]);
  assert.equal(result.valid, false);
  assert.equal(result.quantity?.mode, "fixed");
  assert.equal(result.quantity?.requestedBlockCount, 15);
  assert.equal(result.quantity?.validBlockCount, 14);
  assert.equal(result.blocks.length, 15);
  assert.equal(result.blocks.filter((block) => !block.valid).length, 1);
  assert.ok(result.errors.some((error) => error.code === "fixed-layout-incomplete"));
  assert.deepEqual(materializeAdvancedPanels({
    roofId: roof.id,
    config,
    preview: result,
    layoutRunId: "must-not-materialize",
    createPanelId: (index) => `invalid-${index}`,
  }), []);
});

test("fixed Apply materializes exactly 15 stable D-Dome pairs", () => {
  const config = fixedConfig("d-dome");
  const result = preview(config);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const panels = materializeAdvancedPanels({
    roofId: "roof-a",
    config,
    preview: result,
    layoutRunId: "fixed-run",
    createPanelId: (index) => `panel-${index}`,
  });
  assert.equal(panels.length, 30);
  const blockKeys = new Set(panels.map((panel) => panel.advanced?.blockKey));
  assert.equal(blockKeys.size, 15);
  for (const blockKey of blockKeys) {
    const pair = panels.filter((panel) => panel.advanced?.blockKey === blockKey);
    assert.deepEqual(pair.map((panel) => panel.advanced?.slotIndex), [0, 1]);
  }
});

test("quantity inputs roundtrip while derived totals remain absent", () => {
  const config = fixedConfig("d-dome");
  const serialized = JSON.parse(JSON.stringify(config));
  const resolution = resolveSurfacePlanning(serialized);
  assert.equal(resolution.status, "supported-advanced");
  if (resolution.status !== "supported-advanced") return;
  assert.equal(resolution.config.advanced.layout.quantityMode, "fixed");
  assert.equal(resolution.config.advanced.layout.blocksPerRow, 5);
  assert.equal(resolution.config.advanced.layout.rowCount, 3);
  assert.equal("totalBlockCount" in resolution.config.advanced.layout, false);
  assert.equal("totalModuleCount" in resolution.config.advanced.layout, false);
});

test("applied fixed D-Dome save/reload preserves 5 x 3 inputs and 30 panels without regeneration", async () => {
  const { usePlannerV2Store } = await import(
    "../../src/components_v2/state/plannerV2Store"
  );
  const config = fixedConfig("d-dome");
  const computed = preview(config);
  assert.equal(computed.valid, true);
  if (!computed.valid) return;
  const panels = materializeAdvancedPanels({
    roofId: "roof-a",
    config,
    preview: computed,
    layoutRunId: "saved-fixed",
    createPanelId: (index) => `saved-fixed-${index}`,
  });
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [rectangleRoof()], panels: [] });
  usePlannerV2Store.getState().commitRoofLayout({
    roofId: "roof-a",
    panels,
    surfacePlanning: config,
  });
  const saved = JSON.parse(JSON.stringify(usePlannerV2Store.getState().exportState()));
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().importState(saved);
  const loaded = usePlannerV2Store.getState();
  const resolution = loaded.getSurfacePlanning("roof-a");
  assert.equal(resolution.status, "supported-advanced");
  if (resolution.status === "supported-advanced") {
    assert.equal(resolution.config.advanced.layout.quantityMode, "fixed");
    assert.equal(resolution.config.advanced.layout.blocksPerRow, 5);
    assert.equal(resolution.config.advanced.layout.rowCount, 3);
  }
  assert.equal(loaded.panels.length, 30);
  assert.equal(new Set(loaded.panels.map((panel) => panel.advanced?.blockKey)).size, 15);
  usePlannerV2Store.getState().resetPlanner();
});

test("absent and explicit auto quantity modes preserve identical auto-fill geometry", () => {
  const implicit = initialConfig();
  const explicit: AdvancedSurfacePlanningV1 = {
    ...implicit,
    advanced: {
      ...implicit.advanced,
      layout: { ...implicit.advanced.layout, quantityMode: "auto" },
    },
  };
  const a = preview(implicit);
  const b = preview(explicit);
  assert.equal(a.valid, true);
  assert.equal(b.valid, true);
  if (!a.valid || !b.valid) return;
  assert.deepEqual(a.blocks, b.blocks);
  assert.deepEqual(a.modules, b.modules);
});

test("customer 10 degree label remains nominal while K2 D-Dome geometry stays effective", () => {
  const result = preview(initialConfig());
  assert.equal(result.valid, true);
  if (!result.valid || result.derived.kind !== "k2") return;
  assert.equal(result.derived.nominalTiltDeg, 10);
  assert.ok(Math.abs(result.derived.effectiveTiltDeg - 8.6477) < 0.001);
});

test("Parallel zur Dachkante aligns a rotated 37 degree rectangle and preserves opposing faces", () => {
  const roof = rectangleRoof({ rotationDeg: 37, widthM: 40, heightM: 30 });
  const aligned = alignAdvancedLayoutParallelToRoofEdge({
    config: fixedConfig("d-dome"),
    roof,
    mppImage: 0.1,
  });
  assert.equal(aligned.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  if (aligned.advanced.system.systemId !== K2_D_DOME_SYSTEM_ID) return;
  assert.ok(Math.abs(aligned.advanced.system.primaryFaceAzimuthDeg - 37) < 1e-8);
  const result = preview(aligned, roof);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.ok(result.blocks.every((block) => Math.abs(block.rotationCanvasDeg - 37) < 1e-8));
  const firstPair = result.modules.filter((module) => module.blockKey === "r0:c0");
  assert.equal(firstPair.length, 2);
  const difference = normalizeDifference(firstPair[1].faceAzimuthDeg - firstPair[0].faceAzimuthDeg);
  assert.equal(difference, 180);
});

function normalizeDifference(value: number) {
  return ((value % 360) + 360) % 360;
}

test("draft fixed quantity and Cancel leave the committed automatic config untouched", () => {
  const committed = initialConfig();
  const draft = fixedConfig("d-dome");
  assert.equal(committed.advanced.layout.quantityMode, undefined);
  assert.equal(draft.advanced.layout.quantityMode, "fixed");
  assert.deepEqual(initialConfig(), committed);
});

test("module, row-space and roof-size changes recompute fixed geometry without changing 5 x 3", () => {
  const original = fixedConfig("d-dome");
  assert.equal(original.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  if (original.advanced.system.systemId !== K2_D_DOME_SYSTEM_ID) return;
  const changedModule = replaceAdvancedDraftModule({ config: original, panel: MODULE_2 });
  const changedRowSpace: AdvancedSurfacePlanningV1 = {
    ...original,
    advanced: {
      ...original.advanced,
      system: {
        ...original.advanced.system,
        rowSpaceM: original.advanced.system.rowSpaceM + 0.05,
      },
    },
  };
  for (const current of [changedModule, changedRowSpace]) {
    assert.equal(current.advanced.layout.blocksPerRow, 5);
    assert.equal(current.advanced.layout.rowCount, 3);
    const result = preview(current);
    assert.equal(result.quantity?.requestedBlockCount, 15);
  }
  const resizedTooSmall = preview(original, rectangleRoof({ widthM: 6, heightM: 6 }));
  assert.equal(resizedTooSmall.valid, false);
  assert.equal(resizedTooSmall.quantity?.requestedBlockCount, 15);
  assert.ok((resizedTooSmall.quantity?.validBlockCount ?? 15) < 15);
});

test("mixed pitched, fixed D-Dome and automatic S-Dome roofs retain isolated contracts", () => {
  const mixed = JSON.parse(JSON.stringify([
    rectangleRoof({ id: "roof-pitched" }),
    { ...rectangleRoof({ id: "roof-fixed" }), surfacePlanning: fixedConfig("d-dome") },
    { ...rectangleRoof({ id: "roof-auto" }), surfacePlanning: setAdvancedMountingOrientation({ config: initialConfig(), orientation: "south" }) },
  ])) as RoofArea[];
  assert.equal(resolveSurfacePlanning(mixed[0].surfacePlanning).status, "legacy-standard");
  const fixed = resolveSurfacePlanning(mixed[1].surfacePlanning);
  const automatic = resolveSurfacePlanning(mixed[2].surfacePlanning);
  assert.equal(fixed.status, "supported-advanced");
  assert.equal(automatic.status, "supported-advanced");
  if (fixed.status === "supported-advanced" && automatic.status === "supported-advanced") {
    assert.equal(fixed.config.advanced.layout.quantityMode, "fixed");
    assert.equal(fixed.config.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
    assert.equal(automatic.config.advanced.layout.quantityMode, undefined);
    assert.equal(automatic.config.advanced.system.systemId, K2_S_DOME_SYSTEM_ID);
  }
});

test("customer-facing source is roof-type driven and does not expose GreenRoof creation", () => {
  const modulesPanel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const flatPanel = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(modulesPanel.includes("Planungsmodus"), false);
  assert.equal(modulesPanel.includes(">Standard<"), false);
  assert.equal(modulesPanel.includes(">Advanced<"), false);
  assert.ok(modulesPanel.includes("Dachtyp"));
  assert.ok(modulesPanel.includes("Flachdach"));
  assert.ok(modulesPanel.includes("Schrägdach"));
  assert.equal(flatPanel.includes("Gründach"), false);
  assert.equal(flatPanel.includes("Primäre Ausrichtung"), false);
  assert.ok(flatPanel.includes("Wartungsgang"));
});
