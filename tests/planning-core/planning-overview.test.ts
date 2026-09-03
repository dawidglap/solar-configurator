import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  ADVANCED_INPUT_SCHEMA_VERSION,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  K2_S_DOME_ADAPTER_VERSION,
  K2_S_DOME_SYSTEM_ID,
  SURFACE_PLANNING_SCHEMA_VERSION,
  type AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import { GEOMETRY_V2_ENGINE_VERSION } from "../../src/lib/planning-core/geometry-v2";
import {
  buildPlanningOverview,
  type PlanningOverviewPanelInput,
  type PlanningOverviewRoofInput,
} from "../../src/lib/planning-core/overview";

const CATALOG = [
  {
    id: "module-440",
    brand: "TestSolar",
    model: "TS-440",
    powerW: 440,
  },
];

function rectangleRoof(
  id: string,
  surfacePlanning?: AdvancedSurfacePlanningV1 | Record<string, unknown>,
): PlanningOverviewRoofInput {
  return {
    id,
    name: `Dachfläche ${id.toUpperCase()}`,
    points: [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 6 },
      { x: 0, y: 6 },
    ],
    ...(surfacePlanning ? { surfacePlanning } : {}),
  };
}

function k2Config(input: {
  system: "s" | "d";
  quantity?: { blocksPerRow: number; rowCount: number };
  surfaceKind?: "flat" | "green";
}): AdvancedSurfacePlanningV1 {
  return {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: input.surfaceKind ?? "flat", slopeDeg: 0 },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: {
        panelSpecId: "module-440",
        widthM: 1.134,
        heightM: 1.722,
        orientation: "landscape",
        powerW: 440,
      },
      system:
        input.system === "d"
          ? {
              systemId: K2_D_DOME_SYSTEM_ID,
              adapterVersion: K2_D_DOME_ADAPTER_VERSION,
              rowSpaceM: 2.6,
              primaryFaceAzimuthDeg: 90,
            }
          : {
              systemId: K2_S_DOME_SYSTEM_ID,
              adapterVersion: K2_S_DOME_ADAPTER_VERSION,
              rowSpaceM: 1.5,
              faceAzimuthDeg: 180,
            },
      layout: {
        marginM: 0.3,
        phaseX: 0,
        phaseY: 0,
        anchorX: "center",
        anchorY: "center",
        ...(input.quantity
          ? {
              quantityMode: "fixed" as const,
              blocksPerRow: input.quantity.blocksPerRow,
              rowCount: input.quantity.rowCount,
            }
          : {}),
      },
    },
  };
}

function standardPanels(roofId: string, count: number): PlanningOverviewPanelInput[] {
  return Array.from({ length: count }, () => ({
    roofId,
    panelId: "module-440",
  }));
}

function advancedPanels(input: {
  roofId: string;
  blockCount: number;
  modulesPerBlock: number;
  montageFieldCount?: number;
  thermalFieldCount?: number;
}): PlanningOverviewPanelInput[] {
  return Array.from(
    { length: input.blockCount * input.modulesPerBlock },
    (_, panelIndex) => ({
      roofId: input.roofId,
      panelId: "module-440",
      advanced: {
        blockKey: `${input.roofId}:block:${Math.floor(panelIndex / input.modulesPerBlock)}`,
        ...(input.montageFieldCount
          ? {
              montageFieldKey: `${input.roofId}:field:${Math.floor(
                Math.floor(panelIndex / input.modulesPerBlock) /
                  Math.ceil(input.blockCount / input.montageFieldCount),
              )}`,
            }
          : {}),
        ...(input.thermalFieldCount
          ? {
              thermalFieldKey: `${input.roofId}:thermal:${Math.floor(
                Math.floor(panelIndex / input.modulesPerBlock) /
                  Math.ceil(input.blockCount / input.thermalFieldCount),
              )}`,
            }
          : {}),
      },
    }),
  );
}

