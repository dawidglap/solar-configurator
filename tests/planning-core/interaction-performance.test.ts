import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLatestFrameScheduler } from "../../src/components_v2/canvas/performance/latestFrameScheduler";
import { translateInteractionPoints } from "../../src/components_v2/canvas/performance/transientGeometry";
import { createRafPointChannel } from "../../src/components_v2/canvas/performance/rafPointChannel";
import { createPanelPastePlacementValidator } from "../../src/components_v2/modules/manualPlacement";
import type { PanelInstance, RoofArea } from "../../src/types/planner";
import {
  buildPanelDragStaticGeometry,
  createPanelAxis,
  createPanelDragSpatialIndex,
  hasPanelOverlapCached,
  PANEL_SNAP_TUNING_SCREEN_PX,
  panelSnapTuningForScale,
  resolveMagneticNeighbourSnapUV,
  resolvePanelDragFrameUV,
  type PanelInst,
} from "../../src/components_v2/modules/panels/usePanelDragSnap";

test("snap tuning separates strong adjacency from subtle alignment in screen pixels", () => {
  assert.deepEqual(PANEL_SNAP_TUNING_SCREEN_PX, {
    adjacencyActivationPx: 18,
    adjacencyReleasePx: 26,
    alignmentActivationPx: 9,
    alignmentReleasePx: 15,
    adjacencyPriorityBonusPx: 8,
  });
  assert.deepEqual(panelSnapTuningForScale(2), {
    adjacencyActivationPx: 9,
    adjacencyReleasePx: 13,
    alignmentActivationPx: 4.5,
    alignmentReleasePx: 7.5,
    adjacencyPriorityBonusPx: 4,
  });
});

test("exact adjacency wins over a closer generic alignment guide", () => {
  const result = resolvePanelDragFrameUV({
    free: { u: 11, v: 7 },
    hw: 5,
    hh: 5,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 18,
    snapTuning: PANEL_SNAP_TUNING_SCREEN_PX,
    panels: [
      { id: "neighbour", u: 0, v: 0, hw: 5, hh: 5 },
      { id: "guide", u: 11, v: 100, hw: 5, hh: 5 },
    ],
    validate: () => true,
  });
  assert.equal(result.snapKey, "adjacency:neighbour:right");
  assert.deepEqual(result.position, { u: 11, v: 0 });
});

test("adjacency activates at 18 px, remains stable to 26 px, then releases", () => {
  const panels = [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 50 }];
  const acquired = resolvePanelDragFrameUV({
    free: { u: 11, v: 17.9 }, hw: 5, hh: 50, gapXPx: 1, gapYPx: 1,
    activationThresholdPx: 18, snapTuning: PANEL_SNAP_TUNING_SCREEN_PX,
    panels, validate: () => true,
  });
  assert.equal(acquired.snapKey, "adjacency:fixed:right");
  const retained = resolvePanelDragFrameUV({
    free: { u: 11, v: 25.9 }, hw: 5, hh: 50, gapXPx: 1, gapYPx: 1,
    activationThresholdPx: 18, snapTuning: PANEL_SNAP_TUNING_SCREEN_PX,
    activeSnapKey: acquired.snapKey, panels, validate: () => true,
  });
  assert.equal(retained.snapKey, acquired.snapKey);
  const released = resolvePanelDragFrameUV({
    free: { u: 11, v: 26.1 }, hw: 5, hh: 50, gapXPx: 1, gapYPx: 1,
    activationThresholdPx: 18, snapTuning: PANEL_SNAP_TUNING_SCREEN_PX,
    activeSnapKey: acquired.snapKey, panels, validate: () => true,
  });
  assert.equal(released.snapKey, null);
  assert.deepEqual(released.position, { u: 11, v: 26.1 });
});

test("screen-space activation is perceptually identical across zoom levels", () => {
  const panels = [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 50 }];
  for (const scale of [1, 2]) {
    const tuning = panelSnapTuningForScale(scale);
    const result = resolvePanelDragFrameUV({
      free: { u: 11, v: 17 / scale }, hw: 5, hh: 50, gapXPx: 1, gapYPx: 1,
      activationThresholdPx: tuning.adjacencyActivationPx,
      snapTuning: tuning,
      panels,
      validate: () => true,
    });
    assert.equal(result.snapKey, "adjacency:fixed:right");
  }
});

