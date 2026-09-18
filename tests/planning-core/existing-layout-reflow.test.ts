import assert from "node:assert/strict";
import test from "node:test";

import {
  K2_D_DOME_SYSTEM_ID,
  resolveSurfacePlanning,
} from "../../src/lib/planning-core/advanced";
import {
  buildDirectAdvancedRoofLayout,
  buildDirectStandardRoofLayout,
  createInitialAdvancedPlanning,
  getAdvancedRowSpaceM,
  getAdvancedServiceCorridorM,
  setAdvancedMountingOrientation,
  updateDefaultFlatSystem,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import {
  buildAdvancedExistingLayoutReflow,
  buildStandardExistingLayoutReflow,
} from "../../src/components_v2/modules/panels/existingLayoutReflow";
import type { ModulesConfig, PanelSpec, RoofArea } from "../../src/types/planner";

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

const ROOF: RoofArea = {
  id: "roof-flat",
  name: "D1",
  roofKind: "flat",
  tiltDeg: 0,
  points: [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 260 }, { x: 0, y: 260 }],
};
const PITCHED_ROOF: RoofArea = { ...ROOF, id: "roof-pitched", roofKind: "pitched", tiltDeg: 25 };
const PITCHED_THERMAL_LIMITS = {
  kind: "pitched-grid" as const,
  maxRowDirectionM: 17.6,
  maxColumnDirectionM: 17.6,
  thermalSeparationGapM: 0.14,
};

function initial() {
  const config = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    orientation: "east-west",
  });
  const generated = buildDirectAdvancedRoofLayout({
    roof: ROOF,
    config,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    layoutRunId: "initial",
    createPanelId: (index) => `panel-${index}`,
  });
  assert.ok(generated);
  return generated;
}

test("Reihenabstand reflows the existing topology without replacing panel or block identities", () => {
  const current = initial();
  const next = updateDefaultFlatSystem({
    config: current.config,
    orientation: "east-west",
    rowSpaceM: getAdvancedRowSpaceM(current.config) + 0.12,
  });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: current.config },
    currentPanels: current.panels,
    previousConfig: current.config,
    nextConfig: next,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
  });
  assert.ok(result);
  assert.equal(result.panels.length, current.panels.length);
  assert.deepEqual(result.panels.map((panel) => panel.id).sort(), current.panels.map((panel) => panel.id).sort());
  assert.deepEqual(
    result.panels.map((panel) => panel.advanced?.blockKey).sort(),
    current.panels.map((panel) => panel.advanced?.blockKey).sort(),
  );
  assert.ok(result.panels.some((panel, index) => panel.cy !== current.panels[index].cy));
  assert.equal(getAdvancedRowSpaceM(result.surfacePlanning as typeof next), getAdvancedRowSpaceM(next));
});

test("Wartungsgang is a real geometry command and remains consistent with Reihenabstand", () => {
  const current = initial();
  const corridor = getAdvancedServiceCorridorM(current.config) + 0.1;
  const next = updateDefaultFlatSystem({ config: current.config, orientation: "east-west", serviceCorridorM: corridor });
  assert.ok(Math.abs(getAdvancedServiceCorridorM(next) - corridor) < 1e-9);
  assert.ok(getAdvancedRowSpaceM(next) > getAdvancedRowSpaceM(current.config));
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: current.config }, currentPanels: current.panels,
    previousConfig: current.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(result);
  assert.ok(result.panels.some((panel, index) => panel.cy !== current.panels[index].cy));
});

test("D-Dome pairs remain atomic and IDs, block keys and slots survive reflow", () => {
  const current = initial();
  assert.equal(current.config.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  const next = updateDefaultFlatSystem({ config: current.config, orientation: "east-west", nominalTiltDeg: 12 });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: current.config }, currentPanels: current.panels,
    previousConfig: current.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(result);
  const pairs = new Map<string, typeof result.panels>();
  result.panels.forEach((panel) => {
    const key = panel.advanced?.blockKey;
    assert.ok(key);
    pairs.set(key, [...(pairs.get(key) ?? []), panel]);
  });
  pairs.forEach((pair) => {
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map((panel) => panel.advanced?.slotIndex).sort(), [0, 1]);
  });
  assert.deepEqual(result.panels.map((panel) => panel.id).sort(), current.panels.map((panel) => panel.id).sort());
  assert.ok(result.panels.some((panel, index) =>
    panel.wPx !== current.panels[index].wPx || panel.hPx !== current.panels[index].hPx,
  ));
});

