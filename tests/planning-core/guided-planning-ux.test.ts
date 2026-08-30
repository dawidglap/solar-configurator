import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildGuidedPlanningResult } from "../../src/components_v2/modules/advanced/guidedPlanningPresentation";

test("guided result card presents a valid fixed D-Dome 5 x 3 without recalculating geometry", () => {
  const result = buildGuidedPlanningResult({
    valid: true,
    quantityMode: "fixed",
    requestedBlockCount: 15,
    validBlockCount: 15,
    requestedModuleCount: 30,
    validModuleCount: 30,
    blocksPerRow: 5,
    rowCount: 3,
    powerW: 440,
    montageFieldCount: 1,
  });

  assert.deepEqual(result, {
    status: "valid",
    title: "Planung passt",
    blockCount: 15,
    moduleCount: 30,
    powerKWp: 13.2,
    arrangementLabel: "5 × 3",
    validityLabel: null,
    guidance: null,
    montageFieldCount: 1,
  });
});

test("guided result card turns an incomplete fixed matrix into one clear error", () => {
  const result = buildGuidedPlanningResult({
    valid: false,
    quantityMode: "fixed",
    requestedBlockCount: 15,
    validBlockCount: 14,
    requestedModuleCount: 30,
    validModuleCount: 28,
    blocksPerRow: 5,
    rowCount: 3,
    powerW: 440,
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.title, "Anordnung passt nicht vollständig");
  assert.equal(result.validityLabel, "14 von 15 Blocks gültig");
  assert.equal(result.guidance, "Passe Anzahl, Ausrichtung oder Abstände an.");
  assert.equal(result.powerKWp, null);
});

test("guided sidebar exposes primary choices and keeps fine tuning collapsed by default", () => {
  const modulesPanel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const advancedPanel = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../../src/components_v2/modules/advanced/guidedPlanningPresentation.ts", import.meta.url),
    "utf8",
  );

  assert.ok(modulesPanel.includes("Dachfläche auswählen"));
  assert.ok(modulesPanel.includes("Klicke auf eine Dachfläche, um Module zu planen."));
  assert.ok(modulesPanel.includes('step === "modules" && selectedRoof && displayMode === "standard"'));
  assert.ok(modulesPanel.includes("Schrägdach"));
  assert.ok(modulesPanel.includes("Flachdach"));
  assert.ok(modulesPanel.includes("Feinjustierung"));

  assert.ok(advancedPanel.includes("MountingChoiceGraphic"));
  assert.ok(advancedPanel.includes("Modul ändern"));
  assert.ok(advancedPanel.includes("Parallel zur Dachkante"));
  assert.ok(presentation.includes("Planung passt"));
  assert.ok(presentation.includes("Anordnung passt nicht vollständig"));
  assert.ok(advancedPanel.includes("Nicht angewendete Änderungen"));
  assert.ok(advancedPanel.includes("React.useState(false)"));
  assert.equal(advancedPanel.includes("Primäre Ausrichtung"), false);
});

test("customizable default-system controls remain contextual to the flat-roof panel", () => {
  const modulesPanel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const advancedPanel = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(modulesPanel.includes('step === "modules"'));
  assert.ok(modulesPanel.includes('customerRoofType === "flat"'));
  assert.ok(modulesPanel.includes('step === "building"'));
  assert.ok(advancedPanel.includes("Standardsystem"));
  assert.ok(advancedPanel.includes("Wartungsgang"));
  assert.ok(advancedPanel.includes("Modulneigung"));
  assert.ok(advancedPanel.includes("DEFAULT_FLAT_SYSTEM_TILT_RANGE_DEG"));
  assert.equal(advancedPanel.includes("mm · K2"), false);
});
