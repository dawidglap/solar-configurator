import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { K2_D_DOME_ADAPTER_VERSION, K2_D_DOME_SYSTEM_ID } from "../../src/lib/planning-core/advanced";
import type { PanelInstance, RoofArea } from "../../src/types/planner";
import { validateExistingPanelPlacement } from "../../src/components_v2/modules/manualPlacement";
import {
  resolveDirectLayoutPivot,
  resolveDirectLayoutTargets,
  rotateDirectPanels,
  screenNudgeToImageDelta,
  translateDirectPanels,
} from "../../src/components_v2/modules/panels/directLayoutGeometry";

function panel(id: string, roofId = "roof-a", cx = 30, cy = 30): PanelInstance {
  return {
    id,
    roofId,
    cx,
    cy,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
    orientation: "portrait",
    panelId: "module",
  };
}

function dDome(id: string, slotIndex: number, cx: number): PanelInstance {
  return {
    ...panel(id, "roof-a", cx, 30),
    advanced: {
      layoutMode: "advanced",
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      advancedEngineVersion: "advanced-block-v1",
      geometryEngineVersion: "geometry-v2",
      blockKey: "block-1",
      slotIndex,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.648,
      moduleFaceAzimuthDeg: slotIndex ? 270 : 90,
    },
  };
}

const roof = {
  id: "roof-a",
  name: "D1",
  type: "roof",
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
} as RoofArea;

test("no selection targets the complete editable selected-roof layout only", () => {
  const locked = { ...panel("locked"), locked: true };
  const targets = resolveDirectLayoutTargets({
    panels: [panel("a"), panel("b"), panel("other", "roof-b"), locked],
    selectedPanelIds: [],
    roofId: "roof-a",
  });
  assert.deepEqual(targets.map((item) => item.id), ["a", "b"]);
});

test("a marquee subset remains the only target", () => {
  const targets = resolveDirectLayoutTargets({
    panels: [panel("a"), panel("b"), panel("c")],
    selectedPanelIds: ["a", "c"],
    roofId: "roof-a",
  });
  assert.deepEqual(targets.map((item) => item.id), ["a", "c"]);
});

test("whole-roof and marquee transforms leave every non-target panel untouched", () => {
  const allPanels = [panel("a", "roof-a", 20), panel("b", "roof-a", 40), panel("other", "roof-b", 60)];
  const wholeRoof = resolveDirectLayoutTargets({ panels: allPanels, selectedPanelIds: [], roofId: "roof-a" });
  const movedWholeRoof = translateDirectPanels(wholeRoof, { dx: 0.5, dy: 0 });
  assert.deepEqual(movedWholeRoof.map(({ id, cx }) => ({ id, cx })), [
    { id: "a", cx: 20.5 },
    { id: "b", cx: 40.5 },
  ]);
  assert.equal(allPanels[2].cx, 60);

  const subset = resolveDirectLayoutTargets({ panels: allPanels, selectedPanelIds: ["a"], roofId: "roof-a" });
  const rotatedSubset = rotateDirectPanels(subset, resolveDirectLayoutPivot(subset)!, 1);
  assert.equal(rotatedSubset[0].angleDeg, 1);
  assert.equal(allPanels[1].angleDeg, 0);
  assert.equal(allPanels[2].angleDeg, 0);
});

test("D-Dome selection expands to the complete physical pair", () => {
  const first = dDome("slot-0", 0, 25);
  const second = dDome("slot-1", 1, 35);
  const targets = resolveDirectLayoutTargets({
    panels: [first, second, panel("other")],
    selectedPanelIds: [first.id],
    roofId: "roof-a",
  });
  assert.deepEqual(targets.map((item) => item.id), ["slot-0", "slot-1"]);
});

test("10 mm movement is metric, zoom-independent and visually correct at -78 degrees", () => {
  const delta = screenNudgeToImageDelta({
    direction: "up",
    distanceM: 0.01,
    mppImage: 0.02,
    canvasRotationDeg: -78,
  });
  assert.ok(Math.abs(Math.hypot(delta.dx, delta.dy) * 0.02 - 0.01) < 1e-12);
  const radians = -78 * Math.PI / 180;
  const screenY = delta.dx * Math.sin(radians) + delta.dy * Math.cos(radians);
  const screenX = delta.dx * Math.cos(radians) - delta.dy * Math.sin(radians);
  assert.ok(Math.abs(screenX) < 1e-10);
  assert.ok(screenY < 0);

  const sameAtAnyZoom = screenNudgeToImageDelta({
    direction: "right",
    distanceM: 0.01,
    mppImage: 0.02,
    canvasRotationDeg: 0,
  });
  assert.equal(sameAtAnyZoom.dx, 0.5);
});