test("drag neighbour snap uses exact axis gaps without pushing invalid candidates", () => {
  const panels = [{ id: "fixed", u: 10, v: 20, hw: 5, hh: 8 }];
  const snapped = resolveMagneticNeighbourSnapUV({
    u: 20.1,
    v: 20.2,
    hw: 5,
    hh: 8,
    gapXPx: 0.2,
    gapYPx: 0.3,
    activationThresholdPx: 2,
    panels,
  });
  assert.deepEqual(snapped, { u: 20.2, v: 20 });
  assert.equal(hasPanelOverlapCached({
    u: 20.2,
    v: 20,
    hw: 5,
    hh: 8,
    gapPx: 0,
    gapXPx: 0.2,
    gapYPx: 0.3,
    panels,
  }), false);
  assert.equal(hasPanelOverlapCached({
    u: 19,
    v: 20,
    hw: 5,
    hh: 8,
    gapPx: 0,
    gapXPx: 0.2,
    gapYPx: 0.3,
    panels,
  }), true);
  assert.equal(resolveMagneticNeighbourSnapUV({
    u: 50,
    v: 50,
    hw: 5,
    hh: 8,
    gapXPx: 0.2,
    gapYPx: 0.3,
    activationThresholdPx: 2,
    panels,
  }), null);
});

test("occupied right and constrained left never block a free downward escape", () => {
  const result = resolvePanelDragFrameUV({
    free: { u: 0, v: 30 },
    hw: 5,
    hh: 8,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    panels: [{ id: "right", u: 11, v: 0, hw: 5, hh: 8 }],
    validate: (position) => position.u >= 0 && position.v >= 20,
  });
  assert.deepEqual(result.position, { u: 0, v: 30 });
  assert.equal(result.valid, true);
  assert.equal(result.snapped, false);
});

test("side occupancy never blocks a free upward escape", () => {
  const result = resolvePanelDragFrameUV({
    free: { u: 0, v: -30 },
    hw: 5,
    hh: 8,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    panels: [
      { id: "left", u: -11, v: 0, hw: 5, hh: 8 },
      { id: "right", u: 11, v: 0, hw: 5, hh: 8 },
    ],
    validate: (position) => position.v <= -20,
  });
  assert.deepEqual(result.position, { u: 0, v: -30 });
  assert.equal(result.valid, true);
  assert.equal(result.snapped, false);
});

test("top and bottom occupancy never block a free horizontal escape", () => {
  const result = resolvePanelDragFrameUV({
    free: { u: 30, v: 0 },
    hw: 5,
    hh: 8,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    panels: [
      { id: "top", u: 0, v: -17, hw: 5, hh: 8 },
      { id: "bottom", u: 0, v: 17, hw: 5, hh: 8 },
    ],
    validate: (position) => position.u >= 20,
  });
  assert.deepEqual(result.position, { u: 30, v: 0 });
  assert.equal(result.valid, true);
  assert.equal(result.snapped, false);
});

test("an invalid magnetic proposal is ignored in favour of a valid free pointer position", () => {
  const free = { u: 21, v: 1 };
  const result = resolvePanelDragFrameUV({
    free,
    hw: 5,
    hh: 8,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    panels: [{ id: "fixed", u: 10, v: 0, hw: 5, hh: 8 }],
    validate: (position) => position.u !== 21 || position.v !== 0,
  });
  assert.deepEqual(result.position, free);
  assert.equal(result.valid, true);
  assert.equal(result.snapKey, null);
});

test("snap hysteresis keeps one deterministic corner candidate until the release radius", () => {
  const panels = [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 5 }];
  const first = resolvePanelDragFrameUV({
    free: { u: 10.8, v: 0.4 },
    hw: 5,
    hh: 5,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    releaseThresholdPx: 12,
    panels,
    validate: () => true,
  });
  assert.equal(first.snapKey, "adjacency:fixed:right");
  const second = resolvePanelDragFrameUV({
    free: { u: 11.4, v: 2.5 },
    hw: 5,
    hh: 5,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    releaseThresholdPx: 12,
    activeSnapKey: first.snapKey,
    panels,
    validate: () => true,
  });
  assert.equal(second.snapKey, first.snapKey);
});