test("Modulabstand changes physical column gaps while preserving the current manual azimuth", () => {
  const base = initial();
  const oriented = updateDefaultFlatSystem({ config: base.config, orientation: "east-west", azimuthDeg: 103 });
  const generated = buildDirectAdvancedRoofLayout({
    roof: ROOF, config: oriented, mppImage: 0.1, zones: [], snowGuards: [], layoutRunId: "oriented",
    createPanelId: (index) => `oriented-${index}`,
  });
  assert.ok(generated);
  const next = updateDefaultFlatSystem({ config: generated.config, orientation: "east-west", moduleGapM: 0.03 });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: generated.config }, currentPanels: generated.panels,
    previousConfig: generated.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(result);
  const resolved = resolveSurfacePlanning(result.surfacePlanning);
  assert.equal(resolved.status, "supported-advanced");
  assert.equal(
    resolved.status === "supported-advanced" && "primaryFaceAzimuthDeg" in resolved.config.advanced.system
      ? resolved.config.advanced.system.primaryFaceAzimuthDeg
      : undefined,
    103,
  );
  assert.ok(result.panels.some((panel, index) => panel.cx !== generated.panels[index].cx || panel.cy !== generated.panels[index].cy));
});

test("manually deleted holes stay deleted during reflow", () => {
  const current = initial();
  const removedBlock = current.panels[0].advanced?.blockKey;
  assert.ok(removedBlock);
  const withHole = current.panels.filter((panel) => panel.advanced?.blockKey !== removedBlock);
  const next = updateDefaultFlatSystem({
    config: current.config,
    orientation: "east-west",
    serviceCorridorM: getAdvancedServiceCorridorM(current.config) + 0.05,
  });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: current.config }, currentPanels: withHole,
    previousConfig: current.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(result);
  assert.equal(result.panels.length, withHole.length);
  assert.equal(result.panels.some((panel) => panel.advanced?.blockKey === removedBlock), false);
  assert.deepEqual(result.panels.map((panel) => panel.id).sort(), withHole.map((panel) => panel.id).sort());
});

test("South units reflow without D-Dome assumptions", () => {
  const config = setAdvancedMountingOrientation({
    config: createInitialAdvancedPlanning({ panel: PANEL, standardModules: MODULES }),
    orientation: "south",
  });
  const generated = buildDirectAdvancedRoofLayout({
    roof: ROOF, config, mppImage: 0.1, zones: [], snowGuards: [], layoutRunId: "south",
    createPanelId: (index) => `south-${index}`,
  });
  assert.ok(generated);
  const next = updateDefaultFlatSystem({ config: generated.config, orientation: "south", moduleGapM: 0.03 });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: generated.config }, currentPanels: generated.panels,
    previousConfig: generated.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(result);
  assert.equal(result.panels.length, generated.panels.length);
  assert.ok(result.panels.every((panel) => panel.advanced?.slotIndex === 0));
});