test("single and multi rotation preserve their deterministic pivots and relative geometry", () => {
  const single = panel("single", "roof-a", 20, 25);
  const singlePivot = resolveDirectLayoutPivot([single])!;
  const singleRotated = rotateDirectPanels([single], singlePivot, 1)[0];
  assert.equal(singleRotated.cx, 20);
  assert.equal(singleRotated.cy, 25);
  assert.equal(singleRotated.angleDeg, 1);

  const group = [panel("a", "roof-a", 20, 30), panel("b", "roof-a", 40, 30)];
  const pivot = resolveDirectLayoutPivot(group)!;
  const rotated = rotateDirectPanels(group, pivot, 90);
  assert.ok(Math.abs(rotated[0].cx - 30) < 1e-10);
  assert.ok(Math.abs(rotated[1].cx - 30) < 1e-10);
  assert.ok(Math.abs(Math.hypot(rotated[1].cx - rotated[0].cx, rotated[1].cy - rotated[0].cy) - 20) < 1e-10);
  assert.deepEqual(rotated.map((item) => item.angleDeg), [90, 90]);
});

test("D-Dome rigid rotation preserves pair distance, identity and opposite faces", () => {
  const pair = [dDome("slot-0", 0, 25), dDome("slot-1", 1, 35)];
  const rotated = rotateDirectPanels(pair, resolveDirectLayoutPivot(pair)!, 5);
  assert.equal(rotated[0].advanced?.blockKey, rotated[1].advanced?.blockKey);
  assert.deepEqual(rotated.map((item) => item.advanced?.slotIndex), [0, 1]);
  assert.ok(Math.abs(Math.hypot(rotated[1].cx - rotated[0].cx, rotated[1].cy - rotated[0].cy) - 10) < 1e-10);
  assert.equal(rotated[0].advanced?.moduleFaceAzimuthDeg, 85);
  assert.equal(rotated[1].advanced?.moduleFaceAzimuthDeg, 265);
});

test("canonical validation blocks roof edge, Randabstand, obstacle and static-panel collisions", () => {
  const moving = panel("moving", "roof-a", 30, 30);
  const common = {
    panel: moving,
    roof,
    marginM: 1,
    mppImage: 0.1,
    snowGuards: [],
    panels: [moving],
  };
  assert.equal(validateExistingPanelPlacement({
    ...common,
    centerPx: { x: 14, y: 30 },
    zones: [],
  }).valid, false);
  assert.equal(validateExistingPanelPlacement({
    ...common,
    centerPx: { x: 50, y: 50 },
    zones: [{ roofId: "roof-a", type: "riservata", points: [
      { x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 },
    ] }],
  }).valid, false);
  assert.equal(validateExistingPanelPlacement({
    ...common,
    centerPx: { x: 50, y: 50 },
    zones: [],
    panels: [moving, panel("static", "roof-a", 50, 50)],
  }).valid, false);
});

test("translation is rigid and source lifecycle keeps holds transient until one bulk commit", () => {
  const group = [panel("a", "roof-a", 20, 30), panel("b", "roof-a", 40, 30)];
  const moved = translateDirectPanels(group, { dx: 0.5, dy: -1 });
  assert.deepEqual(moved.map(({ cx, cy }) => ({ cx, cy })), [
    { cx: 20.5, cy: 29 },
    { cx: 40.5, cy: 29 },
  ]);

  const source = readFileSync("src/components_v2/modules/panels/DirectLayoutControl.tsx", "utf8");
  assert.match(source, /setTransientPanelGeometry\(transientMap\(next\)\)/);
  assert.match(source, /updatePanelsBulk\(Object\.fromEntries/);
  assert.match(source, /window\.addEventListener\("keydown", onEscape/);
  assert.match(source, /input, textarea, select, \[contenteditable='true'\], \[role='slider'\]/);
  assert.match(source, /onControllerKeyDown/);
  assert.match(source, /onControllerKeyUp/);
  assert.match(source, /finishGesture\(false\)/);
  assert.match(source, /HOLD_DELAY_MS = 300/);
  assert.match(source, /HOLD_REPEAT_MS = 80/);
  assert.equal((source.match(/updatePanelsBulk\(/g) ?? []).length, 1);

  const hotkeys = readFileSync("src/components_v2/modules/panels/PanelHotkeys.tsx", "utf8");
  assert.doesNotMatch(hotkeys, /tryNudge|isArrowKey|nudgeFromScreenDelta/);
  const layer = readFileSync("src/components_v2/modules/panels/PanelsLayer.tsx", "utf8");
  assert.doesNotMatch(layer, /st\.select\?\.\(undefined\)/);
});

test("consumed native Arrow repeats are prevented before the internal repeat guard", () => {
  const source = readFileSync("src/components_v2/modules/panels/DirectLayoutControl.tsx", "utf8");
  const handlerStart = source.indexOf("const onControllerKeyDown");
  const handlerEnd = source.indexOf("const onControllerKeyUp", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.ok(handler.includes("if (isInteractiveFormTarget(event.target)) return"));
  assert.ok(handler.indexOf("event.preventDefault()") < handler.indexOf("if (event.repeat) return"));
  assert.ok(handler.indexOf("if (!direction) return") < handler.indexOf("event.preventDefault()"));
});