test("right and bottom adjacency snap to the exact configured gaps and release naturally", () => {
  const panels = [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 8 }];
  const right = resolvePanelDragFrameUV({
    free: { u: 11.6, v: 0.3 }, hw: 5, hh: 8, gapXPx: 1, gapYPx: 2,
    activationThresholdPx: 4, panels, validate: () => true,
  });
  assert.deepEqual(right.position, { u: 11, v: 0 });
  assert.equal(right.snapKey, "adjacency:fixed:right");

  const bottom = resolvePanelDragFrameUV({
    free: { u: 0.2, v: 18.7 }, hw: 5, hh: 8, gapXPx: 1, gapYPx: 2,
    activationThresholdPx: 4, panels, validate: () => true,
  });
  assert.deepEqual(bottom.position, { u: 0, v: 18 });
  assert.equal(bottom.snapKey, "adjacency:fixed:bottom");

  const released = resolvePanelDragFrameUV({
    free: { u: 11, v: 20 }, hw: 5, hh: 8, gapXPx: 1, gapYPx: 2,
    activationThresholdPx: 4, releaseThresholdPx: 6,
    activeSnapKey: right.snapKey, panels, validate: () => true,
  });
  assert.deepEqual(released.position, { u: 11, v: 20 });
  assert.equal(released.snapKey, null);
});

test("Shift disables snap while preserving free-position validation", () => {
  const free = { u: 10.5, v: 0 };
  const result = resolvePanelDragFrameUV({
    free,
    hw: 5,
    hh: 5,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 8,
    disableSnap: true,
    panels: [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 5 }],
    validate: () => true,
  });
  assert.deepEqual(result.position, free);
  assert.equal(result.snapped, false);
});

test("transient invalid overlap follows the pointer and becomes valid beyond the obstacle", () => {
  const validate = (position: { u: number; v: number }) => Math.abs(position.u) >= 10;
  const overlapping = resolvePanelDragFrameUV({
    free: { u: 0, v: 0 }, hw: 2, hh: 2, gapXPx: 0, gapYPx: 0,
    activationThresholdPx: 0, disableSnap: true, panels: [], validate,
  });
  assert.deepEqual(overlapping.position, { u: 0, v: 0 });
  assert.equal(overlapping.valid, false);
  const escaped = resolvePanelDragFrameUV({
    free: { u: 15, v: 0 }, hw: 2, hh: 2, gapXPx: 0, gapYPx: 0,
    activationThresholdPx: 0, disableSnap: true, panels: [], validate,
  });
  assert.deepEqual(escaped.position, { u: 15, v: 0 });
  assert.equal(escaped.valid, true);
});

test("configured gap is the legal boundary and snap radius adds no collision halo", () => {
  const panels = [{ id: "fixed", u: 0, v: 0, hw: 5, hh: 5 }];
  const overlapAt = (u: number) => hasPanelOverlapCached({
    u, v: 0, hw: 5, hh: 5, gapPx: 0, gapXPx: 1, gapYPx: 1, panels,
  });
  assert.equal(overlapAt(11 - 1e-4), true);
  assert.equal(overlapAt(11), false);
  assert.equal(overlapAt(11 + 1e-4), false);
});

test("manual 13 degree working geometry keeps its own magnetic axes", () => {
  const axis = createPanelAxis(13);
  const fixedWorld = axis.fromUV(40, 25);
  const staticPanels = buildPanelDragStaticGeometry({
    allPanels: [{
      id: "rotated-fixed", roofId: "roof-a", cx: fixedWorld.x, cy: fixedWorld.y,
      wPx: 10, hPx: 20, angleDeg: 13,
    }],
    roofId: "roof-a",
    defaultAngleDeg: 0,
    axisAngleDeg: 13,
    project: axis.project,
  });
  const result = resolvePanelDragFrameUV({
    free: { u: 50.7, v: 25.2 },
    hw: 5,
    hh: 10,
    gapXPx: 1,
    gapYPx: 1,
    activationThresholdPx: 3,
    panels: staticPanels,
    validate: () => true,
  });
  assert.ok(Math.abs(result.position.u - 51) < 1e-9);
  assert.ok(Math.abs(result.position.v - 25) < 1e-9);
  assert.equal(result.snapKey, "adjacency:rotated-fixed:right");
});

