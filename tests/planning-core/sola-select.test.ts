import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSolaSelectMenuPosition } from "../../src/components_v2/ui/SolaSelect";

test("SolaSelect opens below when the viewport has enough room", () => {
  assert.deepEqual(
    resolveSolaSelectMenuPosition(
      { top: 100, bottom: 132, left: 20, width: 240 },
      1024,
      768,
    ),
    { top: 138, left: 20, width: 240, maxHeight: 260 },
  );
});

test("SolaSelect opens above and clamps its horizontal position near viewport edges", () => {
  assert.deepEqual(
    resolveSolaSelectMenuPosition(
      { top: 700, bottom: 732, left: 900, width: 240 },
      1024,
      768,
    ),
    { bottom: 74, left: 776, width: 240, maxHeight: 260 },
  );
});

test("the two planning selectors keep their existing ID-based callbacks", () => {
  const modulesPanel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const advancedPanel = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const dimensions = readFileSync(
    new URL("../../src/components_v2/panels/RoofDimensionsControl.tsx", import.meta.url),
    "utf8",
  );

  assert.match(modulesPanel, /onValueChange=\{setSelectedPanel\}/);
  assert.match(modulesPanel, /panelSpecId: nextPanelId/);
  assert.match(advancedPanel, /item\.id === nextModuleId/);
  assert.match(dimensions, /changeReferenceEdge\(Number\(nextValue\)\)/);
});
