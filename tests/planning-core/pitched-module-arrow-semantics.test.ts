import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  resolveStandardAutoLayoutCanvasAngle,
  resolveStandardFirstFrameCanvasAngle,
} from "../../src/components_v2/modules/legacyStandardApplicationPolicy";
import {
  resolveFlatSouthArrowAzimuth,
  resolveModuleSlopeArrowAzimuth,
  resolveOutwardBlockArrowAzimuths,
  resolvePitchedRoofArrowAzimuth,
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

function normalize(value: number): number {
  return ((value % 360) + 360) % 360;
}

test("FIRST defines a canonical downhill arrow independent from panels", () => {
  const base = resolveStandardFirstFrameCanvasAngle({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: topFirstRoof.referenceEdgeIndex,
  });
  assert.equal(base, 0);
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: topFirstRoof.referenceEdgeIndex,
  }), 180);
});

test("reversing polygon/FIRST endpoints preserves the physical arrow", () => {
  const reversed = {
    points: [...topFirstRoof.points].reverse(),
    referenceEdgeIndex: 2,
  };
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: reversed.points,
    referenceEdgeIndex: reversed.referenceEdgeIndex,
  }), 180);
});

test("choosing another FIRST recomputes the downhill direction", () => {
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 0,
  }), 180);
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 1,
  }), 270);
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 2,
  }), 0);
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

test("+/-90 and +180 rotate the panel but not the physical arrow", () => {
  const physicalArrowAzimuthDeg = resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 0,
  });
  for (const panelRotationCanvasDeg of [23.5, -66.5, 113.5, 203.5]) {
    assert.equal(resolveModuleSlopeArrowAzimuth({
      panelRotationCanvasDeg,
      physicalArrowAzimuthDeg,
    }), 180);
  }
});

test("portrait and landscape retain the same FIRST-derived downhill arrow", () => {
  for (const panelRotationCanvasDeg of [0, 90]) {
    assert.equal(resolveModuleSlopeArrowAzimuth({
      panelRotationCanvasDeg,
      physicalArrowAzimuthDeg: 180,
    }), 180);
  }
});

test("irregular pitched polygon still chooses the inward FIRST normal", () => {
  assert.equal(resolvePitchedRoofArrowAzimuth({
    roofPolygon: [
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

test("viewport rotation is absent from the physical arrow domain model", () => {
  const arrow = resolvePitchedRoofArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 0,
  });
  for (const _viewportRotation of [0, 37, 90, 180]) assert.equal(arrow, 180);
});

test("East-West arrows point from the shared ridge toward each module outer edge", () => {
  const members = [
    { id: "slot-0", blockKey: "b", slotIndex: 0, cx: -1, cy: 0 },
    { id: "slot-1", blockKey: "b", slotIndex: 1, cx: 1, cy: 0 },
  ];
  const horizontal = resolveOutwardBlockArrowAzimuths(members);
  assert.equal(horizontal.get("slot-0"), 270);
  assert.equal(horizontal.get("slot-1"), 90);

  const geometryRotatedNinety = resolveOutwardBlockArrowAzimuths(
    members.map((member) => ({ ...member, cx: -member.cy, cy: member.cx })),
  );
  assert.equal(geometryRotatedNinety.get("slot-0"), 0);
  assert.equal(geometryRotatedNinety.get("slot-1"), 180);
});

test("D-Dome arrows stay module-local and outward through a complete rotation", () => {
  const initial = [
    { id: "slot-0", blockKey: "b", slotIndex: 0, cx: -1, cy: 0 },
    { id: "slot-1", blockKey: "b", slotIndex: 1, cx: 1, cy: 0 },
  ];
  for (const delta of [0, 90, 180, 270, 360]) {
    const radians = delta * Math.PI / 180;
    const rotated = initial.map((member) => ({
      ...member,
      cx: member.cx * Math.cos(radians) - member.cy * Math.sin(radians),
      cy: member.cx * Math.sin(radians) + member.cy * Math.cos(radians),
    }));
    const arrows = resolveOutwardBlockArrowAzimuths(rotated);
    assert.equal(normalize(arrows.get("slot-1")! - arrows.get("slot-0")!), 180);
    rotated.forEach((member) => {
      const expected = normalize(Math.atan2(member.cx, -member.cy) * 180 / Math.PI);
      assert.ok(Math.abs(normalize(arrows.get(member.id)! - expected)) < 1e-9);
    });
  }
});

test("South keeps using the Referenzkante inward normal", () => {
  assert.equal(resolveFlatSouthArrowAzimuth({
    roofPolygon: topFirstRoof.points,
    referenceEdgeIndex: 0,
  }), 180);
});

test("committed, preview and manual render paths use canonical physical arrows", () => {
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
  const advancedPreview = readFileSync(
    new URL("../../src/components_v2/modules/advanced/AdvancedPreviewLayer.tsx", import.meta.url),
    "utf8",
  );
  const panelItem = readFileSync(
    new URL("../../src/components_v2/modules/panels/PanelItem.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panelsKonva, /resolvePitchedRoofArrowAzimuth/);
  assert.match(panelsKonva, /resolveOutwardBlockArrowAzimuths/);
  assert.match(canvasStage, /slopeArrowAzimuthDeg=\{standardSlopeArrowAzimuthDeg\}/);
  assert.match(manualPlacement, /resolvePitchedRoofArrowAzimuth/);
  assert.match(manualPlacement, /resolveOutwardBlockArrowAzimuths/);
  assert.match(advancedPreview, /resolveOutwardBlockArrowAzimuths/);
  assert.doesNotMatch(panelsKonva, /resolveDDomeLocalArrowAzimuth/);
  assert.doesNotMatch(advancedPreview, /resolveReferenceEdgeOpposingArrowAzimuths/);
  assert.doesNotMatch(panelItem, /visualRotationDeg - rotationDeg/);
  assert.doesNotMatch(panelsKonva, /slopeArrowLocalOffsetDeg/);
});
