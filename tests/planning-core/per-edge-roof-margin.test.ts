import assert from "node:assert/strict";
import test from "node:test";

import { computeMaximumLegacyStandardLayout } from "../../src/lib/planning-core/legacy-standard";
import {
  initializePerEdgeMargins,
  reconcileRoofEdgeMarginState,
  resolveRoofEdgeMarginsM,
} from "../../src/lib/planning/roofProperties";
import { createPanelPlacementValidator } from "../../src/components_v2/modules/manualPlacement";
import type { PanelInstance, RoofArea } from "../../src/types/planner";

const POINTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const ROOF: RoofArea = { id: "roof-margin", name: "D1", points: POINTS };
const EDGE_IDS = ["top", "right", "bottom", "left"];
const EDGE_VALUES = { top: 0.5, right: 0.2, bottom: 0.1, left: 0.3 };

test("legacy roofs remain global and first advanced activation copies the scalar margin", () => {
  assert.equal(resolveRoofEdgeMarginsM(ROOF, 0.2), undefined);
  let id = 0;
  const initialized = initializePerEdgeMargins({
    roof: ROOF,
    globalMarginM: 0.2,
    createId: () => `edge-${id++}`,
  });
  assert.equal(initialized.edgeMarginMode, "perEdge");
  assert.deepEqual(initialized.edgeStableIds, ["edge-0", "edge-1", "edge-2", "edge-3"]);
  assert.deepEqual(resolveRoofEdgeMarginsM({ ...ROOF, ...initialized }, 0.2), [0.2, 0.2, 0.2, 0.2]);
});

test("global mode ignores but preserves per-edge values for reactivation and JSON refresh", () => {
  const advanced: RoofArea = {
    ...ROOF,
    edgeMarginM: 0.2,
    edgeMarginMode: "perEdge",
    edgeStableIds: EDGE_IDS,
    edgeMarginsM: EDGE_VALUES,
  };
  const global = { ...advanced, edgeMarginMode: "global" as const };
  assert.equal(resolveRoofEdgeMarginsM(global, 0.2), undefined);
  assert.deepEqual(global.edgeMarginsM, EDGE_VALUES);

  const restored = JSON.parse(JSON.stringify(advanced)) as RoofArea;
  assert.deepEqual(resolveRoofEdgeMarginsM(restored, 0.2), [0.5, 0.2, 0.1, 0.3]);
});

test("Schrägdach and Flachdach resolve the same canonical per-edge margins", () => {
  for (const roofKind of ["pitched", "flat"] as const) {
    const roof: RoofArea = {
      ...ROOF,
      roofKind,
      edgeMarginMode: "perEdge",
      edgeStableIds: EDGE_IDS,
      edgeMarginsM: EDGE_VALUES,
    };
    assert.deepEqual(resolveRoofEdgeMarginsM(roof, 0.2), [0.5, 0.2, 0.1, 0.3]);
  }
});

test("stable edge IDs survive geometry edits and topology changes cannot shift overrides", () => {
  const roof: RoofArea = {
    ...ROOF,
    edgeStableIds: EDGE_IDS,
    edgeMarginsM: EDGE_VALUES,
  };
  const moved = reconcileRoofEdgeMarginState({
    roof,
    nextPoints: POINTS.map((point) => ({ x: point.x + 12, y: point.y + 8 })),
    createId: () => "unused",
  });
  assert.deepEqual(moved?.edgeStableIds, EDGE_IDS);
  assert.deepEqual(moved?.edgeMarginsM, EDGE_VALUES);

  let id = 0;
  const split = reconcileRoofEdgeMarginState({
    roof,
    nextPoints: [POINTS[0], { x: 50, y: 0 }, ...POINTS.slice(1)],
    createId: () => `new-${id++}`,
  });
  assert.deepEqual(split?.edgeStableIds?.slice(2), ["right", "bottom", "left"]);
  assert.deepEqual(split?.edgeMarginsM, { right: 0.2, bottom: 0.1, left: 0.3 });
});

test("Vollbelegung maximizes inside the per-edge usable boundary without double inset", () => {
  const layout = computeMaximumLegacyStandardLayout({
    generation: {
      roofPolygon: POINTS,
      mppImage: 0.1,
      orientation: "portrait",
      panelSizeM: { widthM: 1, heightM: 1 },
      spacingM: 0,
      marginM: 0.2,
      edgeMarginsM: [0.5, 0.2, 0.1, 0.3],
    },
    reservedZones: [],
    snowGuards: [],
    filterPolicy: { reservedZones: true, snowGuards: true },
  });
  assert.equal(layout.count, 45);
  assert.ok(layout.placements.every((panel) => panel.cy - panel.hPx / 2 >= 5 - 1e-6));
  assert.ok(layout.placements.every((panel) => panel.cx - panel.wPx / 2 >= 3 - 1e-6));
});

test("manual drag validation uses per-edge mode and global mode uses only the scalar", () => {
  const panel: PanelInstance = {
    id: "moving",
    roofId: ROOF.id,
    cx: 50,
    cy: 7,
    wPx: 10,
    hPx: 10,
    angleDeg: 0,
    orientation: "portrait",
    panelId: "module",
  };
  const createValidator = (edgeMarginMode: "global" | "perEdge") => createPanelPlacementValidator({
    roof: {
      ...ROOF,
      edgeMarginMode,
      edgeStableIds: EDGE_IDS,
      edgeMarginsM: EDGE_VALUES,
    },
    marginM: 0.2,
    mppImage: 0.1,
    zones: [],
    snowGuards: [],
    panels: [],
  });

  assert.equal(createValidator("global")([panel]), true);
  assert.equal(createValidator("perEdge")([panel]), false);
  assert.equal(createValidator("perEdge")([{ ...panel, cy: 10 }]), true);
});

