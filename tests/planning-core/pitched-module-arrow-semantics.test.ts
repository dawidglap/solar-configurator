import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  resolveModuleSlopeArrowAzimuth,
  resolveOutwardBlockArrowAzimuths,
  resolvePitchedRoofDownhillAzimuth,
} from "../../src/components_v2/modules/panels/moduleSlope";

const topFirstRoof = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ],
  referenceEdgeIndex: 0,
};

test("pitched roof with FIRST on top resolves downhill towards the roof interior", () => {
  assert.equal(resolvePitchedRoofDownhillAzimuth(topFirstRoof), 180);
});

test("reversing polygon/FIRST endpoints cannot flip the physical downhill normal", () => {
  const reversed = {
    points: [...topFirstRoof.points].reverse(),
    referenceEdgeIndex: 2,
  };
  assert.equal(resolvePitchedRoofDownhillAzimuth(reversed), 180);
});

test("canonical roof fall azimuth wins over FIRST fallback", () => {
  assert.equal(resolvePitchedRoofDownhillAzimuth({
    ...topFirstRoof,
    fallAzimuthDeg: 164,
  }), 164);
});

test("irregular pitched polygon still resolves the inward FIRST normal", () => {
  assert.equal(resolvePitchedRoofDownhillAzimuth({
    points: [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 11, y: 3 },
      { x: 7, y: 4 },
      { x: 5, y: 7 },
      { x: 0, y: 5 },
    ],
    referenceEdgeIndex: 0,
  }), 180);
});

test("portrait, landscape and +/-90 panel rotations retain one roof-downhill arrow", () => {
  for (const panelRotationCanvasDeg of [0, 90, -90, 180, 37.25]) {
    assert.equal(resolveModuleSlopeArrowAzimuth({
      panelRotationCanvasDeg,
      physicalArrowAzimuthDeg: 164,
    }), 164);
  }
});

test("changing PanelInstance orientation metadata does not change pitched arrow direction", () => {
  const portrait = resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: 12,
    physicalArrowAzimuthDeg: 256,
  });
  const landscape = resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: 102,
    physicalArrowAzimuthDeg: 256,
  });
  assert.equal(portrait, 256);
  assert.equal(landscape, 256);
});

test("viewport rotation is absent from the domain resolver", () => {
  const domainDirection = resolvePitchedRoofDownhillAzimuth({
    ...topFirstRoof,
    fallAzimuthDeg: 210,
  });
  for (const _viewportRotation of [0, 37, 90, 180]) {
    assert.equal(domainDirection, 210);
  }
});

test("separate pitched roofs retain independent canonical directions", () => {
  assert.equal(resolvePitchedRoofDownhillAzimuth({ ...topFirstRoof, fallAzimuthDeg: 90 }), 90);
  assert.equal(resolvePitchedRoofDownhillAzimuth({ ...topFirstRoof, fallAzimuthDeg: 270 }), 270);
});

test("arrow resolution changes no panel identity, coordinate or count", () => {
  const panels = Array.from({ length: 18 }, (_, index) => ({
    id: `p-${index}`,
    cx: index * 3.25,
    cy: index * 1.75,
    angleDeg: index % 2 === 0 ? 14 : 104,
  }));
  const before = structuredClone(panels);
  const arrows = panels.map((panel) => resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: panel.angleDeg,
    physicalArrowAzimuthDeg: 164,
  }));
  assert.equal(arrows.length, 18);
  assert.ok(arrows.every((arrow) => arrow === 164));
  assert.deepEqual(panels, before);
});

test("flat-roof South fallback and D-Dome opposing arrows remain unchanged", () => {
  assert.equal(resolveModuleSlopeArrowAzimuth({ panelRotationCanvasDeg: 180 }), 180);
  const dDome = resolveOutwardBlockArrowAzimuths([
    { id: "west", blockKey: "b", cx: -1, cy: 0 },
    { id: "east", blockKey: "b", cx: 1, cy: 0 },
  ]);
  assert.equal(dDome.get("west"), 270);
  assert.equal(dDome.get("east"), 90);
});

test("committed, preview and manual pitched render paths share the roof direction", () => {
  const panelsKonva = readFileSync(
    new URL("../../src/components_v2/modules/PanelsKonva.tsx", import.meta.url),
    "utf8",
  );
  const canvasStage = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  const manualPlacement = readFileSync(
    new URL("../../src/components_v2/modules/ManualPlacementLayer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panelsKonva, /resolvePitchedRoofDownhillAzimuth\(roof\)/);
  assert.match(panelsKonva, /lockSlopeArrowToRoof=\{pitchedRoofArrowAzimuthDeg !== undefined\}/);
  assert.match(canvasStage, /slopeArrowAzimuthDeg=\{resolvePitchedRoofDownhillAzimuth\(selectedRoof\)\}/);
  assert.match(manualPlacement, /session\.kind === "standard-module"/);
  assert.match(manualPlacement, /resolvePitchedRoofDownhillAzimuth\(roof\)/);
});