test("canonical drag validation uses the full footprint on a trapezoid and obstacle", () => {
  const roof: RoofArea = {
    id: "trapezoid",
    name: "D1",
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 70, y: 100 }, { x: 20, y: 100 }],
  };
  const panel = (cx: number, cy: number): PanelInstance => ({
    id: "moving", roofId: roof.id, cx, cy, wPx: 12, hPx: 20,
    angleDeg: 0, orientation: "portrait", panelId: "module",
  });
  const validate = createPanelPastePlacementValidator({
    roof,
    marginM: 0,
    mppImage: 0.1,
    zones: [{
      roofId: roof.id,
      type: "riservata",
      points: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }],
    }],
    snowGuards: [],
    panels: [],
  });
  assert.equal(validate([panel(80, 80)]), false, "inside AABB but outside trapezoid is invalid");
  assert.equal(validate([panel(45, 55)]), false, "center outside obstacle but footprint intersects it");
  assert.equal(validate([panel(35, 30)]), true);
});

test("raw pointer bursts coalesce to the latest animation frame value", () => {
  const callbacks: FrameRequestCallback[] = [];
  const values: number[] = [];
  const scheduler = createLatestFrameScheduler(
    (value: number) => values.push(value),
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    () => {},
  );

  for (let value = 0; value < 600; value++) scheduler.schedule(value);
  assert.equal(callbacks.length, 1);
  callbacks[0](0);
  assert.deepEqual(values, [599]);
});

test("flush processes the final pointer candidate before drag-end commit", () => {
  const values: number[] = [];
  const scheduler = createLatestFrameScheduler(
    (value: number) => values.push(value),
    () => 1,
    () => {},
  );
  scheduler.schedule(42);
  scheduler.flush();
  assert.deepEqual(values, [42]);
  assert.equal(scheduler.hasPending(), false);
});

test("panel drag projects and indexes static panels once without push-away resolution", () => {
  let projections = 0;
  const panels: PanelInst[] = Array.from({ length: 400 }, (_, index) => ({
    id: `p-${index}`,
    roofId: "roof-a",
    cx: (index % 20) * 12,
    cy: Math.floor(index / 20) * 22,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
  }));
  const project = ({ x, y }: { x: number; y: number }) => {
    projections++;
    return { u: x, v: y };
  };
  const staticPanels = buildPanelDragStaticGeometry({
    allPanels: panels,
    roofId: "roof-a",
    excludeId: "p-0",
    defaultAngleDeg: 0,
    project,
  });

  assert.equal(staticPanels.length, 399);
  assert.equal(projections, 399);
  const index = createPanelDragSpatialIndex(staticPanels, 32);
  assert.ok(index.query(12, 0, 24).length < staticPanels.length);
  assert.equal(projections, 399, "no projection is repeated during pointer frames");
});

test("50, 200 and 400 panel fixtures keep static projection outside 600 pointer frames", () => {
  for (const panelCount of [50, 200, 400]) {
    let projections = 0;
    const panels: PanelInst[] = Array.from({ length: panelCount }, (_, index) => ({
      id: `fixture-${panelCount}-${index}`,
      roofId: "roof-a",
      cx: (index % 20) * 14,
      cy: Math.floor(index / 20) * 24,
      wPx: 10,
      hPx: 20,
      angleDeg: 0,
    }));
    const staticPanels = buildPanelDragStaticGeometry({
      allPanels: panels,
      roofId: "roof-a",
      excludeId: panels[0].id,
      defaultAngleDeg: 0,
      project: ({ x, y }) => {
        projections++;
        return { u: x, v: y };
      },
    });
    const projectionsAtStart = projections;
    for (let move = 0; move < 600; move++) {
      hasPanelOverlapCached({
        u: move / 10,
        v: move / 20,
        hw: 5,
        hh: 10,
        gapPx: 1,
        panels: staticPanels,
      });
    }
    assert.equal(projectionsAtStart, panelCount - 1);
    assert.equal(projections, projectionsAtStart, `${panelCount}: no static reprojection per move`);
  }
});

