import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("normal module planning no longer exposes the full-roof preview visibility control", () => {
  const standardPanel = readSource("../../src/components_v2/panels/ModulesPanel.tsx");
  const advancedPanel = readSource(
    "../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx",
  );

  assert.equal(standardPanel.includes("<ModulePreviewVisibilityToggle"), false);
  assert.equal(advancedPanel.includes("<ModulePreviewVisibilityToggle"), false);
  assert.equal(advancedPanel.includes("Vorschau ausblenden"), false);
  assert.equal(advancedPanel.includes("Vorschau anzeigen"), false);
});

test("canvas auto-layout proposals exist only for explicit roof drafts", () => {
  const canvas = readSource("../../src/components_v2/canvas/CanvasStage.tsx");

  assert.ok(canvas.includes('selectedPlanningDraft?.targetMode === "standard"'));
  assert.ok(canvas.includes('selectedPlanningDraft?.targetMode === "advanced"'));
  assert.ok(canvas.includes("<PanelsLayer"), "committed working panels remain independent");
  assert.ok(canvas.includes('tool === "fill-area" && fillDraft'), "transient interaction ghost remains");
  assert.equal(canvas.includes("showModulePreview &&"), false);
});

test("the obsolete visibility preference remains non-persisted compatibility state", () => {
  const store = readSource("../../src/components_v2/state/plannerV2Store.ts");

  const partialize = store.slice(
    store.indexOf("partialize: (s) => ({"),
    store.indexOf("migrate:", store.indexOf("partialize: (s) => ({")),
  );
  assert.equal(partialize.includes("showModulePreview"), false);

  const exportState = store.slice(
    store.indexOf("exportState: () => {"),
    store.indexOf("importState: (saved", store.indexOf("exportState: () => {")),
  );
  assert.equal(exportState.includes("showModulePreview"), false);
});
