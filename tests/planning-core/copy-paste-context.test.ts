import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { PanelInstance } from "../../src/types/planner";
import {
  clearPlannerObjectClipboard,
  copyPanelsToPlannerClipboard,
  copyRoofToPlannerClipboard,
  markPanelClipboardPaste,
  readPlannerObjectClipboard,
} from "../../src/components_v2/canvas/plannerObjectClipboard";
import { resolveDirectLayoutTargets } from "../../src/components_v2/modules/panels/directLayoutGeometry";
import {
  createPanelPasteGroup,
  offsetPanelPasteGroup,
  panelPasteOffsetCandidates,
} from "../../src/components_v2/modules/panels/panelClipboardGeometry";

function panel(id: string, cx: number, cy: number): PanelInstance {
  return {
    id,
    roofId: "roof-a",
    cx,
    cy,
    wPx: 10,
    hPx: 20,
    angleDeg: 37,
    orientation: "portrait",
    panelId: "module-a",
  };
}

test("planner clipboard is explicitly typed and a new copy resets the paste cascade", () => {
  clearPlannerObjectClipboard();
  copyRoofToPlannerClipboard("roof-a");
  assert.deepEqual(readPlannerObjectClipboard(), { type: "roof", sourceRoofId: "roof-a" });

  const source = panel("p-1", 12.5, 20.25);
  copyPanelsToPlannerClipboard({ sourceRoofId: "roof-a", panels: [source] });
  source.cx = 999;
  const copied = readPlannerObjectClipboard();
  assert.equal(copied?.type, "panels");
  if (copied?.type !== "panels") return;
  assert.equal(copied.panels[0].cx, 12.5, "copy snapshots current geometry instead of retaining a live reference");
  assert.equal(copied.pasteCount, 0);
  markPanelClipboardPaste();
  const afterPaste = readPlannerObjectClipboard();
  assert.equal(afterPaste?.type === "panels" ? afterPaste.pasteCount : undefined, 1);
});

test("panel paste preserves rigid geometry, creates fresh identities and cascades in metres", () => {
  let panelIndex = 0;
  let blockIndex = 0;
  const source = [panel("a", 10, 20), panel("b", 40, 55)];
  const cloned = createPanelPasteGroup({
    source,
    roofId: "roof-a",
    createPanelId: () => `new-panel-${panelIndex++}`,
    createBlockKey: () => `new-block-${blockIndex++}`,
    layoutRunId: "copy-run",
  });
  assert.deepEqual(cloned.map((item) => item.id), ["new-panel-0", "new-panel-1"]);
  assert.deepEqual(
    { dx: cloned[1].cx - cloned[0].cx, dy: cloned[1].cy - cloned[0].cy, angle: cloned[1].angleDeg },
    { dx: 30, dy: 35, angle: 37 },
  );

  assert.deepEqual(panelPasteOffsetCandidates(0)[0], { xM: 0.2, yM: 0.2 });
  assert.deepEqual(panelPasteOffsetCandidates(1)[0], { xM: 0.4, yM: 0.4 });
  const offset = offsetPanelPasteGroup({ panels: cloned, offset: { xM: 0.2, yM: 0.2 }, mppImage: 0.1 });
  assert.deepEqual(offset.map(({ cx, cy }) => ({ cx, cy })), [{ cx: 12, cy: 22 }, { cx: 42, cy: 57 }]);
});

test("copying one D-Dome slot normalizes and pastes a complete fresh atomic block", () => {
  const pair = [0, 1].map((slotIndex) => ({
    ...panel(`slot-${slotIndex}`, 100 + slotIndex * 12, 80),
    advanced: {
      layoutMode: "advanced",
      advancedEngineVersion: "advanced-block-v1",
      geometryEngineVersion: "geometry-v2",
      systemId: "k2-d-dome-6.10-classic",
      adapterVersion: "07-481-08@2023-05-05",
      blockKey: "old-block",
      montageFieldKey: "old-field",
      thermalFieldKey: "old-thermal",
      slotIndex,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.648,
      moduleFaceAzimuthDeg: slotIndex === 0 ? 90 : 270,
      layoutRunId: "old-run",
    },
  })) as PanelInstance[];
  const normalized = resolveDirectLayoutTargets({
    panels: pair,
    selectedPanelIds: [pair[0].id],
    roofId: "roof-a",
  });
  assert.equal(normalized.length, 2);

  let id = 0;
  const pasted = createPanelPasteGroup({
    source: normalized,
    roofId: "roof-a",
    createPanelId: () => `new-${id++}`,
    createBlockKey: () => "fresh-block",
    layoutRunId: "fresh-run",
  });
  assert.equal(new Set(pasted.map((item) => item.id)).size, 2);
  assert.deepEqual(pasted.map((item) => item.advanced?.slotIndex), [0, 1]);
  assert.deepEqual(new Set(pasted.map((item) => item.advanced?.blockKey)), new Set(["fresh-block"]));
  assert.deepEqual(pasted.map((item) => item.advanced?.moduleFaceAzimuthDeg), [90, 270]);
  assert.ok(pasted.every((item) => item.advanced?.montageFieldKey === undefined));
  assert.ok(pasted.every((item) => item.advanced?.thermalFieldKey === undefined));
});

test("hotkey ownership is mutually exclusive and module paste is one validated batch", () => {
  const panelHotkeys = readFileSync("src/components_v2/modules/panels/PanelHotkeys.tsx", "utf8");
  const roofHotkeys = readFileSync("src/components_v2/RoofHotkeys.tsx", "utf8");
  const canvasStage = readFileSync("src/components_v2/canvas/CanvasStage.tsx", "utf8");
  assert.match(panelHotkeys, /step && step !== 'modules'/);
  assert.match(roofHotkeys, /step !== "building"/);
  assert.match(panelHotkeys, /state\.selectedPanelIds\.length === 0\) return/);
  assert.match(panelHotkeys, /clipboard\?\.type !== 'panels'/);
  assert.match(roofHotkeys, /clipboard\?\.type !== "roof"/);
  assert.match(panelHotkeys, /closest\("input, textarea, select, \[contenteditable='true'\]"\)/);
  assert.match(panelHotkeys, /validateExistingPanelPlacement/);
  assert.equal((panelHotkeys.match(/appendPanelsToRoof\(/g) ?? []).length, 1);
  assert.match(panelHotkeys, /selectAdded: true/);
  assert.doesNotMatch(canvasStage, /CanvasHotkeys/);
  assert.equal(existsSync("src/components_v2/canvas/CanvasHotekeys.tsx"), false);
});