test("mixed committed planning produces 3 roofs, 52 modules and 22.88 kWp", () => {
  const roofs = [
    rectangleRoof("a"),
    rectangleRoof("b", k2Config({ system: "d", quantity: { blocksPerRow: 5, rowCount: 3 } })),
    rectangleRoof("c", k2Config({ system: "s" })),
  ];
  const panels = [
    ...standardPanels("a", 12),
    ...advancedPanels({ roofId: "b", blockCount: 15, modulesPerBlock: 2 }),
    ...advancedPanels({ roofId: "c", blockCount: 10, modulesPerBlock: 1 }),
  ];
  const overview = buildPlanningOverview({
    roofs,
    panels,
    catalogModules: CATALOG,
    mppImage: 1,
  });

  assert.equal(overview.roofCount, 3);
  assert.equal(overview.moduleCount, 52);
  assert.equal(overview.power.complete, true);
  assert.ok(Math.abs((overview.power.kwp ?? 0) - 22.88) < 1e-9);
  assert.equal(overview.roofs[0].surfaceKind, "pitched");
  assert.equal(overview.roofs[0].systemId, undefined);
  assert.deepEqual(overview.roofs[0].roofDimensions, { lengthM: 12, widthM: 6 });
});

test("K2 overview derives Montagefelder only from committed panel metadata", () => {
  const roof = rectangleRoof(
    "d",
    k2Config({ system: "d", quantity: { blocksPerRow: 5, rowCount: 3 } }),
  );
  const committed = advancedPanels({
    roofId: "d",
    blockCount: 15,
    modulesPerBlock: 2,
    montageFieldCount: 2,
    thermalFieldCount: 3,
  });
  const overview = buildPlanningOverview({
    roofs: [roof],
    panels: committed,
    catalogModules: CATALOG,
  });
  assert.equal(overview.roofs[0].blockCount, 15);
  assert.equal(overview.roofs[0].montageFieldCount, 2);
  assert.equal(overview.roofs[0].thermalFieldCount, 3);
  assert.equal(overview.roofs[0].moduleCount, 30);

  const legacyMaterialization = buildPlanningOverview({
    roofs: [roof],
    panels: advancedPanels({ roofId: "d", blockCount: 15, modulesPerBlock: 2 }),
  });
  assert.equal(legacyMaterialization.roofs[0].montageFieldCount, undefined);
});

test("D-Dome fixed 5 by 3 reports 15 committed blocks and 30 modules", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("d", k2Config({ system: "d", quantity: { blocksPerRow: 5, rowCount: 3 } }))],
    panels: advancedPanels({ roofId: "d", blockCount: 15, modulesPerBlock: 2 }),
    catalogModules: CATALOG,
    mppImage: 1,
  });
  const roof = overview.roofs[0];
  assert.deepEqual(roof.arrangement, {
    mode: "fixed",
    blocksPerRow: 5,
    rowCount: 3,
  });
  assert.equal(roof.blockCount, 15);
  assert.equal(roof.moduleCount, 30);
  assert.equal(roof.power.kwp, 13.2);
  assert.deepEqual(roof.orientationAzimuthDeg, [90, 270]);
  assert.equal(roof.nominalTiltDeg, 10);
  assert.equal(roof.rowSpaceM, 2.6);
  assert.ok((roof.serviceCorridorM ?? 0) > 0);
  assert.deepEqual(roof.warnings, []);
});

test("S-Dome keeps one committed module per block", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("s", k2Config({ system: "s", quantity: { blocksPerRow: 5, rowCount: 3 } }))],
    panels: advancedPanels({ roofId: "s", blockCount: 15, modulesPerBlock: 1 }),
    catalogModules: CATALOG,
  });
  const roof = overview.roofs[0];
  assert.equal(roof.blockCount, 15);
  assert.equal(roof.moduleCount, 15);
  assert.deepEqual(roof.orientationAzimuthDeg, [180]);
  assert.equal(roof.mountingOrientation, "south");
});

test("legacy pitched roof exposes no K2 fields", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("legacy")],
    panels: standardPanels("legacy", 12),
    catalogModules: CATALOG,
  });
  const roof = overview.roofs[0];
  assert.equal(roof.configurationStatus, "legacy-standard");
  assert.deepEqual(roof.arrangement, { mode: "standard" });
  assert.equal(roof.systemId, undefined);
  assert.equal(roof.blockCount, undefined);
  assert.equal(roof.rowSpaceM, undefined);
  assert.equal(roof.serviceCorridorM, undefined);
});

test("unapplied 6 by 3 draft is flagged but excluded from committed totals", () => {
  const committed = k2Config({
    system: "d",
    quantity: { blocksPerRow: 5, rowCount: 3 },
  });
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("d", committed)],
    panels: advancedPanels({ roofId: "d", blockCount: 15, modulesPerBlock: 2 }),
    catalogModules: CATALOG,
    dirtyRoofIds: ["d"],
  });
  assert.deepEqual(overview.roofs[0].arrangement, {
    mode: "fixed",
    blocksPerRow: 5,
    rowCount: 3,
  });
  assert.equal(overview.roofs[0].moduleCount, 30);
  assert.equal(overview.roofs[0].hasUnappliedDraft, true);
});

