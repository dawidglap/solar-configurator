import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(
  new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("../../src/components_v2/modules/advanced/CompanySpacingDefaultsDialog.tsx", import.meta.url),
  "utf8",
);

test("Abstände exposes one company-default header action and no per-field badge", () => {
  assert.match(panel, />\s*Firmenstandard\s*</);
  assert.doesNotMatch(panel, /Modulabstand[\s\S]{0,160}ml-1 text-\[9px\] text-primary/);
  assert.doesNotMatch(panel, /Werte direkt anpassen/);
  assert.match(panel, /· Abweichend/);
});

test("company spacing dialog edits all four values and saves through tenant endpoint", () => {
  for (const label of ["Reihenabstand", "Wartungsgang", "Modulabstand", "Modulneigung"]) {
    assert.match(dialog, new RegExp(label));
  }
  assert.match(dialog, /\/api\/company-profile\/planner-defaults/);
  assert.match(dialog, /Standard speichern/);
  assert.match(dialog, /Aktuelle Dachfläche auf Firmenstandard zurücksetzen/);
  assert.doesNotMatch(dialog, /window\.alert|window\.confirm/);
});
