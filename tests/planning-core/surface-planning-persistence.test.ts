import assert from "node:assert/strict";
import test from "node:test";

import realPlanning from "./fixtures/real-planning-anonymized.json";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  GENERIC_EAST_WEST_SYSTEM_ID,
  GENERIC_MOUNTING_ADAPTER_VERSION,
  GENERIC_SOUTH_SYSTEM_ID,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  SURFACE_PLANNING_SCHEMA_VERSION,
  clearSurfacePlanningOnRoofs,
  getRoofSurfacePlanning,
  resolveSurfacePlanning,
  setCommittedSurfacePlanningOnRoofs,
  type AdvancedSurfacePlanningV1,
  type SurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import { GEOMETRY_V2_ENGINE_VERSION } from "../../src/lib/planning-core/geometry-v2";
import type { PanelInstance, RoofArea } from "../../src/types/planner";

const LAYOUT = {
  marginM: 0.3,
  phaseX: 0.25,
  phaseY: 0.5,
  anchorX: "center" as const,
  anchorY: "end" as const,
};

function moduleSnapshot() {
  return {
    panelSpecId: "catalog-module-440",
    widthM: 1.134,
    heightM: 1.722,
    orientation: "landscape" as const,
    powerW: 440,
  };
}

function sDomeConfig(): AdvancedSurfacePlanningV1 {
  return {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: "flat", slopeDeg: 2, fallAzimuthDeg: 135 },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: moduleSnapshot(),
      system: {
        systemId: K2_S_DOME_SYSTEM_ID,
        adapterVersion: K2_S_DOME_ADAPTER_VERSION,
        rowSpaceM: 1.5,
        faceAzimuthDeg: 180,
      },
      layout: { ...LAYOUT },
    },
  };
}

function dDomeConfig(): AdvancedSurfacePlanningV1 {
  return {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: "flat", slopeDeg: 1.5, fallAzimuthDeg: 120 },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: moduleSnapshot(),
      system: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
        rowSpaceM: 2.6,
        primaryFaceAzimuthDeg: 90,
      },
      layout: { ...LAYOUT, anchorY: "start" },
    },
  };
}

