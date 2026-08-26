import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLegacyStandardPanelCommit,
  MODULES_PANEL_LEGACY_POLICY,
  TOOL_HOTKEYS_LEGACY_POLICY,
  TOP_TOOLBAR_LEGACY_POLICY,
} from "../../src/components_v2/modules/legacyStandardApplicationPolicy";

type TestPanel = { id: string; roofId: string };

const existingPanels: TestPanel[] = [
  { id: "roof-a-old", roofId: "roof-a" },
  { id: "roof-b-existing", roofId: "roof-b" },
];
const generatedPanels: TestPanel[] = [
  { id: "roof-a-new-1", roofId: "roof-a" },
  { id: "roof-a-new-2", roofId: "roof-a" },
];

test("TopToolbar application policy replaces a non-empty roof layout", () => {
  const result = applyLegacyStandardPanelCommit({
    existingPanels,
    generatedPanels,
    roofId: "roof-a",
    policy: TOP_TOOLBAR_LEGACY_POLICY,
  });

  assert.deepEqual(result, [existingPanels[1], ...generatedPanels]);
});

test("TopToolbar application policy preserves existing panels for an empty layout", () => {
  const result = applyLegacyStandardPanelCommit({
    existingPanels,
    generatedPanels: [],
    roofId: "roof-a",
    policy: TOP_TOOLBAR_LEGACY_POLICY,
  });

  assert.deepEqual(result, existingPanels);
});

test("ModulesPanel application policy replaces non-empty and clears empty roof layouts", () => {
  const replaced = applyLegacyStandardPanelCommit({
    existingPanels,
    generatedPanels,
    roofId: "roof-a",
    policy: MODULES_PANEL_LEGACY_POLICY,
  });
  const cleared = applyLegacyStandardPanelCommit({
    existingPanels,
    generatedPanels: [],
    roofId: "roof-a",
    policy: MODULES_PANEL_LEGACY_POLICY,
  });

  assert.deepEqual(replaced, [existingPanels[1], ...generatedPanels]);
  assert.deepEqual(cleared, [existingPanels[1]]);
});

test("ToolHotkeys application policy appends and preserves legacy duplicate potential", () => {
  const result = applyLegacyStandardPanelCommit({
    existingPanels,
    generatedPanels,
    roofId: "roof-a",
    policy: TOOL_HOTKEYS_LEGACY_POLICY,
  });

  assert.deepEqual(result, [...existingPanels, ...generatedPanels]);
});

test("runtime policies keep their legacy filtering differences explicit", () => {
  assert.deepEqual(TOP_TOOLBAR_LEGACY_POLICY.filterPolicy, {
    reservedZones: true,
    snowGuards: true,
  });
  assert.deepEqual(MODULES_PANEL_LEGACY_POLICY.filterPolicy, {
    reservedZones: true,
    snowGuards: false,
  });
  assert.deepEqual(TOOL_HOTKEYS_LEGACY_POLICY.filterPolicy, {
    reservedZones: true,
    snowGuards: false,
  });
});
