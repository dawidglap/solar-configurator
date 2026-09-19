import assert from "node:assert/strict";
import test from "node:test";
import {
  createPanelRoofContainmentValidator,
} from "../../src/components_v2/modules/manualPlacement";
import {
  resolveHardRoofBoundaryPosition,
  resolvePanelDragFrameUV,
} from "../../src/components_v2/modules/panels/usePanelDragSnap";
import type { PanelInstance, Pt, RoofArea } from "../../src/types/planner";

function roof(points: Pt[]): RoofArea {
  return { id: "roof", name: "D1", points, roofKind: "pitched" };
}

function panel(id: string, cx: number, cy: number, overrides: Partial<PanelInstance> = {}): PanelInstance {
  return {
    id,
    roofId: "roof",
    cx,
    cy,
    wPx: 2,
    hPx: 2,
    angleDeg: 0,
    orientation: "portrait",
    panelId: "module",
    ...overrides,
  };
}

function solve(input: {
  previous: Pt;
  previousRequested?: Pt;
  requested: Pt;
  validate: (point: Pt) => boolean;
}): Pt {
  return resolveHardRoofBoundaryPosition({
    previousPosition: input.previous,
    previousRequestedPosition: input.previousRequested ?? input.previous,
    requestedPosition: input.requested,
    validate: input.validate,
  });
}

test("single panel hard-stops at the usable roof boundary for Randabstand 0 and 0.2 m", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  for (const [marginM, expectedMaxCenter] of [[0, 9], [0.2, 8.8]] as const) {
    const contains = createPanelRoofContainmentValidator({ roof: area, marginM, mppImage: 1 });
    const moving = panel("p", 5, 5);
    const validate = (point: Pt) => contains([{ ...moving, cx: point.x, cy: point.y }]);
    const result = solve({ previous: { x: 5, y: 5 }, requested: { x: 1000, y: 5 }, validate });
    assert.equal(validate(result), true);
    assert.ok(Math.abs(result.x - expectedMaxCenter) < 1e-5, `${marginM} m => ${result.x}`);
    assert.equal(validate({ x: result.x + 1e-4, y: result.y }), false);
  }
});

test("rigid multi-selection preserves offsets and is limited by its outermost footprint", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 12 }, { x: 0, y: 12 }]);
  const initial = [5, 8, 11, 14, 17, 20].map((cx, index) => panel(`p-${index}`, cx, 5));
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const initialCenterX = initial.reduce((sum, item) => sum + item.cx, 0) / initial.length;
  const validate = (center: Pt) => {
    const dx = center.x - initialCenterX;
    const dy = center.y - 5;
    return contains(initial.map((item) => ({ ...item, cx: item.cx + dx, cy: item.cy + dy })));
  };
  const result = solve({ previous: { x: initialCenterX, y: 5 }, requested: { x: 100, y: 5 }, validate });
  const dx = result.x - initialCenterX;
  const moved = initial.map((item) => ({ ...item, cx: item.cx + dx }));
  assert.equal(contains(moved), true);
  assert.deepEqual(
    moved.slice(1).map((item, index) => item.cx - moved[index].cx),
    [3, 3, 3, 3, 3],
  );
  assert.ok(Math.abs(moved.at(-1)!.cx - 28.8) < 1e-5);
});

test("D-Dome pair is contained as one atomic block and both slots move rigidly", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 10 }, { x: 0, y: 10 }]);
  const advanced = {
    systemId: "k2-d-dome-6.10-classic" as const,
    adapterVersion: "07-481-08@2023-05-05" as const,
    layoutMode: "advanced" as const,
    advancedEngineVersion: "advanced-block-v1" as const,
    geometryEngineVersion: "geometry-v2" as const,
    blockKey: "block-1",
    nominalTiltDeg: 10,
    effectiveTiltDeg: 8.648,
    moduleFaceAzimuthDeg: 90,
  };
  const pair = [
    panel("slot-0", 6, 5, { advanced: { ...advanced, slotIndex: 0 } }),
    panel("slot-1", 8, 5, { advanced: { ...advanced, slotIndex: 1 } }),
  ];
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const validate = (center: Pt) => contains(pair.map((item) => ({
    ...item,
    cx: item.cx + center.x - 7,
    cy: item.cy + center.y - 5,
  })));
  const result = solve({ previous: { x: 7, y: 5 }, requested: { x: 100, y: 5 }, validate });
  const moved = pair.map((item) => ({ ...item, cx: item.cx + result.x - 7 }));
  assert.equal(contains(moved), true);
  assert.equal(moved[0].advanced?.blockKey, moved[1].advanced?.blockKey);
  assert.ok(Math.abs((moved[1].cx - moved[0].cx) - 2) < 1e-9);
});