test("overview updates after committed fixed layout changes to 6 by 3", () => {
  const applied = buildPlanningOverview({
    roofs: [rectangleRoof("d", k2Config({ system: "d", quantity: { blocksPerRow: 6, rowCount: 3 } }))],
    panels: advancedPanels({ roofId: "d", blockCount: 18, modulesPerBlock: 2 }),
    catalogModules: CATALOG,
  });
  assert.deepEqual(applied.roofs[0].arrangement, {
    mode: "fixed",
    blocksPerRow: 6,
    rowCount: 3,
  });
  assert.equal(applied.roofs[0].blockCount, 18);
  assert.equal(applied.roofs[0].moduleCount, 36);
  assert.equal(applied.roofs[0].power.kwp, 15.84);
});

test("unknown Advanced configuration is preserved and materialized panels remain counted", () => {
  const unsupported = {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "advanced",
    surface: { kind: "flat" },
    advanced: {
      inputSchemaVersion: ADVANCED_INPUT_SCHEMA_VERSION,
      advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
      geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
      module: {
        panelSpecId: "module-440",
        widthM: 1.134,
        heightM: 1.722,
        orientation: "landscape",
        powerW: 440,
      },
      system: { systemId: "k2-d-dome-7.0-future", adapterVersion: "future" },
      layout: {
        marginM: 0.3,
        phaseX: 0,
        phaseY: 0,
        anchorX: "center",
        anchorY: "center",
      },
    },
  };
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("future", unsupported)],
    panels: standardPanels("future", 8),
    catalogModules: CATALOG,
  });
  assert.equal(overview.roofs[0].configurationStatus, "unsupported");
  assert.equal(overview.roofs[0].moduleCount, 8);
  assert.equal(overview.roofs[0].power.kwp, 3.52);
  assert.ok(overview.roofs[0].warnings.length > 0);
});

test("existing committed GreenRoof remains identifiable", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("green", k2Config({ system: "s", surfaceKind: "green" }))],
    panels: advancedPanels({ roofId: "green", blockCount: 4, modulesPerBlock: 1 }),
    catalogModules: CATALOG,
  });
  assert.equal(overview.roofs[0].surfaceKind, "green");
  assert.equal(overview.roofs[0].moduleCount, 4);
});

test("missing module power is explicit and never invented", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("a")],
    panels: [{ roofId: "a", panelId: "unknown-module" }],
  });
  assert.equal(overview.power.complete, false);
  assert.equal(overview.power.kwp, undefined);
  assert.equal(overview.power.missingPanelCount, 1);
});

test("generic polygon exposes reliable area without a misleading bounding-box dimension", () => {
  const overview = buildPlanningOverview({
    roofs: [
      {
        id: "concave",
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 2 },
          { x: 2, y: 2 },
          { x: 2, y: 4 },
          { x: 0, y: 4 },
        ],
      },
    ],
    panels: [],
    mppImage: 1,
  });
  assert.equal(overview.roofs[0].roofDimensions, undefined);
  assert.equal(overview.roofs[0].roofAreaM2, 12);
});

test("Advanced block count remains unavailable when committed panels lack block metadata", () => {
  const overview = buildPlanningOverview({
    roofs: [rectangleRoof("d", k2Config({ system: "d" }))],
    panels: standardPanels("d", 30),
    catalogModules: CATALOG,
  });
  assert.equal(overview.roofs[0].moduleCount, 30);
  assert.equal(overview.roofs[0].blockCount, undefined);
});

test("overview capability remains available while the toolbar entry point is hidden", () => {
  const toolbar = readFileSync(
    new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
    "utf8",
  );
  const drawer = readFileSync(
    new URL(
      "../../src/components_v2/modules/overview/PlanningOverviewDrawer.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(toolbar.includes("Planungsübersicht"), false);
  assert.equal(toolbar.includes("<PlanningOverviewDrawer"), false);
  assert.ok(drawer.includes('select(roofId)'));
  assert.ok(drawer.includes('setStep("modules")'));
  assert.ok(drawer.includes("rightPanelOpen: true"));
  assert.ok(drawer.includes('const isFlatK2 = isK2 && roof.surfaceKind === "flat"'));
  assert.ok(
    drawer.includes(
      "Vorplanung: Statik, Wind- und Schneelasten, Ballastierung und Befestigung wurden nicht geprüft.",
    ),
  );
});
