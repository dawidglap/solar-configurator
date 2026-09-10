import assert from "node:assert/strict";
import test from "node:test";

import {
  groupRectangularThermalUnits,
  groupThermalFields,
  resolveSurfacePlanning,
  SURFACE_PLANNING_SCHEMA_VERSION,
  ADVANCED_BLOCK_ENGINE_VERSION,
  type PlacedAdvancedBlock,
} from "../../src/lib/planning-core/advanced";
import {
  BUILT_IN_COMPANY_PLANNER_DEFAULTS,
  resolveCompanyPlannerDefaults,
  resolveCompanyThermalFieldLimits,
} from "../../src/lib/planning/companyPlannerDefaults";
import {
  generateThermalAxisPositions,
  generateGridPlacements,
  resolveBalancedThermalFieldSizes,
  resolveMaximumWholeUnits,
  thermalAxisSpan,
} from "../../src/lib/planning-core/geometry-v2";
import {
  computeAdvancedPlanningPreview,
  createInitialAdvancedPlanning,
  setAdvancedFixedQuantity,
  setAdvancedQuantityMode,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import { withEffectiveAdvancedThermalLimits } from "../../src/components_v2/modules/advanced/advancedThermalDefaults";

function rectangularUnits(columns: number, rows: number) {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => ({
      unitKey: `u:${row}:${column}`,
      centerM: { x: column, y: row },
      widthM: 0.9,
      heightM: 0.9,
      rotationCartesianDeg: 0,
    })),
  ).flat();
}

function advancedBlock(row: number, column: number): PlacedAdvancedBlock {
  return {
    engineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
    blockIndex: row * 10 + column,
    blockKey: `b:${row}:${column}`,
    mountingSystemId: "fixture",
    definitionVersion: "fixture-v1",
    centerM: { x: column * 1.8, y: row * 2.2 },
    planarOrientationDeg: 0,
    rotationCartesianDeg: 0,
    footprint: [
      { x: column * 1.8 - 0.85, y: row * 2.2 - 1 },
      { x: column * 1.8 + 0.85, y: row * 2.2 - 1 },
      { x: column * 1.8 + 0.85, y: row * 2.2 + 1 },
      { x: column * 1.8 - 0.85, y: row * 2.2 + 1 },
    ],
    moduleSlots: [{ slotIndex: 0 }, { slotIndex: 1 }] as never,
    derivedDimensionsM: {},
    warnings: [],
    rowIndex: row,
    columnIndex: column,
  };
}

test("built-in and legacy company documents resolve thermal defaults", () => {
  const legacy = resolveCompanyPlannerDefaults({
    schemaVersion: 1,
    moduleSpacing: { horizontalMm: 19, verticalMm: 20 },
  });
  assert.deepEqual(legacy.thermalSeparations, BUILT_IN_COMPANY_PLANNER_DEFAULTS.thermalSeparations);
  assert.deepEqual(resolveCompanyThermalFieldLimits({ company: legacy, roofKind: "pitched" }), {
    kind: "pitched-grid",
    maxRowDirectionM: 17.6,
    maxColumnDirectionM: 17.6,
    thermalSeparationGapM: 0.14,
  });
  assert.deepEqual(resolveCompanyThermalFieldLimits({
    company: legacy,
    roofKind: "flat",
    mountingOrientation: "east-west",
  }), {
    kind: "flat-block",
    maxRailDirectionM: 12.3,
    maxModuleLongSideDirectionM: 16,
    thermalSeparationGapM: 0.14,
  });
});

test("step limits keep the largest whole placement-unit count", () => {
  const max = resolveMaximumWholeUnits({ unitExtentM: 1.7, regularPitchM: 1.72, fieldLimitM: 17.6 });
  assert.equal(max, 10);
  assert.ok(1.7 + (max - 1) * 1.72 <= 17.6);
  assert.ok(1.7 + max * 1.72 > 17.6);
});

