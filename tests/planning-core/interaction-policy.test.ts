import assert from "node:assert/strict";
import test from "node:test";

import type { Tool } from "../../src/types/planner";
import {
  findRoofAtPoint,
  isDrawingInteractionTool,
  isPrimaryPointerButton,
  resolveDraftRoofTarget,
  resolveEscapeAction,
  resolveInteractionCursor,
  resolvePlannerInteractionMode,
  resolvePointerIntent,
  shouldCancelDraftOnToolChange,
  shouldIgnorePlannerHotkeyTarget,
} from "../../src/components_v2/canvas/interactionPolicy";

const roofs = [
  {
    id: "roof-a",
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
  },
  {
    id: "roof-b",
    points: [
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 60, y: 40 },
    ],
  },
];

test("right mouse has priority over drawing and restores the drawing mode", () => {
  assert.equal(
    resolvePointerIntent({ button: 2, tool: "draw-reserved" }),
    "pan",
  );
  assert.equal(
    resolvePlannerInteractionMode({
      tool: "draw-reserved",
      isRightPanning: true,
    }),
    "panning",
  );
  assert.equal(
    resolveInteractionCursor({ mode: "panning", canPan: true }),
    "grabbing",
  );

  assert.equal(
    resolvePlannerInteractionMode({
      tool: "draw-reserved",
      isRightPanning: false,
    }),
    "drawing-reserved-zone",
  );
  assert.equal(
    resolvePointerIntent({ button: 0, tool: "draw-reserved" }),
    "draw",
  );
  assert.equal(isPrimaryPointerButton(2), false);
  assert.equal(isPrimaryPointerButton(0), true);
});

test("all drawing tools capture left-pointer intent from selectable objects", () => {
  const drawingTools: Tool[] = [
    "draw-roof",
    "draw-rect",
    "draw-reserved",
    "draw-snow-guard",
    "fill-area",
  ];

  for (const tool of drawingTools) {
    assert.equal(isDrawingInteractionTool(tool), true, tool);
    assert.equal(resolvePointerIntent({ button: 0, tool }), "draw", tool);
  }
  assert.equal(isDrawingInteractionTool("select"), false);
  assert.equal(
    resolvePointerIntent({ button: 0, tool: "select" }),
    "edit-or-select",
  );
});

for (const draft of [
  "roof",
  "rectangle",
  "reserved",
  "snow guard",
  "fill area",
]) {
  test(`ESC clears the ${draft} draft before any selection`, () => {
    assert.equal(
      resolveEscapeAction({
        hasDraft: true,
        selectedPanelCount: 2,
        hasSelectedZone: true,
        hasSelectedSnowGuard: true,
        hasSelectedRoof: true,
      }),
      "cancel-draft",
    );
  });
}

test("ESC deselection has one deterministic priority", () => {
  const base = {
    hasDraft: false,
    selectedPanelCount: 0,
    hasSelectedZone: false,
    hasSelectedSnowGuard: false,
    hasSelectedRoof: false,
  };

  assert.equal(
    resolveEscapeAction({
      ...base,
      selectedPanelCount: 1,
      hasSelectedZone: true,
      hasSelectedRoof: true,
    }),
    "clear-panels",
  );
  assert.equal(
    resolveEscapeAction({
      ...base,
      hasSelectedZone: true,
      hasSelectedSnowGuard: true,
      hasSelectedRoof: true,
    }),
    "clear-zone",
  );
  assert.equal(
    resolveEscapeAction({
      ...base,
      hasSelectedSnowGuard: true,
      hasSelectedRoof: true,
    }),
    "clear-snow-guard",
  );
  assert.equal(
    resolveEscapeAction({ ...base, hasSelectedRoof: true }),
    "clear-roof",
  );
});

test("ESC is ignored for form controls and editable content", () => {
  const selectTarget = {
    tagName: "SELECT",
    isContentEditable: false,
    closest: () => null,
  } as unknown as EventTarget;
  const editableTarget = {
    tagName: "DIV",
    isContentEditable: true,
    closest: () => null,
  } as unknown as EventTarget;

  assert.equal(shouldIgnorePlannerHotkeyTarget(selectTarget), true);
  assert.equal(shouldIgnorePlannerHotkeyTarget(editableTarget), true);
  assert.equal(
    resolveEscapeAction({
      ignoredTarget: true,
      hasDraft: true,
      selectedPanelCount: 1,
      hasSelectedZone: true,
      hasSelectedSnowGuard: true,
      hasSelectedRoof: true,
    }),
    "none",
  );
});

test("changing away from a drawing tool cancels its old draft", () => {
  assert.equal(
    shouldCancelDraftOnToolChange("draw-reserved", "draw-roof"),
    true,
  );
  assert.equal(shouldCancelDraftOnToolChange("draw-roof", "select"), true);
  assert.equal(shouldCancelDraftOnToolChange("select", "draw-roof"), false);
  assert.equal(
    shouldCancelDraftOnToolChange("draw-reserved", "draw-reserved"),
    false,
  );
});

test("reserved-zone first point fixes Roof B even while Roof A is selected", () => {
  const selectedRoofId = "roof-a";
  const firstPoint = resolveDraftRoofTarget({
    point: { x: 80, y: 20 },
    roofs,
  });

  assert.equal(selectedRoofId, "roof-a");
  assert.deepEqual(firstPoint, { accepted: true, targetRoofId: "roof-b" });

  const nextPointInRoofB = resolveDraftRoofTarget({
    point: { x: 90, y: 30 },
    roofs,
    targetRoofId: firstPoint.targetRoofId,
  });
  assert.deepEqual(nextPointInRoofB, {
    accepted: true,
    targetRoofId: "roof-b",
  });

  const pointInRoofA = resolveDraftRoofTarget({
    point: { x: 20, y: 20 },
    roofs,
    targetRoofId: firstPoint.targetRoofId,
  });
  assert.deepEqual(pointInRoofA, {
    accepted: false,
    targetRoofId: "roof-b",
  });

  const committedZone = { roofId: nextPointInRoofB.targetRoofId };
  assert.equal(committedZone.roofId, "roof-b");
});

test("a first reserved-zone point outside all roofs does not start a draft", () => {
  assert.equal(findRoofAtPoint({ x: 50, y: 20 }, roofs), undefined);
  assert.deepEqual(
    resolveDraftRoofTarget({ point: { x: 50, y: 20 }, roofs }),
    { accepted: false, targetRoofId: undefined },
  );
});
