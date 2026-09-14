import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createFillAreaDragGesture,
  type FillAreaDragPoint,
} from "../../src/components_v2/modules/fill/fillAreaDragGesture";
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
