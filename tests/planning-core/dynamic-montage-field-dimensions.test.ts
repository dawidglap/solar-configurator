import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createGenericEastWestBlock,
  createK2DDomeBlock,
  groupEffectiveMontageFields,
  groupK2MontageFields,
  instantiateAdvancedBlock,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
  type AdvancedBlockDefinition,
  type AdvancedSurfacePlanningV1,
} from "../../src/lib/planning-core/advanced";
import { rotateMetricPoint } from "../../src/lib/planning-core/geometry-v2";
import {
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  materializeAdvancedPanels,
  setAdvancedFixedQuantity,
  setAdvancedQuantityMode,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import { buildCommittedMontageFieldMeasurements } from "../../src/components_v2/modules/advanced/committedMontageFieldMeasurements";
import type { ModulesConfig, PanelSpec, RoofArea } from "../../src/types/planner";

const MODULE: PanelSpec = {
  id: "module-440",
  brand: "Test",
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
  marginM: 0.3,
  showGrid: true,
  placingSingle: false,
  gridPhaseX: 0,
  gridPhaseY: 0,
  gridAnchorX: "center",
  gridAnchorY: "center",
  coverageRatio: 1,
  perRoofAngles: {},
};
const ROOF: RoofArea = {
  id: "roof-field-measurement",
  name: "Roof",
  points: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ],
};
const MPP_IMAGE = 0.1;

test("Feldmaße is a default-off view toggle and is not part of persisted planning data", () => {
  const toolbar = readFileSync(
    new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../../src/components_v2/state/plannerV2Store.ts", import.meta.url),
    "utf8",
  );
  const partialize = store.slice(store.indexOf("partialize:"), store.indexOf("migrate:"));

  assert.match(toolbar, /Montagefeld-Maße anzeigen/);
  assert.match(toolbar, /Feldmaße/);
  assert.match(store, /showFieldDimensions: false/);
  assert.equal(partialize.includes("showFieldDimensions"), false);
});

function matrix(definition: AdvancedBlockDefinition, columns = 5, rows = 3) {
  const rotation = instantiateAdvancedBlock({
    definition,
    centerM: { x: 0, y: 0 },
    blockIndex: 0,
    rowIndex: 0,
    columnIndex: 0,
  }).rotationCartesianDeg;
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) =>
      instantiateAdvancedBlock({
        definition,
        centerM: rotateMetricPoint({
          x: columnIndex * definition.pitchM.x,
          y: rowIndex * definition.pitchM.y,
        }, rotation),
        blockIndex: rowIndex * columns + columnIndex,
        rowIndex,
        columnIndex,
      }),
    ),
  ).flat();
}

function fixedDDomeConfig(rowSpaceM?: number): AdvancedSurfacePlanningV1 {
  const initial = createInitialAdvancedPlanning({ panel: MODULE, standardModules: MODULES });
  assert.equal(initial.advanced.system.systemId, K2_D_DOME_SYSTEM_ID);
  const configured: AdvancedSurfacePlanningV1 = rowSpaceM === undefined
    ? initial
    : {
        ...initial,
        advanced: {
          ...initial.advanced,
          system: { ...initial.advanced.system, rowSpaceM },
        },
      };
  return setAdvancedFixedQuantity({
    config: setAdvancedQuantityMode({ config: configured, mode: "fixed" }),
    blocksPerRow: 5,
    rowCount: 3,
  });
}

function preview(config: AdvancedSurfacePlanningV1) {
  return computeAdvancedPlanningPreview({
    roof: ROOF,
    config,
    mppImage: MPP_IMAGE,
    zones: [],
    snowGuards: [],
  });
}

