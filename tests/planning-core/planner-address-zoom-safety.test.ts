import assert from "node:assert/strict";
import test from "node:test";

import {
  canBootstrapPlanningFromAddress,
  resolvePlannerSessionMode,
} from "../../src/components_v2/planner/plannerSessionPolicy";
import {
  getViewportScaleBounds,
  scaleToSliderPercent,
  sliderPercentToScale,
  zoomViewportAroundPoint,
} from "../../src/components_v2/canvas/viewportZoom";

test("an existing planning identity blocks every address bootstrap action", () => {
  const planning = {
    planningId: "planning-existing",
    layers: [{ id: "roof-a" }, { id: "roof-b" }],
    panels: Array.from({ length: 42 }, (_, index) => ({ id: `panel-${index}` })),
    zones: [{ id: "zone-a" }, { id: "zone-b" }, { id: "zone-c" }],
    manualEdit: { panelId: "panel-41", x: 123.45, y: 67.89 },
  };
  const before = JSON.stringify(planning);
  let destructiveInitializerCalls = 0;

  const mode = resolvePlannerSessionMode({
    planningId: planning.planningId,
    hasEstablishedSite: true,
  });
  if (canBootstrapPlanningFromAddress(mode)) {
    destructiveInitializerCalls += 1;
    planning.layers = [];
    planning.panels = [];
    planning.zones = [];
  }

  assert.equal(mode, "existing");
  assert.equal(destructiveInitializerCalls, 0);
  assert.equal(JSON.stringify(planning), before);
});

test("a genuine new-planning session still permits address initialization", () => {
  const mode = resolvePlannerSessionMode({
    planningId: "new-empty-document",
    hasEstablishedSite: false,
  });
  assert.equal(mode, "new");
  assert.equal(canBootstrapPlanningFromAddress(mode), true);
});

test("zoom slider uses the canonical fitScale to 8x bounds with reversible logarithmic mapping", () => {
  const bounds = getViewportScaleBounds(0.5);
  assert.deepEqual(bounds, { minScale: 0.5, maxScale: 4 });
  for (const scale of [0.5, 0.75, 1, 2, 4]) {
    const percent = scaleToSliderPercent(scale, 0.5);
    assert.ok(Math.abs(sliderPercentToScale(percent, 0.5) - scale) < 1e-12);
  }
});

test("viewport-center zoom changes only view transform and preserves planning/calibration data", () => {
  const canonical = {
    mppImage: 0.071,
    roofs: [{ id: "roof", points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }],
    panels: [{ id: "panel", cx: 22, cy: 31 }],
    zones: [{ id: "zone", points: [{ x: 15, y: 25 }] }],
  };
  const before = JSON.stringify(canonical);
  const point = { x: 600, y: 400 };
  const previousView = { scale: 1, fitScale: 0.5, offsetX: -100, offsetY: -50 };
  const worldBefore = {
    x: (point.x - previousView.offsetX) / previousView.scale,
    y: (point.y - previousView.offsetY) / previousView.scale,
  };
  const next = zoomViewportAroundPoint({
    view: previousView,
    targetScale: 2,
    point,
    viewport: { w: 1200, h: 800 },
    image: { width: 2800, height: 1800 },
  });
  const worldAfter = {
    x: (point.x - next.offsetX) / next.scale,
    y: (point.y - next.offsetY) / next.scale,
  };

  assert.deepEqual(worldAfter, worldBefore);
  assert.equal(JSON.stringify(canonical), before);
  assert.equal(canonical.mppImage, 0.071);
});
