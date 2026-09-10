import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLatestFrameScheduler } from "../../src/components_v2/canvas/performance/latestFrameScheduler";
import {
  createPanelMarqueeController,
  normalizeScreenRect,
  polygonIntersectsScreenRect,
  resolveMarqueeSelection,
  type MarqueePanelCandidate,
} from "../../src/components_v2/modules/panels/panelMarqueeSelection";
import { resolvePanelSelectionIds } from "../../src/components_v2/modules/panels/panelSelection";
import {
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
} from "../../src/lib/planning-core/advanced";
import type { PanelInstance } from "../../src/types/planner";

const square = (id: string, x: number, y: number, selectionIds = [id]): MarqueePanelCandidate => ({
  id,
  selectionIds,
  polygon: [
    { x, y },
    { x: x + 10, y },
    { x: x + 10, y: y + 10 },
    { x, y: y + 10 },
  ],
});

test("marquee bounds normalize every drag direction", () => {
  assert.deepEqual(normalizeScreenRect({ x: 30, y: 40 }, { x: 10, y: 5 }), {
    x: 10,
    y: 5,
    width: 20,
    height: 35,
  });
  assert.deepEqual(normalizeScreenRect({ x: 10, y: 40 }, { x: 30, y: 5 }), {
    x: 10,
    y: 5,
    width: 20,
    height: 35,
  });
});

test("selection uses meaningful polygon intersection, not full containment or AABB only", () => {
  const panelCandidate = square("a", 10, 10);
  const partial = { x: 18, y: 12, width: 5, height: 5 };
  assert.equal(polygonIntersectsScreenRect(panelCandidate.polygon, partial), true);

  const rotatedDiamond = [
    { x: 0, y: 5 },
    { x: 5, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 10 },
  ];
  assert.equal(
    polygonIntersectsScreenRect(rotatedDiamond, { x: 8.5, y: 0, width: 2, height: 2 }),
    false,
    "an AABB-only test would falsely select this empty rotated corner",
  );
  assert.equal(
    polygonIntersectsScreenRect(rotatedDiamond, { x: 8.5, y: 4, width: 2, height: 2 }),
    true,
  );
});

test("normal marquee replaces and Shift marquee adds within the snapshotted roof", () => {
  const candidates = [square("a", 0, 0), square("b", 20, 0), square("c", 40, 0), square("d", 60, 0)];
  const bounds = { x: 39, y: -1, width: 33, height: 12 };
  assert.deepEqual(resolveMarqueeSelection({ bounds, candidates, initialIds: ["a"], additive: false }).selectedIds, ["c", "d"]);
  assert.deepEqual(resolveMarqueeSelection({ bounds, candidates, initialIds: ["a", "b"], additive: true }).selectedIds, ["a", "b", "c", "d"]);

  const empty = { x: 100, y: 100, width: 10, height: 10 };
  assert.deepEqual(resolveMarqueeSelection({ bounds: empty, candidates, initialIds: ["a", "b"], additive: false }).selectedIds, []);
  assert.deepEqual(resolveMarqueeSelection({ bounds: empty, candidates, initialIds: ["a", "b"], additive: true }).selectedIds, ["a", "b"]);
});

test("D-Dome selection expands one intersected slot to its complete same-roof block", () => {
  const panel = (id: string, roofId: string, slotIndex: number): PanelInstance => ({
    id,
    roofId,
    cx: slotIndex * 10,
    cy: 0,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
    orientation: "landscape",
    panelId: "module",
    advanced: {
      layoutMode: "advanced",
      blockKey: "shared-block-key",
      slotIndex,
      systemId: K2_D_DOME_SYSTEM_ID,
      adapterVersion: K2_D_DOME_ADAPTER_VERSION,
      advancedEngineVersion: "advanced-block-v1",
      geometryEngineVersion: "geometry-v2",
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.65,
      moduleFaceAzimuthDeg: slotIndex ? 270 : 90,
    },
  });
  const panels = [panel("slot-0", "roof-a", 0), panel("slot-1", "roof-a", 1), panel("other-roof", "roof-b", 0)];
  assert.deepEqual(resolvePanelSelectionIds(panels, "slot-0"), ["slot-0", "slot-1"]);

  const candidates = [
    square("slot-0", 0, 0, resolvePanelSelectionIds(panels, "slot-0")),
    square("slot-1", 20, 0, resolvePanelSelectionIds(panels, "slot-1")),
  ];
  assert.deepEqual(resolveMarqueeSelection({
    bounds: { x: 1, y: 1, width: 2, height: 2 },
    candidates,
    initialIds: [],
    additive: false,
  }).selectedIds, ["slot-0", "slot-1"]);
});

