import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildRoofReferenceEdgePresentation } from "../../src/components_v2/canvas/roofReferenceEdgePresentation";

const RECTANGLE = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 80 },
  { x: 0, y: 80 },
];

test("pitched and flat roofs use the canonical semantic pill copy", () => {
  const pitched = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
    scale: 1,
    canvasRotationDeg: 0,
  });
  const flat = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "flat",
    referenceEdgeIndex: 2,
    scale: 1,
    canvasRotationDeg: 0,
  });

  assert.equal(pitched?.label, "FIRST");
  assert.equal(pitched?.edge.edgeIndex, 0);
  assert.equal(flat?.label, "REFERENZKANTE");
  assert.equal(flat?.edge.edgeIndex, 2);
});

test("changing First moves the pill immediately to the new canonical edge", () => {
  const top = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "pitched",
    referenceEdgeIndex: 0,
    scale: 1,
    canvasRotationDeg: 0,
  });
  const bottom = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "pitched",
    referenceEdgeIndex: 2,
    scale: 1,
    canvasRotationDeg: 0,
  });

  assert.equal(top?.edge.edgeIndex, 0);
  assert.equal(bottom?.edge.edgeIndex, 2);
  assert.notDeepEqual(top?.center, bottom?.center);
  assert.ok((top?.center.y ?? 0) > 0);
  assert.ok((bottom?.center.y ?? 0) < 80);
});

test("pill size is screen-stable and viewport rotation is cancelled", () => {
  const normalZoom = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "pitched",
    referenceEdgeIndex: 1,
    scale: 1,
    canvasRotationDeg: 37,
  });
  const zoomed = buildRoofReferenceEdgePresentation({
    points: RECTANGLE,
    roofKind: "pitched",
    referenceEdgeIndex: 1,
    scale: 4,
    canvasRotationDeg: 37,
  });

  assert.equal(normalZoom?.screenRotationDeg, -37);
  assert.equal(zoomed?.screenRotationDeg, -37);
  assert.equal(normalZoom?.widthPx, zoomed?.widthPx);
  assert.equal(normalZoom?.heightPx, zoomed?.heightPx);
  assert.equal(normalZoom?.fontSizePx, zoomed?.fontSizePx);
});

test("semantic pill is selected-roof-only, non-interactive and separate from edge length", () => {
  const annotations = readFileSync(
    new URL("../../src/components_v2/canvas/RoofAnnotationsLayer.tsx", import.meta.url),
    "utf8",
  );
  const layer = readFileSync(
    new URL("../../src/components_v2/canvas/RoofReferenceEdgeLayer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(annotations, /const roofId = selectedZone\?\.roofId \?\? selectedId/);
  assert.match(annotations, /\? `\$\{edge\.lengthM\.toFixed\(2\)\} m`/);
  assert.match(layer, /listening=\{false\}/);
  assert.match(layer, /fill="rgba\(255, 255, 255, 0\.96\)"/);
  assert.doesNotMatch(layer, /FIRST ·|REFERENZKANTE ·/);
});
