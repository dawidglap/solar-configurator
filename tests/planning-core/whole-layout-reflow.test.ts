import assert from "node:assert/strict";
import test from "node:test";

import {
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import { BUILT_IN_COMPANY_PLANNER_DEFAULTS } from "../../src/lib/planning/companyPlannerDefaults";
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  createInitialAdvancedPlanning,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import {
  buildWholeLayoutReflow,
  resolveAdvancedWorkingOrientationDeg,
  rotateAdvancedWorkingOrientation,
} from "../../src/components_v2/modules/panels/wholeLayoutReflow";
import type { ModulesConfig, PanelInstance, PanelSpec, RoofArea } from "../../src/types/planner";

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
  gridAngleDeg: 0,
  orientation: "portrait",
  spacingM: 0.019,
  spacingXM: 0.019,
  spacingYM: 0.019,
  marginM: 0.3,
  showGrid: false,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "start",
  gridAnchorY: "start",
  coverageRatio: 1,
};

const PITCHED: RoofArea = {
  id: "roof-pitched",
  name: "D1",
  roofKind: "pitched",
  referenceEdgeIndex: 0,
  tiltDeg: 25,
  points: [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 220 }, { x: 0, y: 220 }],
};

const FLAT: RoofArea = { ...PITCHED, id: "roof-flat", roofKind: "flat", tiltDeg: 0 };

function common(roof: RoofArea, currentPanels: readonly PanelInstance[], deltaDeg: number) {
  return {
    roof,
    currentPanels,
    catalogPanels: [PANEL],
    selectedPanelId: PANEL.id,
    modules: MODULES,
    companyPlannerDefaults: BUILT_IN_COMPANY_PLANNER_DEFAULTS,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    deltaDeg,
    layoutRunId: `run-${deltaDeg}`,
    createPanelId: (index: number) => `reflow-${deltaDeg}-${index}`,
  };
}

function initialStandard(orientation: "portrait" | "landscape" = "portrait") {
  const generated = buildDirectStandardRoofLayout({
    roof: PITCHED,
    panel: PANEL,
    modules: MODULES,
    orientation,
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    createPanelId: (index) => `initial-${orientation}-${index}`,
  });
  assert.ok(generated);
  return generated;
}

test("packed Standard whole layout reflows at +1 and -1 instead of rigidly rejecting", () => {
  const initial = initialStandard();
  const roof = { ...PITCHED, surfacePlanning: initial.config };
  for (const delta of [-1, 1]) {
    const result = buildWholeLayoutReflow({ ...common(roof, initial.panels, delta), modules: initial.modules });
    assert.ok(result);
    assert.ok(result.panels.length > 0);
    assert.equal(result.modules?.perRoofAngleOffsets?.[roof.id], (360 + delta) % 360);
    assert.equal(result.modules?.perRoofAngles?.[roof.id], undefined);
    assert.ok(result.panels.every((panel) => panel.angleDeg === (360 + delta) % 360));
    assert.equal("generatedLayoutFingerprint" in result.surfacePlanning, false);
  }
});

test("Standard whole ±90 reflow preserves Hochformat or Querformat", () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    const initial = initialStandard(orientation);
    const roof = { ...PITCHED, surfacePlanning: initial.config };
    for (const delta of [-90, 90]) {
      const result = buildWholeLayoutReflow({ ...common(roof, initial.panels, delta), modules: initial.modules });
      assert.ok(result);
      assert.ok(result.panels.every((panel) => panel.orientation === orientation));
      assert.equal(result.modules?.orientation, orientation);
    }
  }
});

test("explicit FIRST change reflows from the new base and preserves the relative offset", () => {
  const initial = initialStandard();
  const nextRoof = {
    ...PITCHED,
    referenceEdgeIndex: 1,
    surfacePlanning: initial.config,
  };
  const result = buildWholeLayoutReflow({
    ...common(nextRoof, initial.panels, 0),
    modules: {
      ...initial.modules,
      perRoofAngleOffsets: { [PITCHED.id]: 0 },
    },
    standardTargetAngleDeg: 90,
  });
  assert.ok(result);
  assert.ok(result.panels.length > 0);
  assert.ok(result.panels.every((panel) => panel.angleDeg === 90));
  assert.equal(result.modules?.perRoofAngleOffsets?.[PITCHED.id], 0);
});

function initialAdvanced(orientation: "south" | "east-west") {
  const config = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    orientation,
  });
  const generated = buildDirectAdvancedRoofLayout({
    roof: FLAT,
    config,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    layoutRunId: `initial-${orientation}`,
    createPanelId: (index) => `initial-${orientation}-${index}`,
  });
  assert.ok(generated);
  return generated;
}

test("D-Dome whole ±90 reflows complete atomic pairs at the exact requested orientation", () => {
  const initial = initialAdvanced("east-west");
  const roof = { ...FLAT, surfacePlanning: initial.config };
  const before = resolveAdvancedWorkingOrientationDeg(initial.config);
  for (const delta of [-90, 90]) {
    const result = buildWholeLayoutReflow(common(roof, initial.panels, delta));
    assert.ok(result);
    const resolved = resolveSurfacePlanning(result.surfacePlanning);
    assert.equal(resolved.status, "supported-advanced");
    assert.equal(resolved.status === "supported-advanced" ? resolved.config.advanced.system.systemId : "", K2_D_DOME_SYSTEM_ID);
    assert.equal(result.workingOrientationDeg, (before + delta + 360) % 360);
    const blocks = new Map<string, typeof result.panels>();
    result.panels.forEach((panel) => {
      const key = panel.advanced?.blockKey;
      assert.ok(key);
      blocks.set(key, [...(blocks.get(key) ?? []), panel]);
    });
    blocks.forEach((pair) => {
      assert.equal(pair.length, 2);
      assert.deepEqual(pair.map((panel) => panel.advanced?.slotIndex).sort(), [0, 1]);
      const faces = pair.map((panel) => panel.advanced?.moduleFaceAzimuthDeg as number).sort((a, b) => a - b);
      assert.equal(((faces[1] - faces[0]) + 360) % 360, 180);
    });
  }
});

test("S-Dome whole -90 preserves South system and produces a non-empty solution", () => {
  const initial = initialAdvanced("south");
  const roof = { ...FLAT, surfacePlanning: initial.config };
  const result = buildWholeLayoutReflow(common(roof, initial.panels, -90));
  assert.ok(result);
  const resolved = resolveSurfacePlanning(result.surfacePlanning);
  assert.equal(resolved.status, "supported-advanced");
  assert.equal(resolved.status === "supported-advanced" ? resolved.config.advanced.system.systemId : "", K2_S_DOME_SYSTEM_ID);
  assert.ok(result.panels.length > 0);
});

test("advanced orientation normalization wraps safely", () => {
  const initial = initialAdvanced("south").config;
  const rotated = rotateAdvancedWorkingOrientation(initial, 181);
  assert.equal(resolveAdvancedWorkingOrientationDeg(rotated), 1);
  assert.equal("generatedLayoutFingerprint" in rotated, false);
});

test("zero-solution reflow returns null so the caller preserves the old layout", () => {
  const initial = initialStandard();
  const tiny = {
    ...PITCHED,
    points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }],
    surfacePlanning: initial.config,
  };
  assert.equal(buildWholeLayoutReflow({ ...common(tiny, initial.panels, 90), modules: initial.modules }), null);
});