function roof(id: string, surfacePlanning?: SurfacePlanningV1): RoofArea {
  return {
    id,
    name: id,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    ...(surfacePlanning ? { surfacePlanning } : {}),
  };
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("anonymized legacy roof stays implicit Standard and is not migrated on roundtrip", () => {
  const legacyRoof: RoofArea = {
    id: realPlanning.roofId,
    name: "Anonymized legacy roof",
    points: realPlanning.polygon,
  };

  const before = JSON.stringify(legacyRoof);
  const loaded = jsonRoundTrip(legacyRoof);
  const resolution = resolveSurfacePlanning(loaded.surfacePlanning);

  assert.equal(resolution.status, "legacy-standard");
  assert.equal(resolution.effectiveMode, "standard");
  assert.equal("surfacePlanning" in loaded, false);
  assert.equal(JSON.stringify(loaded), before);
});

test("S-Dome canonical inputs survive JSON save/load without derived values", () => {
  const config = sDomeConfig();
  const loaded = jsonRoundTrip(config);
  const resolution = resolveSurfacePlanning(loaded);

  assert.equal(resolution.status, "supported-advanced");
  assert.deepEqual(resolution.config, config);
  assert.equal("effectiveTiltDeg" in loaded.advanced.system, false);
  assert.equal("serviceCorridorM" in loaded.advanced.system, false);
  assert.equal("blockCount" in loaded.advanced, false);
});

test("D-Dome canonical inputs survive JSON save/load without contradictory corridor inputs", () => {
  const config = dDomeConfig();
  const loaded = jsonRoundTrip(config);
  const resolution = resolveSurfacePlanning(loaded);

  assert.equal(resolution.status, "supported-advanced");
  assert.deepEqual(resolution.config, config);
  assert.equal("serviceCorridorM" in loaded.advanced.system, false);
  assert.equal("blockGapY" in loaded.advanced.system, false);
});

test("generic South/East-West remain distinct persisted system variants", () => {
  const base = sDomeConfig();
  const south: AdvancedSurfacePlanningV1 = {
    ...base,
    advanced: {
      ...base.advanced,
      system: {
        systemId: GENERIC_SOUTH_SYSTEM_ID,
        adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
        nominalTiltDeg: 10,
        faceAzimuthDeg: 190,
        blockGapX: 0.02,
        blockGapY: 0.5,
      },
    },
  };
  const eastWest: AdvancedSurfacePlanningV1 = {
    ...base,
    advanced: {
      ...base.advanced,
      system: {
        systemId: GENERIC_EAST_WEST_SYSTEM_ID,
        adapterVersion: GENERIC_MOUNTING_ADAPTER_VERSION,
        nominalTiltDeg: 10,
        primaryFaceAzimuthDeg: 100,
        interModuleGapM: 0.1,
        blockGapX: 0.02,
        blockGapY: 0.6,
      },
    },
  };

  const southResolution = resolveSurfacePlanning(jsonRoundTrip(south));
  const eastWestResolution = resolveSurfacePlanning(jsonRoundTrip(eastWest));
  assert.equal(southResolution.status, "supported-advanced");
  assert.equal(eastWestResolution.status, "supported-advanced");
  assert.equal(
    southResolution.status === "supported-advanced"
      ? southResolution.config.advanced.system.systemId
      : null,
    GENERIC_SOUTH_SYSTEM_ID,
  );
  assert.equal(
    eastWestResolution.status === "supported-advanced"
      ? eastWestResolution.config.advanced.system.systemId
      : null,
    GENERIC_EAST_WEST_SYSTEM_ID,
  );
});

test("physical green-roof metadata is persistible without inventing GreenRoof geometry", () => {
  const config: SurfacePlanningV1 = {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "standard",
    surface: { kind: "green", slopeDeg: 3, fallAzimuthDeg: 450 },
  };
  const resolution = resolveSurfacePlanning(jsonRoundTrip(config));

  assert.equal(resolution.status, "supported-standard");
  assert.equal(
    resolution.status === "supported-standard"
      ? resolution.config.surface.fallAzimuthDeg
      : null,
    90,
  );
  assert.equal("advanced" in config, false);
});

test("mixed roofs retain independent legacy, S-Dome and D-Dome configurations", () => {
  const original = [roof("roof-a"), roof("roof-b", sDomeConfig()), roof("roof-c", dDomeConfig())];
  const loaded = jsonRoundTrip(original);
  const roofA = getRoofSurfacePlanning(loaded, "roof-a");
  const roofB = getRoofSurfacePlanning(loaded, "roof-b");
  const roofC = getRoofSurfacePlanning(loaded, "roof-c");

  assert.equal(roofA.status, "legacy-standard");
  assert.equal(roofB.status, "supported-advanced");
  assert.equal(roofC.status, "supported-advanced");
  assert.equal(
    roofB.status === "supported-advanced"
      ? roofB.config.advanced.system.systemId
      : null,
    K2_S_DOME_SYSTEM_ID,
  );
  assert.equal(
    roofC.status === "supported-advanced"
      ? roofC.config.advanced.system.systemId
      : null,
    K2_D_DOME_SYSTEM_ID,
  );
});

test("pure roof helpers set and clear committed config without changing other roofs", () => {
  const original = [roof("roof-a"), roof("roof-b")];
  const configured = setCommittedSurfacePlanningOnRoofs(original, "roof-b", dDomeConfig());

  assert.strictEqual(configured[0], original[0]);
  assert.equal(getRoofSurfacePlanning(configured, "roof-a").status, "legacy-standard");
  assert.equal(getRoofSurfacePlanning(configured, "roof-b").status, "supported-advanced");

  const cleared = clearSurfacePlanningOnRoofs(configured, "roof-b");
  assert.equal("surfacePlanning" in cleared[1], false);
  assert.equal(getRoofSurfacePlanning(cleared, "roof-b").status, "legacy-standard");
});

test("D-Dome panel metadata preserves stable shared block identity and opposing slots", () => {
  const base: Omit<PanelInstance, "id" | "cx" | "advanced"> = {
    roofId: "roof-c",
    cy: 20,
    wPx: 17.22,
    hPx: 11.34,
    angleDeg: 0,
    orientation: "landscape",
    panelId: "catalog-module-440",
  };
  const panels: PanelInstance[] = [0, 1].map((slotIndex) => ({
    ...base,
    id: `panel-${slotIndex}`,
    cx: 10 + slotIndex * 12,
    advanced: {
      layoutMode: "advanced",
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      blockKey: "roof-c:block:3:4",
      montageFieldKey: "roof-c:field:1",
      slotIndex,
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.648115980791399,
      moduleFaceAzimuthDeg: slotIndex === 0 ? 90 : 270,
      layoutRunId: "apply-2026-08-26-001",
    },
  }));

  const loaded = jsonRoundTrip(panels);
  assert.deepEqual(loaded, panels);
  assert.equal(loaded[0].advanced?.blockKey, loaded[1].advanced?.blockKey);
  assert.equal(loaded[0].advanced?.montageFieldKey, loaded[1].advanced?.montageFieldKey);
  assert.deepEqual(loaded.map((panel) => panel.advanced?.slotIndex), [0, 1]);
  assert.deepEqual(loaded.map((panel) => panel.advanced?.moduleFaceAzimuthDeg), [90, 270]);

  const legacyPanel: PanelInstance = { ...base, id: "legacy", cx: 0 };
  assert.deepEqual(jsonRoundTrip(legacyPanel), legacyPanel);
});

test("unknown future Advanced system is preserved and never downgraded to Standard", () => {
  const raw = {
    ...dDomeConfig(),
    advanced: {
      ...dDomeConfig().advanced,
      system: {
        systemId: "k2-d-dome-7.0-future",
        adapterVersion: "99-999-99@2028-01-01",
        rowSpaceM: 2.7,
        primaryFaceAzimuthDeg: 100,
        futureField: { keep: true },
      },
    },
  };
  const materializedPanels = [{ id: "existing-advanced-panel", roofId: "roof-future" }];
  const document = jsonRoundTrip({ surfacePlanning: raw, panels: materializedPanels });
  const resolution = resolveSurfacePlanning(document.surfacePlanning);

  assert.equal(resolution.status, "unsupported-advanced");
  assert.equal(resolution.effectiveMode, "advanced");
  assert.deepEqual(resolution.raw, raw);
  assert.deepEqual(document.panels, materializedPanels);
});

test("incomplete declared Advanced config is invalid Advanced, not Standard", () => {
  const raw = {
    schemaVersion: 1,
    mode: "advanced",
    surface: { kind: "flat" },
    advanced: {
      inputSchemaVersion: 1,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: moduleSnapshot(),
      system: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      },
      layout: LAYOUT,
    },
  };

  const resolution = resolveSurfacePlanning(raw);
  assert.equal(resolution.status, "invalid-advanced");
  assert.equal(resolution.effectiveMode, "advanced");
  assert.ok(resolution.issues.some((current) => current.path === "advanced.system.rowSpaceM"));
});