test("Feldmaße uses effective D-Dome footprints and current row pitch", () => {
  const firstAdapter = createK2DDomeBlock({
    module: { widthM: MODULE.widthM, heightM: MODULE.heightM, orientation: "landscape" },
    rowSpaceM: 2.61,
  });
  const secondAdapter = createK2DDomeBlock({
    module: { widthM: MODULE.widthM, heightM: MODULE.heightM, orientation: "landscape" },
    rowSpaceM: 2.7,
  });
  assert.equal(firstAdapter.valid && secondAdapter.valid, true);
  if (!firstAdapter.valid || !secondAdapter.valid) return;

  const measure = (definition: AdvancedBlockDefinition, rowSpaceM: number) =>
    groupK2MontageFields({
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      blocks: matrix(definition),
      moduleWidthM: MODULE.widthM,
      moduleLengthM: MODULE.heightM,
      rowSpaceM,
      pitchM: definition.pitchM,
    }).fields[0];
  const first = measure(firstAdapter.definition, 2.61);
  const second = measure(secondAdapter.definition, 2.7);

  assert.equal(first.blockCount, 15);
  assert.equal(first.moduleCount, 30);
  assert.ok(Math.abs(first.longSideSizeM - 8.776) < 1e-9);
  assert.ok(Math.abs(first.railSizeM - 7.540213872567181) < 1e-9);
  assert.ok(Math.abs((second.railSizeM - first.railSizeM) - 0.18) < 1e-9);
  assert.ok(Math.abs(second.longSideSizeM - first.longSideSizeM) < 1e-9);
});

test("generic effective field dimensions react to active gap, tilt and module size", () => {
  const build = (moduleGapX: number, tilt: number, moduleHeightM = MODULE.heightM) =>
    createGenericEastWestBlock({
      module: {
        widthM: MODULE.widthM,
        heightM: moduleHeightM,
        orientation: "landscape",
      },
      nominalTiltDeg: tilt,
      primaryFaceAzimuthDeg: 90,
      interModuleGapM: 0.078,
      moduleGapX,
      blockGapX: 0,
      blockGapY: 0.25,
    });
  const measure = (definition: AdvancedBlockDefinition) =>
    groupEffectiveMontageFields({
      blocks: matrix(definition),
      pitchM: definition.pitchM,
    })[0];
  const baseline = measure(build(0.018, 10));
  const widerGap = measure(build(0.03, 10));
  const steeper = measure(build(0.018, 25));
  const longerModule = measure(build(0.018, 10, 1.9));

  assert.ok(Math.abs((widerGap.longSideSizeM - baseline.longSideSizeM) - 0.048) < 1e-9);
  assert.notEqual(steeper.railSizeM, baseline.railSizeM);
  assert.notEqual(longerModule.longSideSizeM, baseline.longSideSizeM);
});

test("draft, Apply and JSON reload keep Feldmaße tied to the represented geometry", () => {
  const committedConfig = fixedDDomeConfig(2.61);
  const committedPreview = preview(committedConfig);
  assert.equal(committedPreview.valid, true);
  if (!committedPreview.valid) return;
  const committedPanels = materializeAdvancedPanels({
    roofId: ROOF.id,
    config: committedConfig,
    preview: committedPreview,
    layoutRunId: "run-261",
    createPanelId: (index) => `panel-${index}`,
  });
  const committedFields = buildCommittedMontageFieldMeasurements({
    roof: ROOF,
    config: committedConfig,
    panels: committedPanels,
    mppImage: MPP_IMAGE,
  });
  assert.equal(committedFields.length, committedPreview.montageFields.length);
  assert.ok(Math.abs(committedFields[0].railSizeM - committedPreview.montageFields[0].railSizeM) < 1e-9);
  assert.ok(Math.abs(committedFields[0].longSideSizeM - committedPreview.montageFields[0].longSideSizeM) < 1e-9);

  const draftConfig = fixedDDomeConfig(2.7);
  const draftPreview = preview(draftConfig);
  assert.equal(draftPreview.valid, true);
  if (!draftPreview.valid) return;
  assert.notEqual(draftPreview.montageFields[0].railSizeM, committedFields[0].railSizeM);

  const appliedPanels = materializeAdvancedPanels({
    roofId: ROOF.id,
    config: draftConfig,
    preview: draftPreview,
    layoutRunId: "run-270",
    createPanelId: (index) => `applied-${index}`,
  });
  const loadedConfig = JSON.parse(JSON.stringify(draftConfig)) as AdvancedSurfacePlanningV1;
  const loadedPanels = JSON.parse(JSON.stringify(appliedPanels));
  const loadedFields = buildCommittedMontageFieldMeasurements({
    roof: ROOF,
    config: loadedConfig,
    panels: loadedPanels,
    mppImage: MPP_IMAGE,
  });
  assert.ok(Math.abs(loadedFields[0].railSizeM - draftPreview.montageFields[0].railSizeM) < 1e-9);
  assert.ok(Math.abs(loadedFields[0].longSideSizeM - draftPreview.montageFields[0].longSideSizeM) < 1e-9);
});