test("exact-edge extent is accepted and only the next whole unit exceeds the limit", () => {
  const unitExtentM = 1.7;
  const regularPitchM = 1.72;
  const exactTenUnitExtentM = unitExtentM + 9 * regularPitchM;
  assert.equal(exactTenUnitExtentM, 17.18);
  assert.equal(resolveMaximumWholeUnits({
    unitExtentM,
    regularPitchM,
    fieldLimitM: exactTenUnitExtentM,
  }), 10);
  assert.ok(unitExtentM + 10 * regularPitchM > exactTenUnitExtentM);
});

test("module orientation, size and spacing change the derived whole-step count", () => {
  const limitM = 17.6;
  const portraitAcrossFirst = resolveMaximumWholeUnits({
    unitExtentM: 1.134,
    regularPitchM: 1.134 + 0.019,
    fieldLimitM: limitM,
  });
  const landscapeAcrossFirst = resolveMaximumWholeUnits({
    unitExtentM: 1.722,
    regularPitchM: 1.722 + 0.019,
    fieldLimitM: limitM,
  });
  assert.equal(portraitAcrossFirst, 15);
  assert.equal(landscapeAcrossFirst, 10);

  const with19Mm = resolveMaximumWholeUnits({
    unitExtentM: 1.7,
    regularPitchM: 1.719,
    fieldLimitM: 17.25,
  });
  const with30Mm = resolveMaximumWholeUnits({
    unitExtentM: 1.7,
    regularPitchM: 1.73,
    fieldLimitM: 17.25,
  });
  assert.equal(with19Mm, 10);
  assert.equal(with30Mm, 9);
});

test("thermal break is an exact clear edge-to-edge replacement gap", () => {
  const axisBreak = { unitExtentM: 1, maxUnitsPerField: 2, separationGapM: 0.14 };
  const positions = generateThermalAxisPositions({
    min: 0,
    max: 10,
    pitch: 1.02,
    phase: 0,
    anchor: "start",
    count: 5,
    break: axisBreak,
  });
  assert.deepEqual(positions.map((value) => Number(value.toFixed(6))), [0, 1.02, 2.16, 3.18, 4.32]);
  assert.equal(Number((positions[2] - positions[1] - 1).toFixed(6)), 0.14);
  assert.equal(Number(thermalAxisSpan({ count: 5, regularPitchM: 1.02, break: axisBreak }).toFixed(6)), 4.32);
});

test("thermal runs use the minimum number of harmonious whole-unit fields", () => {
  assert.deepEqual(resolveBalancedThermalFieldSizes(18, 10), [9, 9]);
  assert.deepEqual(resolveBalancedThermalFieldSizes(23, 10), [8, 8, 7]);
  assert.deepEqual(resolveBalancedThermalFieldSizes(9, 10), [9]);

  const positions = generateThermalAxisPositions({
    min: 0,
    max: 100,
    pitch: 1,
    phase: 0,
    anchor: "start",
    count: 18,
    break: { unitExtentM: 0.9, maxUnitsPerField: 10, separationGapM: 0.2 },
  });
  assert.equal(Number((positions[9] - positions[8] - 0.9).toFixed(6)), 0.2);
  assert.equal(Number((positions[10] - positions[9]).toFixed(6)), 1);

  const grouped = groupRectangularThermalUnits({
    units: positions.map((x, columnIndex) => ({
      unitKey: `balanced:${columnIndex}`,
      centerM: { x, y: 0 },
      widthM: 0.9,
      heightM: 0.9,
      rotationCartesianDeg: 0,
      columnIndex,
      rowIndex: 0,
    })),
    pitchM: { x: 1, y: 1 },
    limits: {
      kind: "pitched-grid",
      maxRowDirectionM: 9.9,
      maxColumnDirectionM: 100,
      thermalSeparationGapM: 0.2,
    },
  });
  assert.deepEqual(grouped.fields.map((field) => field.unitCount), [9, 9]);
  assert.ok(grouped.fields.every((field) => field.rowDirectionSizeM <= 9.9));
});

