import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { PanelInstance } from "../../src/types/planner";
import {
  clearPlannerObjectClipboard,
  copyObstacleToPlannerClipboard,
  copyPanelsToPlannerClipboard,
  copyRoofToPlannerClipboard,
  markObstacleClipboardPaste,
  markPanelClipboardPaste,
  readPlannerObjectClipboard,
  resolvePlannerClipboardTarget,
} from "../../src/components_v2/canvas/plannerObjectClipboard";
import { createContainedObstaclePaste } from "../../src/components_v2/zones/zoneClipboardGeometry";
import type { Zone } from "../../src/components_v2/state/slices/zonesSlice";
import { resolveDirectLayoutTargets } from "../../src/components_v2/modules/panels/directLayoutGeometry";
import {
  createPanelPasteGroup,
  findNearestValidPanelPaste,
  offsetPanelPasteGroup,
  panelPasteOffsetCandidates,
  resolvePanelPasteLattice,
} from "../../src/components_v2/modules/panels/panelClipboardGeometry";
import { createPanelPastePlacementValidator } from "../../src/components_v2/modules/manualPlacement";
import type { RoofArea } from "../../src/types/planner";

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

const SEARCH_ROOF: RoofArea = {
  id: "roof-a",
  name: "D1",
  roofKind: "pitched",
  points: [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 100 },
    { x: 0, y: 100 },
  ],
};

function gridPanel(id: string, cx: number, cy: number, angleDeg = 0): PanelInstance {
  return {
    ...panel(id, cx, cy),
    wPx: 8,
    hPx: 18,
    angleDeg,
  };
}

function searchPaste(input: {
  copied: PanelInstance[];
  occupied: PanelInstance[];
  roof?: RoofArea;
  spacingM?: number;
  advancedPitchM?: { x: number; y: number };
  marginM?: number;
  zones?: Array<{ roofId: string; points: Array<{ x: number; y: number }> }>;
}) {
  const roof = input.roof ?? SEARCH_ROOF;
  const mppImage = 0.1;
  const lattice = resolvePanelPasteLattice({
    panels: input.copied,
    mppImage,
    spacingXM: input.spacingM ?? 0.2,
    spacingYM: input.spacingM ?? 0.2,
    advancedPitchM: input.advancedPitchM,
  });
  assert.ok(lattice);
  return findNearestValidPanelPaste({
    panels: input.copied,
    roofPointsPx: roof.points,
    mppImage,
    preferredOffset: { xM: 0.2, yM: 0.2 },
    lattice,
    isValid: createPanelPastePlacementValidator({
      roof,
      marginM: input.marginM ?? 0,
      mppImage,
      zones: input.zones ?? [],
      snowGuards: [],
      panels: input.occupied,
    }),
  });
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

test("Gebäude clipboard routing gives an active Hindernis priority over its parent roof", () => {
  assert.equal(resolvePlannerClipboardTarget({
    step: "building",
    tool: "select",
    selectedRoofId: "roof-a",
    selectedZoneId: "zone-a",
    selectedPanelCount: 0,
  }), "obstacle");
  assert.equal(resolvePlannerClipboardTarget({
    step: "building",
    tool: "select",
    selectedRoofId: "roof-a",
    selectedPanelCount: 0,
  }), "roof");
  assert.equal(resolvePlannerClipboardTarget({
    step: "building",
    tool: "select",
    selectedRoofId: "roof-a",
    selectedPanelCount: 2,
  }), "roof", "stale module selections are not active clipboard targets in Gebäudeplanung");
  assert.equal(resolvePlannerClipboardTarget({
    step: "building",
    tool: "draw-reserved",
    selectedRoofId: "roof-a",
    selectedPanelCount: 0,
  }), "none");
});

test("Modulplanung owns panel clipboard and never falls back to the active roof", () => {
  assert.equal(resolvePlannerClipboardTarget({
    step: "modules",
    tool: "select",
    selectedRoofId: "roof-a",
    selectedPanelCount: 1,
  }), "panels");
  assert.equal(resolvePlannerClipboardTarget({
    step: "modules",
    tool: "select",
    selectedRoofId: "roof-a",
    selectedPanelCount: 0,
  }), "none");
});

test("obstacle clipboard snapshots geometry and keeps its type after selection context changes", () => {
  clearPlannerObjectClipboard();
  const source: Zone = {
    id: "zone-a",
    roofId: "roof-a",
    type: "riservata",
    shapeKind: "rectangle",
    edgeReference: { edgeIndex: 2 },
    points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }],
  };
  copyObstacleToPlannerClipboard(source);
  source.points[0].x = 999;
  const copied = readPlannerObjectClipboard();
  assert.equal(copied?.type, "obstacle");
  if (copied?.type !== "obstacle") return;
  assert.equal(copied.obstacle.points[0].x, 10);
  assert.equal(copied.sourceRoofId, "roof-a");
  assert.equal(copied.pasteCount, 0);
  markObstacleClipboardPaste();
  const afterPaste = readPlannerObjectClipboard();
  assert.equal(afterPaste?.type === "obstacle" ? afterPaste.pasteCount : undefined, 1);
});

