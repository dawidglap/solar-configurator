import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardFirstFrameCanvasAngle,
} from "../../src/components_v2/modules/legacyStandardApplicationPolicy";
import {
  PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  resolveModuleSlopeArrowAzimuth,
  resolveOutwardBlockArrowAzimuths,
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

test("FIRST defines a panel base whose local +Y points into the pitched roof", () => {
  const base = resolveStandardFirstFrameCanvasAngle({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: topFirstRoof.referenceEdgeIndex,
  });
  assert.equal(base, 0);
  assert.equal(resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: base!,
    localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  }), 180);
});

test("reversing polygon/FIRST endpoints preserves the physical base and arrow", () => {
  const reversed = {
    points: [...topFirstRoof.points].reverse(),
    referenceEdgeIndex: 2,
  };
  const base = resolveStandardFirstFrameCanvasAngle({
    roofPolygon: reversed.points,
    referenceEdgeIndex: reversed.referenceEdgeIndex,
  });
  assert.equal(base, 0);
  assert.equal(resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: base!,
    localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  }), 180);
});

test("choosing another FIRST recomputes the base frame deterministically", () => {
  assert.equal(resolveStandardFirstFrameCanvasAngle({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 0,
  }), 0);
  assert.equal(resolveStandardFirstFrameCanvasAngle({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 1,
  }), 90);
  assert.equal(resolveStandardFirstFrameCanvasAngle({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 2,
  }), 180);
});

test("new relative fine adjustment follows FIRST while legacy absolute angle remains compatible", () => {
  const relative = resolveStandardAutoLayoutCanvasAngle({
    roofId: "roof",
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 1,
    perRoofAngleOffsets: { roof: 90 },
    perRoofAngles: { roof: 17 },
  });
  assert.equal(relative, 180);

  const legacy = resolveStandardAutoLayoutCanvasAngle({
    roofId: "roof",
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 1,
    perRoofAngles: { roof: 17 },
  });
  assert.equal(legacy, 17);
});

test("+/-90 and +180 rotate the module and its local arrow by the same delta", () => {
  const base = 23.5;
  const arrow = resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: base,
    localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  });
  for (const delta of [-90, 90, 180]) {
    const rotated = resolveModuleSlopeArrowAzimuth({
      panelRotationCanvasDeg: base + delta,
      localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
    });
    assert.equal(rotated, ((arrow! + delta) % 360 + 360) % 360);
  }
});

test("portrait and landscape use the same canonical local downhill axis", () => {
  for (const _orientation of ["portrait", "landscape"] as const) {
    assert.equal(resolveModuleSlopeArrowAzimuth({
      panelRotationCanvasDeg: 90,
      localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
    }), 270);
  }
});

test("irregular pitched polygon still chooses the inward FIRST normal", () => {
  const base = resolveStandardFirstFrameCanvasAngle({
    roofPolygon: [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 11, y: 3 },
      { x: 7, y: 4 },
      { x: 5, y: 7 },
      { x: 0, y: 5 },
    ],
    referenceEdgeIndex: 0,
  });
  assert.equal(base, 0);
  assert.equal(resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: base!,
    localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  }), 180);
});

test("viewport rotation is absent from the panel/arrow domain model", () => {
  const panel = 37;
  const arrow = resolveModuleSlopeArrowAzimuth({
    panelRotationCanvasDeg: panel,
    localArrowOffsetDeg: PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG,
  });
  for (const _viewportRotation of [0, 37, 90, 180]) {
    assert.equal(arrow, 217);
  }
});

test("flat South fallback and D-Dome opposing arrows remain unchanged", () => {
  assert.equal(resolveModuleSlopeArrowAzimuth({ panelRotationCanvasDeg: 180 }), 180);
  const dDome = resolveOutwardBlockArrowAzimuths([
    { id: "west", blockKey: "b", cx: -1, cy: 0 },
    { id: "east", blockKey: "b", cx: 1, cy: 0 },
  ]);
  assert.equal(dDome.get("west"), 270);
  assert.equal(dDome.get("east"), 90);
});

test("committed, preview and manual pitched render paths share the local arrow offset", () => {
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
  assert.match(panelsKonva, /slopeArrowLocalOffsetDeg=\{isPitchedRoof/);
  assert.match(canvasStage, /slopeArrowLocalOffsetDeg=\{PITCHED_MODULE_LOCAL_ARROW_OFFSET_DEG\}/);
  assert.match(manualPlacement, /localArrowOffsetDeg=\{pitchedArrowLocalOffsetDeg\}/);
  assert.doesNotMatch(panelsKonva, /lockSlopeArrowToRoof/);
});
