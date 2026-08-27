import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLatestFrameScheduler } from "../../src/components_v2/canvas/performance/latestFrameScheduler";
import { translateInteractionPoints } from "../../src/components_v2/canvas/performance/transientGeometry";
import { createRafPointChannel } from "../../src/components_v2/canvas/performance/rafPointChannel";
import {
  buildPanelDragStaticGeometry,
  resolveNoOverlapCached,
  type PanelInst,
} from "../../src/components_v2/modules/panels/usePanelDragSnap";

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

  for (let value = 0; value < 100; value++) scheduler.schedule(value);
  assert.equal(callbacks.length, 1);
  callbacks[0](0);
  assert.deepEqual(values, [99]);
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

  assert.equal(panelSource.match(/updatePanel\(/g)?.length, 1);
  assert.equal(zoneSource.match(/onChange\(/g)?.length, 1);
  assert.ok(panelSource.includes("node.position"));
  assert.ok(zoneSource.includes("setLivePoints"));
  assert.equal(panSource.includes("setView({ offsetX: cl.x, offsetY: cl.y })"), false);
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