test("reported bug duplicates the Hindernis with a fresh ID while roof count stays unchanged", () => {
  const roofs = [SEARCH_ROOF];
  const source: Zone = {
    id: "zone-a",
    roofId: SEARCH_ROOF.id,
    type: "riservata",
    shapeKind: "rectangle",
    points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }],
  };
  const zones = [source];
  const pasted = createContainedObstaclePaste({
    source,
    ownerRoofPoints: SEARCH_ROOF.points,
    mppImage: 0.1,
    pasteCount: 0,
    createId: () => "zone-b",
  });
  assert.ok(pasted);
  zones.push(pasted);
  assert.equal(roofs.length, 1, "roof count is unchanged");
  assert.equal(zones.length, 2, "one obstacle is added");
  assert.equal(pasted.id, "zone-b");
  assert.equal(pasted.roofId, source.roofId);
  assert.notDeepEqual(pasted.points, source.points);
});

test("obstacle paste near a roof edge finds another contained physical offset or fails cleanly", () => {
  const source: Zone = {
    id: "edge-zone",
    roofId: SEARCH_ROOF.id,
    type: "riservata",
    points: [{ x: 98, y: 78 }, { x: 118, y: 78 }, { x: 118, y: 98 }, { x: 98, y: 98 }],
  };
  const pasted = createContainedObstaclePaste({
    source,
    ownerRoofPoints: SEARCH_ROOF.points,
    mppImage: 0.1,
    pasteCount: 0,
    createId: () => "edge-zone-copy",
  });
  assert.ok(pasted, "an inward alternative is found when down/right would leave the roof");
  assert.ok(pasted.points.every((point) => point.x >= 0 && point.x <= 120 && point.y >= 0 && point.y <= 100));

  const roofSized: Zone = {
    ...source,
    id: "roof-sized",
    points: SEARCH_ROOF.points.map((point) => ({ ...point })),
  };
  assert.equal(createContainedObstaclePaste({
    source: roofSized,
    ownerRoofPoints: SEARCH_ROOF.points,
    mppImage: 0.1,
    pasteCount: 0,
    createId: () => "impossible",
  }), undefined, "failure produces no invalid geometry and cannot fall through to roof paste");
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
  assert.match(roofHotkeys, /clipboard\.type === "obstacle"/);
  assert.match(roofHotkeys, /clipboard\.type !== "roof"/);
  assert.match(roofHotkeys, /resolvePlannerClipboardTarget/);
  assert.match(roofHotkeys, /plannerHistory\.push\("paste obstacle"\)/);
  assert.match(panelHotkeys, /closest\("input, textarea, select, \[contenteditable='true'\]"\)/);
  assert.match(panelHotkeys, /createPanelPastePlacementValidator/);
  assert.match(panelHotkeys, /findNearestValidPanelPaste/);
  assert.equal((panelHotkeys.match(/appendPanelsToRoof\(/g) ?? []).length, 1);
  assert.match(panelHotkeys, /selectAdded: true/);
  assert.doesNotMatch(canvasStage, /CanvasHotkeys/);
  assert.equal(existsSync("src/components_v2/canvas/CanvasHotekeys.tsx"), false);
});

test("a deleted Standard grid cell is found beyond the invalid preferred offset", () => {
  const occupied = [
    gridPanel("a", 20, 20),
    gridPanel("b", 30, 20),
    // C at 40/20 was deleted from the current committed array.
    gridPanel("d", 50, 20),
    gridPanel("e", 20, 40),
    gridPanel("f", 30, 40),
    gridPanel("h", 50, 40),
  ];
  const copied = createPanelPasteGroup({
    source: [occupied[1]],
    roofId: SEARCH_ROOF.id,
    createPanelId: () => "copy-b",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({ copied, occupied });
  assert.ok(pasted);
  assert.deepEqual({ cx: pasted[0].cx, cy: pasted[0].cy }, { cx: 40, cy: 20 });
});

test("immediate bulk delete changes paste occupancy without reload or cache invalidation", () => {
  const beforeDelete = [gridPanel("a", 20, 20), gridPanel("b", 30, 20), gridPanel("c", 40, 20)];
  const afterDelete = beforeDelete.filter((item) => item.id !== "c");
  const copied = createPanelPasteGroup({
    source: [beforeDelete[1]],
    roofId: SEARCH_ROOF.id,
    createPanelId: () => "copy-immediate",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({ copied, occupied: afterDelete });
  assert.ok(pasted);
  assert.deepEqual({ cx: pasted[0].cx, cy: pasted[0].cy }, { cx: 40, cy: 20 });
});

test("search skips a deleted-looking cell blocked by Randabstand and finds another slot", () => {
  const roof: RoofArea = {
    ...SEARCH_ROOF,
    points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }],
  };
  const source = gridPanel("source", 30, 30);
  const copied = createPanelPasteGroup({
    source: [source],
    roofId: roof.id,
    createPanelId: () => "margin-copy",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({ copied, occupied: [source], roof, marginM: 0.5 });
  assert.ok(pasted);
  assert.ok(pasted[0].cx >= 9 && pasted[0].cx <= 51);
  assert.ok(pasted[0].cy >= 14 && pasted[0].cy <= 46);
});

test("search rejects an obstacle-covered hole and continues to a valid grid cell", () => {
  const source = gridPanel("source", 30, 20);
  const copied = createPanelPasteGroup({
    source: [source],
    roofId: SEARCH_ROOF.id,
    createPanelId: () => "obstacle-copy",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({
    copied,
    occupied: [source],
    zones: [{
      roofId: SEARCH_ROOF.id,
      points: [{ x: 36, y: 11 }, { x: 44, y: 11 }, { x: 44, y: 29 }, { x: 36, y: 29 }],
    }],
  });
  assert.ok(pasted);
  assert.notDeepEqual({ cx: pasted[0].cx, cy: pasted[0].cy }, { cx: 40, cy: 20 });
});

test("deleting a D-Dome block makes its complete atomic slot available to paste", () => {
  const advanced = (id: string, cx: number, slotIndex: number, blockKey: string): PanelInstance => ({
    ...gridPanel(id, cx, 30),
    wPx: 12,
    hPx: 18,
    advanced: {
      layoutMode: "advanced",
      advancedEngineVersion: "advanced-block-v1",
      geometryEngineVersion: "geometry-v2",
      systemId: "k2-d-dome-6.10-classic",
      adapterVersion: "07-481-08@2023-05-05",
      blockKey,
      slotIndex,
      nominalTiltDeg: 10,
      effectiveTiltDeg: 8.648,
      moduleFaceAzimuthDeg: slotIndex === 0 ? 90 : 270,
    },
  });
  const source = [advanced("source-0", 30, 0, "source"), advanced("source-1", 44, 1, "source")];
  const deleted = [advanced("deleted-0", 60, 0, "deleted"), advanced("deleted-1", 74, 1, "deleted")];
  const far = [advanced("far-0", 90, 0, "far"), advanced("far-1", 104, 1, "far")];
  const beforeDelete = [...source, ...deleted, ...far];
  const occupied = beforeDelete.filter((panel) => panel.advanced?.blockKey !== "deleted");
  const copied = createPanelPasteGroup({
    source,
    roofId: SEARCH_ROOF.id,
    createPanelId: (() => { let id = 0; return () => `copy-${id++}`; })(),
    createBlockKey: () => "fresh-block",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({
    copied,
    occupied,
    spacingM: 0,
    advancedPitchM: { x: 3, y: 3 },
  });
  assert.ok(pasted);
  assert.equal(pasted.length, 2);
  assert.deepEqual(pasted.map((item) => item.advanced?.slotIndex), [0, 1]);
  assert.deepEqual(new Set(pasted.map((item) => item.advanced?.blockKey)), new Set(["fresh-block"]));
  assert.equal(pasted[1].cx - pasted[0].cx, source[1].cx - source[0].cx);
  assert.deepEqual(pasted.map(({ cx, cy }) => ({ cx, cy })), deleted.map(({ cx, cy }) => ({ cx, cy })));
});

test("repeated paste treats the previous result as occupied and finds the next slot", () => {
  const source = gridPanel("source", 20, 20);
  const firstCopy = createPanelPasteGroup({
    source: [source],
    roofId: SEARCH_ROOF.id,
    createPanelId: () => "copy-1",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run-1",
  });
  const firstPaste = searchPaste({ copied: firstCopy, occupied: [source] });
  assert.ok(firstPaste);
  const secondCopy = createPanelPasteGroup({
    source: [source],
    roofId: SEARCH_ROOF.id,
    createPanelId: () => "copy-2",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run-2",
  });
  const secondPaste = searchPaste({ copied: secondCopy, occupied: [source, ...firstPaste] });
  assert.ok(secondPaste);
  assert.notDeepEqual(
    { cx: secondPaste[0].cx, cy: secondPaste[0].cy },
    { cx: firstPaste[0].cx, cy: firstPaste[0].cy },
  );
});

test("rotated paste keeps actual +17 degree geometry and follows its physical lattice", () => {
  const roof = { ...SEARCH_ROOF, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }] };
  const source = gridPanel("source", 150, 150, 17);
  const copied = createPanelPasteGroup({
    source: [source],
    roofId: roof.id,
    createPanelId: () => "rotated-copy",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({ copied, occupied: [source], roof });
  assert.ok(pasted);
  assert.equal(pasted[0].angleDeg, 17);
  const distanceM = Math.hypot(pasted[0].cx - source.cx, pasted[0].cy - source.cy) * 0.1;
  assert.ok(Math.abs(distanceM - 1) < 1e-9);
});

test("multi-panel paste remains a rigid all-or-nothing group", () => {
  const source = [
    gridPanel("a", 20, 20),
    gridPanel("b", 30, 20),
    gridPanel("c", 20, 40),
    gridPanel("d", 30, 40),
  ];
  const copied = createPanelPasteGroup({
    source,
    roofId: SEARCH_ROOF.id,
    createPanelId: (() => { let id = 0; return () => `group-copy-${id++}`; })(),
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  const pasted = searchPaste({ copied, occupied: source });
  assert.ok(pasted);
  assert.equal(pasted.length, 4);
  assert.deepEqual(
    pasted.map((item) => ({ x: item.cx - pasted[0].cx, y: item.cy - pasted[0].cy, angle: item.angleDeg })),
    source.map((item) => ({ x: item.cx - source[0].cx, y: item.cy - source[0].cy, angle: item.angleDeg })),
  );
});

test("a genuinely full roof exhausts its physical lattice and returns no paste", () => {
  const roof: RoofArea = {
    ...SEARCH_ROOF,
    points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 }],
  };
  const occupied = [10, 20].flatMap((cx) => [10, 30].map((cy) => gridPanel(`${cx}-${cy}`, cx, cy)));
  const copied = createPanelPasteGroup({
    source: [occupied[0]],
    roofId: roof.id,
    createPanelId: () => "full-copy",
    createBlockKey: () => "unused",
    layoutRunId: "copy-run",
  });
  assert.equal(searchPaste({ copied, occupied, roof }), undefined);
});
