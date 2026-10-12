import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvas = readFileSync(
  new URL("../../src/components_v2/canvas/CanvasStage.tsx", import.meta.url),
  "utf8",
);
const handle = readFileSync(
  new URL("../../src/components_v2/modules/panels/MultiSelectionDragHandle.tsx", import.meta.url),
  "utf8",
);
const panels = readFileSync(
  new URL("../../src/components_v2/modules/PanelsKonva.tsx", import.meta.url),
  "utf8",
);
const marquee = readFileSync(
  new URL("../../src/components_v2/modules/panels/PanelMarqueeOverlay.tsx", import.meta.url),
  "utf8",
);

test("the complete selection handle is promoted into the final Konva selection layer", () => {
  const annotationsIndex = canvas.indexOf("<RoofAnnotationsLayer");
  const selectionLayerIndex = canvas.indexOf('name="selection-ui-layer"');
  assert.ok(annotationsIndex >= 0);
  assert.ok(selectionLayerIndex > annotationsIndex);
  assert.match(canvas, /selectionOverlayRef=\{selectionOverlayGroupRef\}/);
  assert.match(handle, /node\.moveTo\(overlayParent\)/);
  assert.match(handle, /node\.moveToTop\(\)/);
  assert.match(canvas, /const SELECTION_UI_CANVAS_Z_INDEX = 190/);
  assert.match(canvas, /canvas\.style\.zIndex = String\(SELECTION_UI_CANVAS_Z_INDEX\)/);
  assert.match(marquee, /z-\[180\]/);
});

test("the overlay preserves module-step pointer routing without changing the handle hitbox", () => {
  assert.match(
    canvas,
    /listening=\{step === "modules" && !drawingCapturesPointer\}/,
  );
  assert.match(handle, /onPointerDown=\{\(event\) => \{/);
  assert.match(handle, /onStart\(event\)/);
  assert.match(handle, /const HANDLE_SIZE_PX = 40/);
  assert.match(panels, /const HANDLE_GAP_STAGE_PX = 28/);
});
