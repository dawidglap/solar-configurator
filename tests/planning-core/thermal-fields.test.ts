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
  });
  assert.deepEqual(resolveCompanyThermalFieldLimits({
    company: legacy,
    roofKind: "flat",
    mountingOrientation: "east-west",
  }), {
    kind: "flat-block",
    maxRailDirectionM: 12.3,
    maxModuleLongSideDirectionM: 16,
  });
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

test("surface planning roundtrip preserves explicit thermal overrides and metadata remains optional", () => {
  const raw = {
    schemaVersion: SURFACE_PLANNING_SCHEMA_VERSION,
    mode: "standard",
    surface: { kind: "pitched", slopeDeg: 25 },
    thermalFieldLimits: {
      kind: "pitched-grid",
      maxRowDirectionM: 15,
      maxColumnDirectionM: 14,
    },
  };
  const resolved = resolveSurfacePlanning(JSON.parse(JSON.stringify(raw)));
  assert.equal(resolved.status, "supported-standard");
  if (resolved.status !== "supported-standard") return;
  assert.deepEqual(resolved.config.thermalFieldLimits, raw.thermalFieldLimits);
  assert.equal(resolveSurfacePlanning(undefined).status, "legacy-standard");
});