test("600 raw moves cause zero selection writes before release and one coherent commit at end", () => {
  const animationFrames: FrameRequestCallback[] = [];
  const commits: string[][] = [];
  let visualFrames = 0;
  const controller = createPanelMarqueeController({
    onVisual: (visual) => { if (visual) visualFrames += 1; },
    onCommit: (ids) => commits.push(ids),
    onEmptyClick: () => commits.push([]),
    createScheduler: (run) => createLatestFrameScheduler(
      run,
      (callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      () => {},
    ),
  });
  controller.begin({ start: { x: 0, y: 0 }, additive: false, initialIds: [], candidates: [square("a", 10, 10)] });
  for (let index = 0; index < 600; index += 1) controller.move({ x: 20 + index, y: 20 });
  assert.equal(animationFrames.length, 1);
  assert.equal(commits.length, 0);
  controller.end({ x: 25, y: 25 });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], ["a"]);
  assert.equal(visualFrames, 1);
});

test("below-threshold click clears once while ESC cancellation restores without a write", () => {
  const commits: string[][] = [];
  const controller = createPanelMarqueeController({
    onVisual: () => {},
    onCommit: (ids) => commits.push(ids),
    onEmptyClick: () => commits.push([]),
    createScheduler: (run) => {
      let latest: { x: number; y: number } | undefined;
      return {
        schedule: (point) => { latest = point; },
        flush: () => { if (latest) run(latest); latest = undefined; },
        cancel: () => { latest = undefined; },
        hasPending: () => Boolean(latest),
      };
    },
  });
  controller.begin({ start: { x: 10, y: 10 }, additive: false, initialIds: ["a"], candidates: [square("a", 0, 0)] });
  controller.end({ x: 12, y: 12 });
  assert.deepEqual(commits, [[]]);

  controller.begin({ start: { x: 0, y: 0 }, additive: false, initialIds: ["a"], candidates: [square("a", 0, 0)] });
  controller.move({ x: 20, y: 20 });
  assert.equal(controller.cancel(), true);
  assert.deepEqual(commits, [[]], "cancel does not mutate canonical selection");
});

test("Canvas integration keeps marquee transient and excludes conflicting tools", () => {
  const canvas = readFileSync(new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url), "utf8");
  const panels = readFileSync(new URL("../../src/components_v2/modules/PanelsKonva.tsx", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../../src/components_v2/modules/panels/PanelMarqueeOverlay.tsx", import.meta.url), "utf8");
  assert.ok(canvas.includes('step === "modules"'));
  assert.ok(canvas.includes('tool === "select"'));
  assert.ok(canvas.includes("!manualPlacementSession"));
  assert.ok(canvas.includes("!selectedPlanningDraft"));
  assert.ok(canvas.includes("event.button !== 0"));
  assert.ok(canvas.includes("createPanelMarqueeController"));
  assert.ok(canvas.includes("setSelectedPanels(ids)"));
  assert.ok(canvas.includes("!marqueeEnabled"), "left-stage pan is disabled only while marquee owns empty drag");
  assert.ok(overlay.includes("pointer-events-none"));
  assert.ok(panels.includes("selectedSet.has(panelId) && selectedPanels.length > 1"));
});
