import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createFillAreaDragGesture,
  type FillAreaDragPoint,
} from "../../src/components_v2/modules/fill/fillAreaDragGesture";
import {
  buildOrientedFillAreaPolygon,
  resolveFillAreaReferenceFrame,
} from "../../src/components_v2/modules/fill/fillAreaGeometry";
import type { FrameScheduler } from "../../src/components_v2/canvas/performance/latestFrameScheduler";

function createControlledScheduler<T>(run: (value: T) => void): FrameScheduler<T> {
  let latest: T | undefined;
  return {
    schedule(value) {
      latest = value;
    },
    flush() {
      if (latest === undefined) return;
      const value = latest;
      latest = undefined;
      run(value);
    },
    cancel() {
      latest = undefined;
    },
    hasPending() {
      return latest !== undefined;
    },
  };
}

function setupGesture() {
  const visuals: Array<{ start: FillAreaDragPoint; end: FillAreaDragPoint } | null> = [];
  const commits: Array<{ start: FillAreaDragPoint; end: FillAreaDragPoint }> = [];
  let scheduler: FrameScheduler<FillAreaDragPoint> | undefined;
  const gesture = createFillAreaDragGesture({
    thresholdPx: 5,
    onVisual: (visual) => visuals.push(visual),
    onCommit: (visual) => commits.push(visual),
    createScheduler: (run) => {
      scheduler = createControlledScheduler(run);
      return scheduler;
    },
  });
  return { gesture, visuals, commits, getScheduler: () => scheduler! };
}

const pointAt = (angleDeg: number, length: number) => {
  const radians = angleDeg * Math.PI / 180;
  return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
};

function rotatedRoof(angleDeg: number) {
  const tangent = pointAt(angleDeg, 100);
  const normal = pointAt(angleDeg + 90, 50);
  return [
    { x: 0, y: 0 },
    tangent,
    { x: tangent.x + normal.x, y: tangent.y + normal.y },
    normal,
  ];
}