test("company and per-roof gap precedence produce their exact physical clearance", () => {
  const company = resolveCompanyPlannerDefaults({
    schemaVersion: 1,
    moduleSpacing: { horizontalMm: 19, verticalMm: 19 },
    thermalSeparations: {
      gapMm: 200,
      pitched: { maxFieldLengthM: 17.6, maxFieldWidthM: 17.6 },
      flat: { maxPrimaryFieldLengthM: 12.3 },
      flatEastWest: { maxSecondaryFieldLengthM: 16 },
    },
  });
  const companyLimits = resolveCompanyThermalFieldLimits({
    company,
    roofKind: "flat",
    mountingOrientation: "east-west",
  });
  assert.equal(companyLimits.thermalSeparationGapM, 0.2);

  const panel = { id: "p", brand: "T", model: "440", wp: 440, widthM: 1.134, heightM: 1.722, priceChf: 0 };
  const initial = createInitialAdvancedPlanning({
    panel,
    standardModules: { orientation: "portrait", spacingM: 0.019, marginM: 0.3, showGrid: true, placingSingle: false } as never,
  });
  const companyResolved = withEffectiveAdvancedThermalLimits(
    { ...initial, thermalFieldLimits: undefined },
    company,
  );
  assert.equal(companyResolved.thermalFieldLimits?.thermalSeparationGapM, 0.2);
  const roofOverride = withEffectiveAdvancedThermalLimits({
    ...companyResolved,
    thermalFieldLimits: {
      ...companyResolved.thermalFieldLimits!,
      thermalSeparationGapM: 0.25,
    },
  }, company);
  assert.equal(roofOverride.thermalFieldLimits?.thermalSeparationGapM, 0.25);

  const positions = generateThermalAxisPositions({
    min: 0,
    max: 10,
    pitch: 1.02,
    phase: 0,
    anchor: "start",
    count: 3,
    break: { unitExtentM: 1, maxUnitsPerField: 2, separationGapM: 0.25 },
  });
  assert.equal(Number((positions[2] - positions[1] - 1).toFixed(6)), 0.25);
});

test("geometry-v2 inserts thermal breaks on both axes without splitting units", () => {
  const result = generateGridPlacements({
    usableRoof: {
      engineVersion: "geometry-v2",
      status: "valid",
      components: [[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }]],
      marginM: 0,
      diagnostics: [],
    },
    unit: {
      footprint: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }],
      pitchM: { x: 1.02, y: 1.03 },
    },
    thermalBreaks: {
      x: { unitExtentM: 1, maxUnitsPerField: 2, separationGapM: 0.14 },
      y: { unitExtentM: 1, maxUnitsPerField: 3, separationGapM: 0.2 },
    },
  });
  const row0 = result.placements.filter((placement) => placement.rowIndex === 0);
  assert.equal(Number((row0[2].originM.x - row0[1].originM.x - 1).toFixed(6)), 0.14);
  const column0 = result.placements.filter((placement) => placement.columnIndex === 0);
  assert.equal(Number((column0[3].originM.y - column0[2].originM.y - 1).toFixed(6)), 0.2);
  assert.ok(result.placements.every((placement) => placement.footprint.length === 4));
});

test("pitched thermal grouping splits both physical local axes deterministically", () => {
  const input = {
    units: rectangularUnits(6, 4),
    pitchM: { x: 1, y: 1 },
    limits: {
      kind: "pitched-grid" as const,
      maxRowDirectionM: 2.1,
      maxColumnDirectionM: 2.1,
    },
  };
  const first = groupRectangularThermalUnits(input);
  const second = groupRectangularThermalUnits({ ...input, units: [...input.units].reverse() });
  assert.deepEqual(second, first);
  assert.equal(first.fields.length, 6);
  assert.equal(Object.keys(first.unitToThermalFieldKey).length, 24);
  assert.ok(first.fields.every((field) => field.rowDirectionSizeM <= 2.1));
  assert.ok(first.fields.every((field) => field.columnDirectionSizeM <= 2.1));
});

