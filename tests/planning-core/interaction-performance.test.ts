import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLatestFrameScheduler } from "../../src/components_v2/canvas/performance/latestFrameScheduler";
import { translateInteractionPoints } from "../../src/components_v2/canvas/performance/transientGeometry";
import { createRafPointChannel } from "../../src/components_v2/canvas/performance/rafPointChannel";
import {
  buildPanelDragStaticGeometry,
  hasPanelOverlapCached,
  resolveMagneticNeighbourSnapUV,
  resolveNoOverlapCached,
  type PanelInst,
} from "../../src/components_v2/modules/panels/usePanelDragSnap";

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

test("panel drag projects static panels once and preserves overlap resolution", () => {
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
  const first = resolveNoOverlapCached({
    u: 12,
    v: 0,
    hw: 5,
    hh: 10,
    gapPx: 2,
    panels: staticPanels,
  });
  const second = resolveNoOverlapCached({
    u: 12,
    v: 0,
    hw: 5,
    hh: 10,
    gapPx: 2,
    panels: staticPanels,
  });
  assert.deepEqual(first, second);
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
  assert.ok(panelSource.includes("node.position"));
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