test("an impossible candidate returns null and cannot silently delete or mutate the old layout", () => {
  const current = initial();
  const before = structuredClone(current.panels);
  const next = updateDefaultFlatSystem({ config: current.config, orientation: "east-west", rowSpaceM: 20 });
  const result = buildAdvancedExistingLayoutReflow({
    roof: { ...ROOF, surfacePlanning: current.config }, currentPanels: current.panels,
    previousConfig: current.config, nextConfig: next, mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.equal(result, null);
  assert.deepEqual(current.panels, before);
});

test("Schrägdach H/V spacing reflows the same committed panel instances", () => {
  const generated = buildDirectStandardRoofLayout({
    roof: PITCHED_ROOF,
    panel: PANEL,
    modules: MODULES,
    orientation: "portrait",
    moduleTilt: { mode: "inherit-roof" },
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    thermalFieldLimits: PITCHED_THERMAL_LIMITS,
    createPanelId: (index) => `pitched-${index}`,
  });
  assert.ok(generated);
  const nextModules = { ...generated.modules, spacingXM: 0.01, spacingYM: 0.012 };
  const result = buildStandardExistingLayoutReflow({
    roof: { ...PITCHED_ROOF, surfacePlanning: generated.config },
    currentPanels: generated.panels,
    previousModules: generated.modules,
    nextModules,
    moduleTilt: { mode: "inherit-roof" },
    thermalFieldLimits: PITCHED_THERMAL_LIMITS,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
  });
  assert.ok(result);
  assert.equal(result.panels.length, generated.panels.length);
  assert.deepEqual(result.panels.map((panel) => panel.id).sort(), generated.panels.map((panel) => panel.id).sort());
  assert.ok(result.panels.some((panel, index) => panel.cx !== generated.panels[index].cx || panel.cy !== generated.panels[index].cy));
});

function smallestAxisGapM(
  panels: readonly { cx: number; cy: number; wPx: number; hPx: number }[],
  axis: "x" | "y",
  mppImage: number,
): number {
  const primary = axis === "x" ? "cx" : "cy";
  const cross = axis === "x" ? "cy" : "cx";
  const size = axis === "x" ? "wPx" : "hPx";
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < panels.length; left += 1) {
    for (let right = left + 1; right < panels.length; right += 1) {
      if (Math.abs(panels[left][cross] - panels[right][cross]) > 1e-6) continue;
      const centerDistanceM = Math.abs(panels[left][primary] - panels[right][primary]) * mppImage;
      const gapM = centerDistanceM - panels[left][size] * mppImage;
      if (gapM >= -1e-8) minimum = Math.min(minimum, gapM);
    }
  }
  return minimum;
}

for (const orientation of ["portrait", "landscape"] as const) {
  test(`Schrägdach ${orientation} maps Horizontal to local columns and Vertikal to local rows`, () => {
    const mppImage = 0.1;
    const initialModules = {
      ...MODULES,
      orientation,
      spacingM: 0.02,
      spacingXM: 0.02,
      spacingYM: 0.03,
    };
    const widthM = orientation === "portrait" ? PANEL.widthM : PANEL.heightM;
    const heightM = orientation === "portrait" ? PANEL.heightM : PANEL.widthM;
    const compact = Array.from({ length: 9 }, (_, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      return {
        id: `${orientation}-${index}`,
        roofId: PITCHED_ROOF.id,
        panelId: PANEL.id,
        cx: 80 + column * (widthM + 0.02) / mppImage,
        cy: 80 + row * (heightM + 0.03) / mppImage,
        wPx: widthM / mppImage,
        hPx: heightM / mppImage,
        angleDeg: 0,
        orientation,
      };
    });
    const generatedConfig = buildDirectStandardRoofLayout({
      roof: PITCHED_ROOF,
      panel: PANEL,
      modules: initialModules,
      orientation,
      moduleTilt: { mode: "inherit-roof" },
      mppImage,
      zones: [],
      snowGuards: [],
      thermalFieldLimits: PITCHED_THERMAL_LIMITS,
      createPanelId: (index) => `generated-${index}`,
    });
    assert.ok(generatedConfig);

    const horizontal = buildStandardExistingLayoutReflow({
      roof: { ...PITCHED_ROOF, surfacePlanning: generatedConfig.config },
      currentPanels: compact,
      previousModules: initialModules,
      nextModules: { ...initialModules, spacingM: 0.08, spacingXM: 0.08 },
      moduleTilt: { mode: "inherit-roof" },
      thermalFieldLimits: PITCHED_THERMAL_LIMITS,
      mppImage,
      zones: [],
      snowGuards: [],
    });
    assert.ok(horizontal);
    assert.ok(Math.abs(smallestAxisGapM(horizontal.panels, "x", mppImage) - 0.08) < 1e-6);
    assert.ok(Math.abs(smallestAxisGapM(horizontal.panels, "y", mppImage) - 0.03) < 1e-6);

    const vertical = buildStandardExistingLayoutReflow({
      roof: { ...PITCHED_ROOF, surfacePlanning: generatedConfig.config },
      currentPanels: compact,
      previousModules: initialModules,
      nextModules: { ...initialModules, spacingYM: 0.1 },
      moduleTilt: { mode: "inherit-roof" },
      thermalFieldLimits: PITCHED_THERMAL_LIMITS,
      mppImage,
      zones: [],
      snowGuards: [],
    });
    assert.ok(vertical);
    assert.ok(Math.abs(smallestAxisGapM(vertical.panels, "x", mppImage) - 0.02) < 1e-6);
    assert.ok(Math.abs(smallestAxisGapM(vertical.panels, "y", mppImage) - 0.1) < 1e-6);
  });

  test(`Schrägdach ${orientation} applies 80/100 mm -> 19/19 mm atomically`, () => {
    const mppImage = 0.1;
    const previousModules = {
      ...MODULES,
      orientation,
      spacingM: 0.08,
      spacingXM: 0.08,
      spacingYM: 0.1,
    };
    const widthM = orientation === "portrait" ? PANEL.widthM : PANEL.heightM;
    const heightM = orientation === "portrait" ? PANEL.heightM : PANEL.widthM;
    const currentPanels = Array.from({ length: 4 }, (_, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      return {
        id: `reported-${orientation}-${index}`,
        roofId: PITCHED_ROOF.id,
        panelId: PANEL.id,
        cx: 80 + column * (widthM + 0.08) / mppImage,
        cy: 80 + row * (heightM + 0.1) / mppImage,
        wPx: widthM / mppImage,
        hPx: heightM / mppImage,
        angleDeg: 0,
        orientation,
      };
    });
    assert.ok(Math.abs(smallestAxisGapM(currentPanels, "x", mppImage) - 0.08) < 1e-6);
    assert.ok(Math.abs(smallestAxisGapM(currentPanels, "y", mppImage) - 0.1) < 1e-6);

    const result = buildStandardExistingLayoutReflow({
      roof: PITCHED_ROOF,
      currentPanels,
      previousModules,
      nextModules: {
        ...previousModules,
        spacingM: 0.019,
        spacingXM: 0.019,
        spacingYM: 0.019,
      },
      moduleTilt: { mode: "inherit-roof" },
      thermalFieldLimits: PITCHED_THERMAL_LIMITS,
      mppImage,
      zones: [],
      snowGuards: [],
    });
    assert.ok(result);
    assert.deepEqual(result.panels.map((panel) => panel.id), currentPanels.map((panel) => panel.id));
    assert.ok(Math.abs(smallestAxisGapM(result.panels, "x", mppImage) - 0.019) < 1e-6);
    assert.ok(Math.abs(smallestAxisGapM(result.panels, "y", mppImage) - 0.019) < 1e-6);
    const resolved = resolveSurfacePlanning(result.surfacePlanning);
    assert.equal(resolved.status, "supported-standard");
    assert.deepEqual(
      resolved.status === "supported-standard" ? resolved.config.moduleSpacing : undefined,
      { horizontalM: 0.019, verticalM: 0.019 },
    );
  });
}

test("legacy/unsupported planning resolution is not changed by the pure reflow helper", () => {
  const unresolved = resolveSurfacePlanning(undefined);
  assert.equal(unresolved.status, "legacy-standard");
});

test("one successful reflow uses one atomic store commit and undo restores config plus exact geometry", async () => {
  const [{ usePlannerV2Store }, { history }] = await Promise.all([
    import("../../src/components_v2/state/plannerV2Store"),
    import("../../src/components_v2/state/history"),
  ]);
  const current = initial();
  const roof = { ...ROOF, surfacePlanning: current.config };
  const next = updateDefaultFlatSystem({
    config: current.config,
    orientation: "east-west",
    rowSpaceM: getAdvancedRowSpaceM(current.config) + 0.08,
  });
  const candidate = buildAdvancedExistingLayoutReflow({
    roof, currentPanels: current.panels, previousConfig: current.config, nextConfig: next,
    mppImage: 0.1, zones: [], snowGuards: [],
  });
  assert.ok(candidate);
  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.setState({ layers: [roof], panels: current.panels });
  history.clear();
  history.push("Abstände ändern");
  let storeWrites = 0;
  const unsubscribe = usePlannerV2Store.subscribe(() => { storeWrites += 1; });
  usePlannerV2Store.getState().commitRoofLayout({
    roofId: roof.id,
    panels: candidate.panels,
    surfacePlanning: candidate.surfacePlanning,
  });
  assert.equal(storeWrites, 1);
  history.undo();
  assert.equal(storeWrites, 2);
  assert.deepEqual(usePlannerV2Store.getState().panels, current.panels);
  assert.deepEqual(usePlannerV2Store.getState().layers[0].surfacePlanning, current.config);
  unsubscribe();
  history.clear();
  usePlannerV2Store.getState().resetPlanner();
});