test("holes split continuity and every unit belongs to exactly one thermal field", () => {
  const units = rectangularUnits(4, 2).filter((unit) => unit.unitKey !== "u:0:1");
  const result = groupRectangularThermalUnits({
    units,
    pitchM: { x: 1, y: 1 },
    limits: { kind: "pitched-grid", maxRowDirectionM: 100, maxColumnDirectionM: 100 },
  });
  const assigned = result.fields.flatMap((field) => field.unitKeys);
  assert.equal(assigned.length, units.length);
  assert.equal(new Set(assigned).size, units.length);
  assert.ok(result.fields.length > 1);
});

test("flat D-Dome-like pairs remain indivisible while thermal fields split", () => {
  const blocks = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) => advancedBlock(row, column)),
  ).flat();
  const result = groupThermalFields({
    units: blocks,
    pitchM: { x: 1.8, y: 2.2 },
    limits: {
      kind: "flat-block",
      maxRailDirectionM: 4.3,
      maxModuleLongSideDirectionM: 5.3,
    },
  });
  assert.equal(result.fields.reduce((sum, field) => sum + field.unitCount, 0), 15);
  assert.equal(result.fields.reduce((sum, field) => sum + field.moduleCount, 0), 30);
  assert.ok(result.fields.length > 1);
  assert.ok(result.fields.every((field) => field.compliant));
});

test("D-Dome fixed placement inserts the physical gap between indivisible pairs", () => {
  const panel = { id: "p", brand: "T", model: "440", wp: 440, widthM: 1.134, heightM: 1.722, priceChf: 0 };
  const modules = { orientation: "portrait", spacingM: 0.019, marginM: 0.3, showGrid: true, placingSingle: false } as never;
  const initial = createInitialAdvancedPlanning({ panel, standardModules: modules });
  const config = setAdvancedFixedQuantity({
    config: setAdvancedQuantityMode({
      config: {
        ...initial,
        thermalFieldLimits: {
          kind: "flat-block",
          maxRailDirectionM: 100,
          maxModuleLongSideDirectionM: 4,
          thermalSeparationGapM: 0.14,
        },
      },
      mode: "fixed",
    }),
    blocksPerRow: 5,
    rowCount: 1,
  });
  const result = computeAdvancedPlanningPreview({
    roof: { id: "r", name: "R", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }] },
    config,
    mppImage: 0.02,
    zones: [],
    snowGuards: [],
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.blockCount, 5);
  assert.equal(result.moduleCount, 10);
  assert.ok(result.thermalFieldCount > 1);
  const centers = result.blocks.map((block) => block.centerPx.y * 0.02);
  const normalDelta = centers[1] - centers[0];
  const thermalDelta = centers[2] - centers[1];
  assert.ok(thermalDelta > normalDelta);
  const firstFieldEdge = Math.max(...result.blocks[1].footprintPx.map((point) => point.y)) * 0.02;
  const secondFieldEdge = Math.min(...result.blocks[2].footprintPx.map((point) => point.y)) * 0.02;
  assert.equal(Number((secondFieldEdge - firstFieldEdge).toFixed(6)), 0.14);
});

test("surface planning roundtrip preserves explicit thermal overrides and metadata remains optional", () => {
  const raw = {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "standard",
    surface: { kind: "pitched", slopeDeg: 25 },
    thermalFieldLimits: {
      kind: "pitched-grid",
      maxRowDirectionM: 15,
      maxColumnDirectionM: 14,
      thermalSeparationGapM: 0.2,
    },
  };
  const resolved = resolveSurfacePlanning(JSON.parse(JSON.stringify(raw)));
  assert.equal(resolved.status, "supported-standard");
  if (resolved.status !== "supported-standard") return;
  assert.deepEqual(resolved.config.thermalFieldLimits, raw.thermalFieldLimits);
  assert.equal(resolveSurfacePlanning(undefined).status, "legacy-standard");
});
