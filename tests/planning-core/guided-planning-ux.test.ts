import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("guided sidebar exposes primary choices without a dynamic bottom status area", () => {
  const modulesPanel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const advancedPanel = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(modulesPanel.includes("Dachfläche auswählen"));
  assert.ok(modulesPanel.includes("Klicke auf eine Dachfläche, um Module zu planen."));
  assert.ok(modulesPanel.includes('step === "modules" && selectedRoof && displayMode === "standard"'));
  assert.ok(modulesPanel.includes("Schrägdach"));
  assert.ok(modulesPanel.includes("Flachdach"));
  assert.ok(modulesPanel.includes("Feinjustierung"));

  assert.ok(advancedPanel.includes("MountingChoiceGraphic"));
  assert.equal(advancedPanel.includes("Modul ändern"), false);
  assert.equal(advancedPanel.includes("Modul auswählen"), false);
  assert.equal(advancedPanel.includes("modulePickerOpen"), false);
  assert.match(advancedPanel, /aria-label="Modul wählen"/);
  assert.match(advancedPanel, /replaceAdvancedDraftModule\(\{ config, panel \}\)/);
  assert.match(advancedPanel, /className=\{`\$\{inputClass\} min-w-0 truncate`\}/);
  assert.equal(advancedPanel.includes("Parallel zur Dachkante"), false);
  assert.ok(advancedPanel.includes("Wähle Süd oder Ost-West"));
  assert.equal(advancedPanel.includes("Planung passt"), false);
  assert.equal(advancedPanel.includes("Planung noch nicht möglich"), false);
  assert.equal(advancedPanel.includes("Passe Anzahl, Ausrichtung oder Abstände an."), false);
  assert.equal(advancedPanel.includes("Module werden erst mit U, F oder Einzelplatzierung erzeugt."), false);
  assert.equal(modulesPanel.includes("Module werden erst mit U, F oder Einzelplatzierung erzeugt."), false);
  assert.ok(advancedPanel.includes("Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft."));
  assert.equal(advancedPanel.includes("Layout anwenden"), false);
  assert.equal(advancedPanel.includes("fineTuningOpen"), false);
  assert.equal(advancedPanel.includes(">Manuell</button>"), false);
  assert.equal(advancedPanel.includes("aria-expanded"), false);
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
  assert.ok(advancedPanel.includes("<DirectLayoutControl"));
  assert.equal(advancedPanel.includes("manualOrientationInputRef"), false);
  assert.equal(advancedPanel.includes('Horizontal ausrichten'), false);
  assert.equal(advancedPanel.includes('Vertikal ausrichten'), false);
});
