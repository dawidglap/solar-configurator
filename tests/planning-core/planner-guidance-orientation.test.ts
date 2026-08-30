import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolvePlannerStepForTool,
  resolvePlannerToolHotkey,
} from "../../src/components_v2/layout/toolHotkeyPolicy";
import {
  formatRoofAzimuth,
  normalizeRoofAzimuthDeg,
  roofAzimuthCardinal,
} from "../../src/components_v2/roof/roofOrientation";

test("A, D, R and H always resolve to the advertised planner tools", () => {
  assert.equal(resolvePlannerToolHotkey("A"), "select");
  assert.equal(resolvePlannerToolHotkey("d"), "draw-roof");
  assert.equal(resolvePlannerToolHotkey("R"), "draw-rect");
  assert.equal(resolvePlannerToolHotkey("h"), "draw-reserved");
  assert.equal(resolvePlannerToolHotkey("x"), undefined);
});

test("drawing shortcuts resolve the building step while selection preserves context", () => {
  assert.equal(resolvePlannerStepForTool("draw-roof", "modules"), "building");
  assert.equal(resolvePlannerStepForTool("draw-rect", "modules"), "building");
  assert.equal(resolvePlannerStepForTool("draw-reserved", "modules"), "building");
  assert.equal(resolvePlannerStepForTool("select", "modules"), "modules");
  assert.equal(resolvePlannerStepForTool("fill-area", "building"), "modules");
});

test("roof direction uses one geographic convention without a hidden 180 degree inversion", () => {
  assert.equal(normalizeRoofAzimuthDeg(360), 0);
  assert.equal(normalizeRoofAzimuthDeg(-104), 256);
  assert.equal(roofAzimuthCardinal(76), "E");
  assert.equal(roofAzimuthCardinal(256), "W");
  assert.equal(formatRoofAzimuth(76), "76° E");
  assert.equal(formatRoofAzimuth(256), "256° W");
});

test("contextual help and pitched-roof slope controls remain visible in source", () => {
  const toolbar = readFileSync(
    new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
    "utf8",
  );
  const help = readFileSync(
    new URL("../../src/components_v2/layout/PlannerHelpDialog.tsx", import.meta.url),
    "utf8",
  );
  const panel = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  const compass = readFileSync(
    new URL("../../src/components_v2/compassHUD.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(toolbar.includes("CircleHelp"));
  assert.ok(help.includes("Gebäudeplanung – Hilfe"));
  assert.ok(help.includes("Modulplanung – Hilfe"));
  assert.ok(help.includes("Rechteck zeichnen"));
  assert.ok(help.includes("Hindernis zeichnen"));
  assert.ok(panel.includes("PitchedRoofSlopeControl"));
  assert.equal(panel.includes("norm360(a + 180)"), false);
  assert.equal(compass.includes("+ rotateDeg"), false);
});
