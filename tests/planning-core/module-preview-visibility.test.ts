import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("module preview visibility is offered in both Standard and flat-roof Layout sections", () => {
  const standardPanel = readSource("../../src/components_v2/panels/ModulesPanel.tsx");
  const advancedPanel = readSource(
    "../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx",
  );
  const toggle = readSource(
    "../../src/components_v2/modules/ModulePreviewVisibilityToggle.tsx",
  );

  assert.ok(standardPanel.includes("<ModulePreviewVisibilityToggle />"));
  assert.ok(advancedPanel.includes("<h3 className={labelClass}>Layout</h3>"));
  assert.ok(advancedPanel.includes("<ModulePreviewVisibilityToggle />"));
  assert.ok(toggle.includes('aria-pressed={visible}'));
  assert.ok(toggle.includes('"Vorschau ausblenden"'));
  assert.ok(toggle.includes('"Vorschau anzeigen"'));
});

test("the common canvas boundary hides only proposal layers", () => {
  const canvas = readSource("../../src/components_v2/canvas/CanvasStage.tsx");

  assert.ok(canvas.includes("showModulePreview &&\n    step === \"modules\""));
  assert.ok(canvas.includes(
    '{showModulePreview && step === "modules" && !manualPlacementSession && (',
  ));
  assert.ok(canvas.includes("<PanelsLayer"), "committed panels remain a separate layer");
  assert.ok(canvas.includes('tool === "fill-area" && fillDraft'), "fill-area ghost remains independent");
});

test("hidden proposals fall back to committed thermal fields and never persist the view preference", () => {
  const canvas = readSource("../../src/components_v2/canvas/CanvasStage.tsx");
  const store = readSource("../../src/components_v2/state/plannerV2Store.ts");

  assert.ok(canvas.includes(
    ": thermalFieldSources.committed;",
  ));
  assert.ok(store.includes("showModulePreview: true"));

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
