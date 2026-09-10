import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectAdditiveFillPanels } from "../../src/components_v2/modules/fill/additiveFill";
import type { PanelInstance, Pt } from "../../src/types/planner";

const AREA: Pt[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function panel(id: string, cx: number, cy: number, advanced?: { blockKey: string; slotIndex: number }): PanelInstance {
  return {
    id,
    roofId: "roof-a",
    cx,
    cy,
    wPx: 10,
    hPx: 10,
    angleDeg: 0,
    orientation: "portrait",
    panelId: "panel-1",
    ...(advanced ? {
      advanced: {
        layoutMode: "advanced",
        advancedEngineVersion: "advanced-block-v1",
        geometryEngineVersion: "geometry-v2",
        systemId: "k2-d-dome-6.10-classic",
        adapterVersion: "07-481-08@2023-05-05",
        blockKey: advanced.blockKey,
        slotIndex: advanced.slotIndex,
        nominalTiltDeg: 10,
        effectiveTiltDeg: 8.648,
        moduleFaceAzimuthDeg: advanced.slotIndex === 0 ? 90 : 270,
      },
    } : {}),
  };
}

test("F preserves manual geometry and appends only free candidates", () => {
  const existing = [panel("moved-manual", 20, 20)];
  const before = structuredClone(existing);
  const candidates = [panel("occupied-candidate", 20, 20), panel("free-candidate", 50, 50)];

  const added = selectAdditiveFillPanels({
    roofId: "roof-a",
    areaPolygon: AREA,
    candidates,
    existingPanels: existing,
  });

  assert.deepEqual(existing, before);
  assert.deepEqual(added.map((item) => item.id), ["free-candidate"]);
  assert.deepEqual([...existing, ...added].slice(0, existing.length), before);
});

test("F can refill a deleted hole while treating remaining panels as occupancy", () => {
  const full = [panel("left", 20, 20), panel("hole", 50, 20), panel("right", 80, 20)];
  const remaining = full.filter((item) => item.id !== "hole");
  const regeneratedCandidates = [panel("left-new", 20, 20), panel("hole-new", 50, 20), panel("right-new", 80, 20)];

  const added = selectAdditiveFillPanels({
    roofId: "roof-a",
    areaPolygon: AREA,
    candidates: regeneratedCandidates,
    existingPanels: remaining,
  });

  assert.deepEqual(added.map((item) => item.id), ["hole-new"]);
});

test("F rejects a candidate that overlaps the current position of a moved panel", () => {
  const added = selectAdditiveFillPanels({
    roofId: "roof-a",
    areaPolygon: AREA,
    candidates: [panel("candidate", 63, 50)],
    existingPanels: [panel("manually-moved", 60, 50)],
  });
  assert.deepEqual(added, []);
});

test("D-Dome F accepts or rejects complete two-panel blocks only", () => {
  const candidates = [
    panel("b1-0", 20, 20, { blockKey: "block-1", slotIndex: 0 }),
    panel("b1-1", 31, 20, { blockKey: "block-1", slotIndex: 1 }),
    panel("b2-0", 70, 20, { blockKey: "block-2", slotIndex: 0 }),
    panel("b2-1", 81, 20, { blockKey: "block-2", slotIndex: 1 }),
  ];
  const added = selectAdditiveFillPanels({
    roofId: "roof-a",
    areaPolygon: AREA,
    candidates,
    existingPanels: [panel("collision", 70, 20)],
  });

  assert.deepEqual(added.map((item) => item.id), ["b1-0", "b1-1"]);
  assert.deepEqual(added.map((item) => item.advanced?.slotIndex), [0, 1]);
});

test("toolbar keeps F additive and U behind the SOLA regeneration dialog", () => {
  const toolbar = readFileSync(new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../../src/components_v2/panels/LayoutRegenerationDialog.tsx", import.meta.url), "utf8");

  assert.ok(toolbar.includes('setTool(tool === "fill-area" ? "select" : "fill-area")'));
  assert.ok(toolbar.includes("<LayoutRegenerationDialog"));
  assert.equal(toolbar.includes("window.confirm"), false);
  assert.equal(toolbar.includes("window.alert"), false);
  assert.ok(dialog.includes("Das bestehende Modullayout wird ersetzt. Manuelle Änderungen gehen dabei verloren."));
  assert.ok(dialog.includes("Layout neu erstellen"));
  assert.ok(dialog.includes("Abbrechen"));
});

