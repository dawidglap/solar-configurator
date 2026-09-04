import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildThermalFieldDisplay,
  formatFieldMetres,
} from "../../src/components_v2/modules/thermalFields/thermalFieldDisplay";

const outlinePx = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const inputs = ["roof:run:t:0", "roof:run:t:1", "roof:run:t:2"].map((key, index) => ({
  key,
  outlinePx,
  lengthM: 5.53123 + index,
  widthM: 10.67123,
  moduleCount: 12,
  blockCount: 6,
  lengthLimitM: 17.6,
  widthLimitM: 17.6,
  valid: true,
}));

test("thermal field display keeps deterministic IDs and colors for canvas and drawer", () => {
  const first = buildThermalFieldDisplay(inputs);
  const second = buildThermalFieldDisplay(inputs);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((field) => field.displayId), ["T1", "T2", "T3"]);
  assert.equal(new Set(first.map((field) => field.color)).size, 3);
});

test("thermal colors remain stable when a materialization run prefix changes", () => {
  const preview = buildThermalFieldDisplay(inputs);
  const committed = buildThermalFieldDisplay(inputs.map((field) => ({
    ...field,
    key: field.key.replace("roof:run:", "roof:applied-run:"),
  })));
  assert.deepEqual(
    preview.map((field) => field.color),
    committed.map((field) => field.color),
  );
});

test("drawer values use German formatting with at most two decimals", () => {
  assert.equal(formatFieldMetres(5.53123), "5,53");
  assert.equal(formatFieldMetres(17.6), "17,6");
});

test("Feldmaße canvas contains compact IDs while detailed values live in the drawer", () => {
  const canvas = readFileSync(
    new URL("../../src/components_v2/modules/thermalFields/ThermalFieldCanvasLayer.tsx", import.meta.url),
    "utf8",
  );
  const drawer = readFileSync(
    new URL("../../src/components_v2/modules/thermalFields/ThermalFieldOverviewDrawer.tsx", import.meta.url),
    "utf8",
  );
  const advanced = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedPreviewLayer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(canvas, /text=\{field\.displayId\}/);
  assert.doesNotMatch(canvas, /toFixed\(2\).*×/);
  assert.doesNotMatch(advanced, /T\$\{fieldIndex \+ 1\} ·/);
  assert.match(drawer, /Feldübersicht/);
  assert.match(drawer, /Innerhalb Grenzwert/);
  assert.match(drawer, /field\.moduleCount/);
  assert.match(drawer, /field\.blockCount !== undefined/);
});

test("field outlines do not steal module input and selection stays on compact labels", () => {
  const canvas = readFileSync(
    new URL("../../src/components_v2/modules/thermalFields/ThermalFieldCanvasLayer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(canvas, /listening=\{false\}/);
  assert.match(canvas, /thermal-field-label/);
  assert.match(canvas, /onSelect\(field\.key\)/);
  assert.match(canvas, /strokeScaleEnabled=\{false\}/);
});

test("drawer is transient, independently collapsible and right controls receive an offset", () => {
  const stage = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../../src/components_v2/state/plannerV2Store.ts", import.meta.url),
    "utf8",
  );
  const partialize = store.slice(store.indexOf("partialize:"), store.indexOf("migrate:"));

  assert.match(stage, /fieldDrawerOpen/);
  assert.match(stage, /setFieldDrawerOpen\(true\)/);
  assert.match(stage, /rightOffsetPx/);
  assert.equal(partialize.includes("fieldDrawerOpen"), false);
  assert.equal(partialize.includes("selectedThermalFieldKey"), false);
});