test("continuous interactions keep global commits at gesture boundaries", () => {
  const panelSource = readFileSync(
    new URL("../../src/components_v2/modules/panels/usePanelDragSnap.ts", import.meta.url),
    "utf8",
  );
  const zoneSource = readFileSync(
    new URL("../../src/components_v2/zones/ZoneHandlesKonva.tsx", import.meta.url),
    "utf8",
  );
  const panSource = readFileSync(
    new URL("../../src/components_v2/canvas/hooks/useStagePanZoom.ts", import.meta.url),
    "utf8",
  );
  const panelsLayerSource = readFileSync(
    new URL("../../src/components_v2/modules/PanelsKonva.tsx", import.meta.url),
    "utf8",
  );
  const roofHandleSource = readFileSync(
    new URL("../../src/components_v2/canvas/RoofHandlesKonva.tsx", import.meta.url),
    "utf8",
  );
  const roofLayerSource = readFileSync(
    new URL("../../src/components_v2/canvas/RoofShapesLayer.tsx", import.meta.url),
    "utf8",
  );
  const canvasSource = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(panelSource.includes("updatePanel("), false);
  assert.equal(panelSource.match(/commitPanel\(/g)?.length, 1);
  assert.equal(zoneSource.match(/onChange\(/g)?.length, 1);
  assert.ok(panelSource.includes("draggedNodeRef.current?.position"));
  assert.equal(panelSource.includes("resolveNoOverlap"), false);
  assert.ok(panelSource.includes("endDrag(false)"));
  assert.equal(zoneSource.includes("setLivePoints"), false);
  assert.equal(zoneSource.includes("setDragValid"), false);
  assert.equal(roofHandleSource.includes("setLivePoints"), false);
  assert.equal(panelsLayerSource.includes("setGroupHint"), false);
  assert.ok(panelsLayerSource.includes("updatePanelsBulk(patches)"));
  assert.ok(roofLayerSource.includes("updateRoofsBulk(patches)"));
  assert.equal(canvasSource.includes("setFillDraft"), false);
  assert.equal(panSource.includes("setView({ offsetX: cl.x, offsetY: cl.y })"), false);
});

test("600 pointer moves can end in exactly one canonical commit", () => {
  const callbacks: FrameRequestCallback[] = [];
  let visualFrames = 0;
  let commits = 0;
  let finalVisual = -1;
  const scheduler = createLatestFrameScheduler(
    (value: number) => {
      visualFrames++;
      finalVisual = value;
    },
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    () => {},
  );

  for (let index = 0; index < 600; index++) scheduler.schedule(index);
  assert.equal(commits, 0, "pointer frames never commit canonical state");
  scheduler.flush();
  commits++;
  assert.equal(visualFrames, 1);
  assert.equal(finalVisual, 599);
  assert.equal(commits, 1);
});

test("cancelled 600-move gesture performs zero canonical commits", () => {
  const commits = 0;
  const scheduler = createLatestFrameScheduler(
    () => {},
    () => 1,
    () => {},
  );
  for (let index = 0; index < 600; index++) scheduler.schedule(index);
  scheduler.cancel();
  assert.equal(commits, 0);
});

test("cancelled frame work never reaches the visual callback", () => {
  let calls = 0;
  const scheduler = createLatestFrameScheduler(
    () => calls++,
    () => 1,
    () => {},
  );
  scheduler.schedule(1);
  scheduler.cancel();
  scheduler.flush();
  assert.equal(calls, 0);
});

test("transient roof translation commits the exact canonical delta", () => {
  const original = [
    { x: 10, y: 20 },
    { x: 50, y: 20 },
    { x: 50, y: 60 },
    { x: 10, y: 60 },
  ];
  assert.deepEqual(translateInteractionPoints(original, { x: 7.5, y: -3 }), [
    { x: 17.5, y: 17 },
    { x: 57.5, y: 17 },
    { x: 57.5, y: 57 },
    { x: 17.5, y: 57 },
  ]);
  assert.deepEqual(original[0], { x: 10, y: 20 });
});

test("drawing pointer notifications are isolated and frame-coalesced", () => {
  const frames: FrameRequestCallback[] = [];
  const channel = createRafPointChannel(
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
    () => {},
  );
  let notifications = 0;
  channel.subscribe(() => notifications++);
  for (let index = 0; index < 100; index++) {
    channel.publish({ x: index, y: index * 2 });
  }
  assert.equal(frames.length, 1);
  assert.equal(notifications, 0);
  frames[0](0);
  assert.equal(notifications, 1);
  assert.deepEqual(channel.getSnapshot(), { x: 99, y: 198 });
});