function assertPointClose(actual: FillAreaDragPoint, expected: FillAreaDragPoint) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${actual.y} != ${expected.y}`);
}

function rotate(point: FillAreaDragPoint, angleDeg: number) {
  const radians = angleDeg * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

test("Manuell füllen commits once on release, never during raw pointer moves", () => {
  const { gesture, commits, getScheduler } = setupGesture();

  gesture.begin({ x: 10, y: 10 });
  for (let x = 11; x <= 80; x += 1) gesture.move({ x, y: 60 });

  assert.equal(commits.length, 0);
  getScheduler().flush();
  assert.equal(commits.length, 0);

  gesture.end({ x: 90, y: 70 });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], {
    start: { x: 10, y: 10 },
    end: { x: 90, y: 70 },
  });
  assert.equal(gesture.isActive(), false);
});

test("a click or sub-threshold movement does not fill or leave a dangling start point", () => {
  const { gesture, commits } = setupGesture();

  gesture.begin({ x: 20, y: 20 });
  gesture.end({ x: 20, y: 20 });
  assert.equal(commits.length, 0);
  assert.equal(gesture.isActive(), false);

  gesture.begin({ x: 20, y: 20 });
  gesture.end({ x: 23, y: 23 });
  assert.equal(commits.length, 0);
  assert.equal(gesture.isActive(), false);
});

test("reverse drag preserves both endpoints for direction-independent normalization", () => {
  const { gesture, commits } = setupGesture();

  gesture.begin({ x: 100, y: 80 });
  gesture.end({ x: 10, y: 15 });

  assert.deepEqual(commits, [{
    start: { x: 100, y: 80 },
    end: { x: 10, y: 15 },
  }]);
});

test("cancel removes the transient rectangle and never commits", () => {
  const { gesture, visuals, commits, getScheduler } = setupGesture();

  gesture.begin({ x: 5, y: 5 });
  gesture.move({ x: 50, y: 50 });
  getScheduler().flush();
  assert.notEqual(visuals.at(-1), null);

  assert.equal(gesture.cancel(), true);
  assert.equal(visuals.at(-1), null);
  assert.equal(commits.length, 0);
  assert.equal(gesture.isActive(), false);
});

test("flat fill rectangle is parallel/perpendicular to the canonical 24 degree Referenzkante", () => {
  const frame = resolveFillAreaReferenceFrame({
    roofPoints: rotatedRoof(24),
    referenceEdgeIndex: 0,
    roofKind: "flat",
  });
  assert.ok(frame);
  const polygon = buildOrientedFillAreaPolygon({
    start: { x: 8, y: 11 },
    end: { x: 74, y: 69 },
    frame,
  });
  const primary = { x: polygon[1].x - polygon[0].x, y: polygon[1].y - polygon[0].y };
  const secondary = { x: polygon[3].x - polygon[0].x, y: polygon[3].y - polygon[0].y };
  assert.ok(Math.abs(primary.x * frame.normal.x + primary.y * frame.normal.y) < 1e-9);
  assert.ok(Math.abs(secondary.x * frame.tangent.x + secondary.y * frame.tangent.y) < 1e-9);
  assert.ok(Math.abs(primary.x * secondary.x + primary.y * secondary.y) < 1e-9);
});

test("viewport rotations -24 and +53 degrees produce the same canonical fill polygon", () => {
  const frame = resolveFillAreaReferenceFrame({
    roofPoints: rotatedRoof(24),
    referenceEdgeIndex: 0,
    roofKind: "flat",
  });
  assert.ok(frame);
  const start = { x: 12, y: 18 };
  const end = { x: 91, y: 67 };
  const expected = buildOrientedFillAreaPolygon({ start, end, frame });
  for (const viewportRotationDeg of [-24, 53]) {
    const screenStart = rotate(start, viewportRotationDeg);
    const screenEnd = rotate(end, viewportRotationDeg);
    const canonicalStart = rotate(screenStart, -viewportRotationDeg);
    const canonicalEnd = rotate(screenEnd, -viewportRotationDeg);
    const actual = buildOrientedFillAreaPolygon({
      start: canonicalStart,
      end: canonicalEnd,
      frame,
    });
    actual.forEach((point, index) => assertPointClose(point, expected[index]));
  }
});

test("changing Referenzkante or pitched First changes the next fill frame immediately", () => {
  const points = rotatedRoof(31);
  const first = resolveFillAreaReferenceFrame({
    roofPoints: points,
    referenceEdgeIndex: 0,
    roofKind: "pitched",
  });
  const side = resolveFillAreaReferenceFrame({
    roofPoints: points,
    referenceEdgeIndex: 1,
    roofKind: "flat",
  });
  assert.ok(first);
  assert.ok(side);
  assert.equal(first.edgeIndex, 0);
  assert.equal(side.edgeIndex, 1);
  assert.ok(Math.abs(first.tangent.x * side.tangent.x + first.tangent.y * side.tangent.y) < 1e-9);
  assert.ok(Math.abs(Math.atan2(first.tangent.y, first.tangent.x) * 180 / Math.PI - 31) < 1e-9);
});

test("reverse drag retains signed projections and the exact canonical endpoint", () => {
  const frame = resolveFillAreaReferenceFrame({
    roofPoints: rotatedRoof(37),
    referenceEdgeIndex: 0,
    roofKind: "pitched",
  });
  assert.ok(frame);
  const start = { x: 90, y: 80 };
  const end = { x: 10, y: 15 };
  const polygon = buildOrientedFillAreaPolygon({ start, end, frame });
  assertPointClose(polygon[0], start);
  assertPointClose(polygon[2], end);
});

test("release commits before clearing the exact final visual geometry", () => {
  const events: string[] = [];
  const gesture = createFillAreaDragGesture({
    thresholdPx: 0,
    onVisual: (visual) => events.push(visual ? "visual" : "clear"),
    onCommit: () => events.push("commit"),
    createScheduler: (run) => createControlledScheduler(run),
  });
  gesture.begin({ x: 0, y: 0 });
  gesture.end({ x: 20, y: 20 });
  assert.deepEqual(events, ["clear", "visual", "commit", "clear"]);
});

test("fill controller uses one pointer drag lifecycle instead of a two-click state machine", () => {
  const source = readFileSync(
    new URL("../../src/components_v2/modules/fill/FillAreaController.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /addEventListener\('pointerdown'/);
  assert.match(source, /addEventListener\('pointermove'/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /addEventListener\('pointercancel'/);
  assert.match(source, /addEventListener\('lostpointercapture'/);
  assert.doesNotMatch(source, /st\.on\('click'/);
  assert.doesNotMatch(source, /handleClick/);
  assert.match(source, /history\.push\('Manuell füllen'\)/);
  assert.match(source, /resolveFillAreaReferenceFrame/);
  assert.match(source, /buildOrientedFillAreaPolygon/);
  assert.doesNotMatch(source, /axisAlignedRect/);
  assert.doesNotMatch(source, /resolveStandardAutoLayoutCanvasAngle/);
  assert.match(source, /draftRef\.current\?\.panels/);
});

test("customer-facing F/U terminology is consistent while shortcuts stay F/U", () => {
  const toolbar = readFileSync(
    new URL("../../src/components_v2/layout/TopToolbar.tsx", import.meta.url),
    "utf8",
  );
  const help = readFileSync(
    new URL("../../src/components_v2/layout/PlannerHelpDialog.tsx", import.meta.url),
    "utf8",
  );
  const legacyButton = readFileSync(
    new URL("../../src/components_v2/modules/ModulesTopbarFillAreaButton.tsx", import.meta.url),
    "utf8",
  );

  assert.match(toolbar, /tooltipLabel=\{activeModuleMode \? "Vollbelegung"/);
  assert.match(toolbar, /tooltipKeys=\{\["U"\]\}/);
  assert.match(toolbar, /tooltipLabel=\{activeModuleMode \? "Manuell füllen"/);
  assert.match(toolbar, /tooltipKeys=\{\["F"\]\}/);
  assert.match(toolbar, /active=\{tool === "fill-area"\}/);
  assert.match(help, /title: "Vollbelegung"/);
  assert.match(help, /title: "Manuell füllen"/);
  assert.match(legacyButton, />\s*Manuell füllen\s*</);

  for (const source of [toolbar, help, legacyButton]) {
    assert.doesNotMatch(source, /Fläche füllen|Dachfläche füllen|Autolayout umwandeln|Automatisches Layout/);
  }
});
