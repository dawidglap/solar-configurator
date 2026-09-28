import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatModuleOrientationDirection,
  resolveModuleOrientationDirections,
} from "../../src/components_v2/modules/moduleOrientation";
import {
  createInitialAdvancedPlanning,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type { RoofArea } from "../../src/types/planner";

const pitchedRoof: RoofArea = {
  id: "pitched",
  name: "D1",
  roofKind: "pitched",
  tiltDeg: 25,
  fallAzimuthDeg: 150,
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
};

const flatRoof: RoofArea = {
  ...pitchedRoof,
  id: "flat",
  roofKind: "flat",
  tiltDeg: 0,
};

test("pitched module orientation uses the same single direction as the compass", () => {
  const result = resolveModuleOrientationDirections({ roof: pitchedRoof });
  assert.equal(result.isFlat, false);
  assert.deepEqual(result.directionDegs, [150]);
  assert.equal(formatModuleOrientationDirection(result.directionDegs[0]), "150° SE");
});

test("K2 East-West exposes both opposing module directions", () => {
  const config = createInitialAdvancedPlanning({
    panel: {
      id: "module",
      brand: "Test",
      model: "440",
      widthM: 1.134,
      heightM: 1.722,
      wp: 440,
      priceChf: 0,
    },
    standardModules: {
      gridAngleDeg: 0,
      orientation: "portrait",
      spacingM: 0.019,
      marginM: 0.2,
      showGrid: false,
      placingSingle: false,
    },
  });
  const result = resolveModuleOrientationDirections({ roof: flatRoof, advancedConfig: config });
  assert.equal(result.isFlat, true);
  assert.equal(result.directionDegs.length, 2);
  assert.equal(
    (result.directionDegs[1] - result.directionDegs[0] + 360) % 360,
    180,
  );
  const restored = JSON.parse(JSON.stringify(config));
  assert.deepEqual(
    resolveModuleOrientationDirections({ roof: flatRoof, advancedConfig: restored }).directionDegs,
    result.directionDegs,
    "persisted orientation must survive a hard-refresh style JSON roundtrip",
  );
});

test("module roof rows render the shared directions and an empty-roof placeholder", () => {
  const source = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("resolveModuleOrientationDirections"));
  assert.ok(source.includes("data-module-orientation"));
  assert.ok(source.includes('moduleCount > 0'));
  assert.ok(source.includes('Keine Module auf dieser Dachfläche'));
  assert.ok(source.includes("moduleDirectionDegs.map"));
});

test("CompassHUD and Modulplanung import the same orientation resolver", () => {
  const compass = readFileSync(
    new URL("../../src/components_v2/compassHUD.tsx", import.meta.url),
    "utf8",
  );
  const sidebar = readFileSync(
    new URL("../../src/components_v2/panels/ModulesPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(compass.includes("resolveModuleOrientationDirections"));
  assert.ok(sidebar.includes("resolveModuleOrientationDirections"));
  assert.ok(compass.includes("formatModuleOrientationDirection"));
  assert.ok(sidebar.includes("formatModuleOrientationDirection"));
});
