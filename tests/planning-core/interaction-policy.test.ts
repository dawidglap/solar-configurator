import assert from "node:assert/strict";
import test from "node:test";

import type { Tool } from "../../src/types/planner";
import {
  createRoofSwitchGestureLatch,
  findRoofAtPoint,
  isDrawingInteractionTool,
  isPrimaryPointerButton,
  resolveDraftRoofTarget,
  resolveEscapeAction,
  resolveInteractionCursor,
  resolvePlannerInteractionMode,
  resolvePointerIntent,
  resolveRoofLocalPointerAction,
  shouldCancelDraftOnToolChange,
  shouldIgnorePlannerHotkeyTarget,
} from "../../src/components_v2/canvas/interactionPolicy";
import { resolvePanelSelectionIds } from "../../src/components_v2/modules/panels/panelSelection";
import {
  ADVANCED_BLOCK_ENGINE_VERSION,
  K2_D_DOME_ADAPTER_VERSION,
  K2_D_DOME_SYSTEM_ID,
} from "../../src/lib/planning-core/advanced";
import { GEOMETRY_V2_ENGINE_VERSION } from "../../src/lib/planning-core/geometry-v2";
import type { PanelInstance, RoofArea } from "../../src/types/planner";

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
    "draw-reserved-rect",
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

test("roof-local child routing is roof-first only for primary select gestures", () => {
  assert.equal(resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: "d2",
    button: 0,
    tool: "select",
  }), "switch-roof");
  assert.equal(resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: "d3",
    button: 0,
    tool: "select",
  }), "interact-child");
  assert.equal(resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: "d2",
    button: 2,
    tool: "select",
  }), "ignore-non-primary");
  assert.equal(resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: "d2",
    button: 0,
    tool: "draw-reserved",
  }), "preserve-explicit-tool");
});

test("one roof-switch pointerdown consumes exactly its own click/tap follow-up", () => {
  const latch = createRoofSwitchGestureLatch();
  latch.markRoofSwitch();
  assert.equal(latch.consumeFollowup(), true);
  assert.equal(latch.consumeFollowup(), false);
  latch.markRoofSwitch();
  latch.reset();
  assert.equal(latch.consumeFollowup(), false);
});

test("D2 to D3 first selects only D3; the second click selects the complete D-Dome block", async () => {
  const { usePlannerV2Store } = await import("../../src/components_v2/state/plannerV2Store");
  const roof = (id: string): RoofArea => ({
    id,
    name: id,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  });
  const panel = (id: string, roofId: string, slotIndex = 0): PanelInstance => ({
    id,
    roofId,
    panelId: "module-a",
    cx: slotIndex,
    cy: 0,
    wPx: 1,
    hPx: 2,
    angleDeg: 0,
    orientation: "landscape",
    ...(roofId === "d3" ? {
      advanced: {
        systemId: K2_D_DOME_SYSTEM_ID,
        adapterVersion: K2_D_DOME_ADAPTER_VERSION,
        layoutMode: "advanced" as const,
        advancedEngineVersion: ADVANCED_BLOCK_ENGINE_VERSION,
        geometryEngineVersion: GEOMETRY_V2_ENGINE_VERSION,
        blockKey: "d3-block-1",
        slotIndex,
        nominalTiltDeg: 10,
        effectiveTiltDeg: 10,
        moduleFaceAzimuthDeg: slotIndex === 0 ? 90 : 270,
      },
    } : {}),
  });
  const d2Panel = panel("d2-panel", "d2");
  const d3Panels = [panel("d3-slot-0", "d3", 0), panel("d3-slot-1", "d3", 1)];
  const zone = {
    id: "d3-zone",
    roofId: "d3",
    type: "riservata" as const,
    points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
  };
  usePlannerV2Store.setState({
    layers: [roof("d2"), roof("d3")],
    selectedId: "d2",
    panels: [d2Panel, ...d3Panels],
    selectedPanelIds: [d2Panel.id],
    zones: [zone],
    selectedZoneId: undefined,
    snowGuards: [],
    selectedSnowGuardId: undefined,
    tool: "select",
  });

  const before = d3Panels.map(({ cx, cy }) => ({ cx, cy }));
  const firstAction = resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: usePlannerV2Store.getState().selectedId,
    button: 0,
    tool: "select",
  });
  assert.equal(firstAction, "switch-roof");
  usePlannerV2Store.getState().select("d3");
  assert.equal(usePlannerV2Store.getState().selectedId, "d3");
  assert.deepEqual(usePlannerV2Store.getState().selectedPanelIds, []);
  assert.deepEqual(d3Panels.map(({ cx, cy }) => ({ cx, cy })), before);

  const secondAction = resolveRoofLocalPointerAction({
    ownerRoofId: "d3",
    selectedRoofId: usePlannerV2Store.getState().selectedId,
    button: 0,
    tool: "select",
  });
  assert.equal(secondAction, "interact-child");
  usePlannerV2Store.getState().setSelectedPanels(
    resolvePanelSelectionIds(usePlannerV2Store.getState().panels, d3Panels[0].id),
  );
  assert.deepEqual(usePlannerV2Store.getState().selectedPanelIds, d3Panels.map((item) => item.id));

  // Store-level invariants reject every cross-roof child selection route.
  usePlannerV2Store.getState().setSelectedPanels([d2Panel.id]);
  assert.deepEqual(usePlannerV2Store.getState().selectedPanelIds, []);
  usePlannerV2Store.getState().selectZone(zone.id);
  assert.equal(usePlannerV2Store.getState().selectedZoneId, zone.id);
  usePlannerV2Store.getState().select("d2");
  assert.equal(usePlannerV2Store.getState().selectedZoneId, undefined);
  usePlannerV2Store.getState().selectZone(zone.id);
  assert.equal(usePlannerV2Store.getState().selectedZoneId, undefined);

  usePlannerV2Store.getState().resetPlanner();
});

for (const draft of [
  "roof",
  "rectangle",
  "reserved",
  "reserved rectangle",
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
  assert.equal(shouldCancelDraftOnToolChange("draw-reserved-rect", "select"), true);
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