test("hydration normalization is structural only and leaves materialized panels untouched", () => {
  const panels = [
    { id: "a", blockKey: "block-1", slotIndex: 0 },
    { id: "b", blockKey: "block-1", slotIndex: 1 },
  ];
  const payload = jsonRoundTrip({ layers: [roof("roof-c", dDomeConfig())], panels });
  const beforePanels = JSON.stringify(payload.panels);

  const resolution = getRoofSurfacePlanning(payload.layers, "roof-c");

  assert.equal(resolution.status, "supported-advanced");
  assert.equal(JSON.stringify(payload.panels), beforePanels);
});

test("Zustand committed actions and planner export/import roundtrip per-roof data", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  const { buildPlannerPayloadFromStore } = await import("../../src/components_v2/state/planning/savePlanning");
  const store = usePlannerV2Store.getState();
  store.resetPlanner();
  usePlannerV2Store.setState({ layers: [roof("roof-a"), roof("roof-b")] });

  usePlannerV2Store.getState().setCommittedSurfacePlanning("roof-b", sDomeConfig());
  const payload = buildPlannerPayloadFromStore();
  const persisted = jsonRoundTrip(payload);

  assert.equal("surfacePlanning" in persisted.layers[0], false);
  assert.deepEqual(persisted.layers[1].surfacePlanning, sDomeConfig());

  usePlannerV2Store.getState().resetPlanner();
  usePlannerV2Store.getState().importState(persisted);
  const loaded = usePlannerV2Store.getState();

  assert.equal(loaded.getSurfacePlanning("roof-a").status, "legacy-standard");
  assert.equal(loaded.getSurfacePlanning("roof-b").status, "supported-advanced");
  assert.deepEqual(loaded.panels, []);

  loaded.clearSurfacePlanning("roof-b");
  assert.equal(loaded.getSurfacePlanning("roof-b").status, "legacy-standard");
  assert.equal("surfacePlanning" in usePlannerV2Store.getState().layers[1], false);
  usePlannerV2Store.getState().resetPlanner();
  if (previousStorage) {
    Object.defineProperty(globalThis, "localStorage", previousStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
