import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatModuleOrientationDirection,
  formatModuleOrientationDirections,
  resolveModuleOrientationDirections,
} from "../../src/components_v2/modules/moduleOrientation";
import {
  createInitialAdvancedPlanning,
  setAdvancedMountingOrientation,
} from "../../src/components_v2/modules/advanced/advancedPlanningApplication";
import type { RoofArea } from "../../src/types/planner";

const pitchedRoof: RoofArea = {
  id: "pitched",
  name: "D1",
  roofKind: "pitched",
  tiltDeg: 25,
  fallAzimuthDeg: 256,
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
};

const flatRoof: RoofArea = {
  ...pitchedRoof,
  id: "flat",
  roofKind: "flat",
  tiltDeg: 0,
};

test("pitched module orientation uses roof fall azimuth rather than technical canvas rotation", () => {
  const west = resolveModuleOrientationDirections({ roof: pitchedRoof });
  const east = resolveModuleOrientationDirections({
    roof: { ...pitchedRoof, id: "pitched-east", fallAzimuthDeg: 76 },
  });
  assert.equal(west.isFlat, false);
  assert.deepEqual(west.directionDegs, [256]);
  assert.equal(formatModuleOrientationDirection(west.directionDegs[0]), "W · 256°");
  assert.equal(formatModuleOrientationDirection(east.directionDegs[0]), "E · 76°");
  assert.equal(formatModuleOrientationDirection(west.directionDegs[0]).includes("78°"), false);
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
  assert.equal(formatModuleOrientationDirections(result.directionDegs), "E · 90° / W · 270°");
});

test("flat south exposes the mounting system face azimuth", () => {
  const base = createInitialAdvancedPlanning({
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
      gridAngleDeg: 78,
      orientation: "portrait",
      spacingM: 0.019,
      marginM: 0.2,
      showGrid: false,
      placingSingle: false,
    },
  });
  const south = setAdvancedMountingOrientation({ config: base, orientation: "south" });
  const result = resolveModuleOrientationDirections({ roof: flatRoof, advancedConfig: south });
  assert.deepEqual(result.directionDegs, [180]);
  assert.equal(formatModuleOrientationDirections(result.directionDegs), "S · 180°");
  assert.equal(formatModuleOrientationDirections(result.directionDegs).includes("78°"), false);
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
  assert.ok(source.includes("formatModuleOrientationDirections"));
  assert.ok(source.includes("Ausrichtung der Module"));
  assert.ok(source.includes("selectedCommittedModuleCount > 0"));
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
  assert.ok(compass.includes("formatModuleOrientationDirections"));
  assert.ok(sidebar.includes("formatModuleOrientationDirections"));
});