test("rotated panel hard-stops against an angled edge using its full footprint", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 12, y: 12 }, { x: 2, y: 12 }]);
  const moving = panel("rotated", 7, 5, { wPx: 3, hPx: 5, angleDeg: 13 });
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const validate = (point: Pt) => contains([{ ...moving, cx: point.x, cy: point.y }]);
  const result = solve({ previous: { x: 7, y: 5 }, requested: { x: 30, y: 10 }, validate });
  assert.equal(validate(result), true);
  assert.equal(validate({ x: result.x + 0.01, y: result.y + 0.01 * (5 / 23) }), false);
});

test("concave roofs with more than six edges remain a hard boundary", () => {
  const area = roof([
    { x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 12 }, { x: 9, y: 12 },
    { x: 9, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 12 }, { x: 0, y: 12 },
  ]);
  const moving = panel("p", 3, 3, { wPx: 1.5, hPx: 2.5, angleDeg: 21 });
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const validate = (point: Pt) => contains([{ ...moving, cx: point.x, cy: point.y }]);
  const result = solve({ previous: { x: 3, y: 3 }, requested: { x: 7, y: 10 }, validate });
  assert.equal(validate(result), true);
  assert.equal(validate({ x: 7, y: 10 }), false);
});

test("pointer movement parallel to a reached edge slides instead of escaping or freezing", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  const moving = panel("p", 5, 5);
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const validate = (point: Pt) => contains([{ ...moving, cx: point.x, cy: point.y }]);
  const edge = solve({ previous: { x: 5, y: 5 }, requested: { x: 100, y: 5 }, validate });
  const slid = solve({
    previous: edge,
    previousRequested: { x: 100, y: 5 },
    requested: { x: 100.2, y: 7 },
    validate,
  });
  assert.equal(validate(slid), true);
  assert.ok(Math.abs(slid.x - edge.x) < 1e-5);
  assert.ok(slid.y > edge.y + 1.9);
});

test("magnetic snap near Randabstand cannot pull a panel across the hard boundary", () => {
  const area = roof([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  const moving = panel("moving", 5, 5);
  const contains = createPanelRoofContainmentValidator({ roof: area, marginM: 0.2, mppImage: 1 });
  const validate = (point: Pt) => contains([{ ...moving, cx: point.x, cy: point.y }]);
  const resolution = resolvePanelDragFrameUV({
    free: { u: 10.7, v: 5 },
    hw: 1,
    hh: 1,
    gapXPx: 0,
    gapYPx: 0,
    activationThresholdPx: 2,
    panels: [{ id: "static", u: 8.8, v: 5, hw: 1, hh: 1 }],
    validate: (position) => (
      validate({ x: position.u, y: position.v }) &&
      Math.abs(position.u - 8.8) >= 2
    ),
  });
  assert.equal(resolution.snapped, false, "outside adjacency candidate must be rejected");
  const result = solve({
    previous: { x: 5, y: 5 },
    requested: { x: resolution.position.u, y: resolution.position.v },
    validate,
  });
  assert.equal(validate(result), true);
  assert.ok(Math.abs(result.x - 8.8) < 1e-5);
});

test("solver is canonical-image based and independent of viewport rotation", () => {
  const validate = (point: Pt) => point.x >= 1 && point.x <= 9 && point.y >= 1 && point.y <= 9;
  const canonicalStart = { x: 5, y: 5 };
  const canonicalTarget = { x: 20, y: 7 };
  const direct = solve({ previous: canonicalStart, requested: canonicalTarget, validate });
  for (const rotationDeg of [14, 90, -37]) {
    const radians = rotationDeg * Math.PI / 180;
    const rotate = (point: Pt, sign: number): Pt => ({
      x: point.x * Math.cos(radians) - sign * point.y * Math.sin(radians),
      y: sign * point.x * Math.sin(radians) + point.y * Math.cos(radians),
    });
    const screenTarget = rotate(canonicalTarget, 1);
    const restoredTarget = rotate(screenTarget, -1);
    const result = solve({ previous: canonicalStart, requested: restoredTarget, validate });
    assert.ok(Math.hypot(result.x - direct.x, result.y - direct.y) < 1e-6);
  }
});
