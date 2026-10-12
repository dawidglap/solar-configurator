import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPlannerMapReady,
  REFERENCE_EDGE_REMINDER_DURATION_MS,
  REFERENCE_EDGE_REMINDER_TEXT,
} from "../../src/components_v2/canvas/referenceEdgeReminder";

const READY_VIEWPORT = {
  hydrationReady: true,
  step: "building",
  imageWidth: 1000,
  imageHeight: 500,
  viewportWidth: 800,
  viewportHeight: 600,
  fitScale: 1.2,
  scale: 1.2,
  offsetX: -200,
  offsetY: 0,
};

test("the reminder waits for hydration, map image and the initialized cover viewport", () => {
  assert.equal(isPlannerMapReady(READY_VIEWPORT), true);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, hydrationReady: false }), false);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, imageWidth: 0 }), false);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, fitScale: 1 }), false);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, offsetX: 0 }), false);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, step: "report" }), false);
  assert.equal(isPlannerMapReady({ ...READY_VIEWPORT, step: "modules" }), true);
});

test("the reminder contract uses the exact copy and a five-second lifetime", () => {
  assert.equal(
    REFERENCE_EDGE_REMINDER_TEXT,
    "Tipp: Wähle die gewünschte Referenzkante, damit die Module automatisch optimal ausgerichtet werden.",
  );
  assert.equal(REFERENCE_EDGE_REMINDER_DURATION_MS, 5_000);
});

test("the canvas owns one show-once ref and the toast never captures interaction", () => {
  const canvas = readFileSync(
    new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
    "utf8",
  );
  const toast = readFileSync(
    new URL("../../src/components_v2/canvas/ReferenceEdgeReminderToast.tsx", import.meta.url),
    "utf8",
  );

  assert.match(canvas, /referenceEdgeReminderShownRef\.current = true/);
  assert.match(canvas, /REFERENCE_EDGE_REMINDER_DURATION_MS/);
  assert.match(toast, /pointer-events-none/);
  assert.match(toast, /top: "calc\(var\(--tb, 48px\) \+ 48px\)"/);
  assert.match(toast, /left: "calc\(var\(--sb, 0px\) \+ var\(--propW, 312px\)\)"/);
  assert.match(toast, /duration: 0\.2/);
});
