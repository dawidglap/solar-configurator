import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildRoofAnnotationModel } from "../../src/components_v2/canvas/roofAnnotationModel";

const RECTANGLE = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 80 },
  { x: 0, y: 80 },
];

function labelsFor(roofKind: "pitched" | "flat", referenceEdgeIndex: number) {
  return buildRoofAnnotationModel({
    points: RECTANGLE,
    mppImage: 0.1,
    roofKind,
    referenceEdgeIndex,
  }).edges.map((edge) => edge.label.split(" · ")[0]);
}

test("pitched and flat roofs name exactly one canonical semantic edge", () => {
  assert.deepEqual(labelsFor("pitched", 0), ["FIRST", "KANTE 2", "KANTE 3", "KANTE 4"]);
  assert.deepEqual(labelsFor("flat", 0), ["REFERENZKANTE", "KANTE 2", "KANTE 3", "KANTE 4"]);
});

test("changing the canonical edge moves semantic copy and restores the old KANTE label", () => {
  assert.deepEqual(labelsFor("pitched", 2), ["KANTE 1", "KANTE 2", "FIRST", "KANTE 4"]);
  assert.deepEqual(labelsFor("flat", 2), ["KANTE 1", "KANTE 2", "REFERENZKANTE", "KANTE 4"]);
});

test("Dachtyp changes only the semantic terminology without duplicate labels", () => {
  const pitched = labelsFor("pitched", 1);
  const flat = labelsFor("flat", 1);

  assert.deepEqual(pitched, ["KANTE 1", "FIRST", "KANTE 3", "KANTE 4"]);
  assert.deepEqual(flat, ["KANTE 1", "REFERENZKANTE", "KANTE 3", "KANTE 4"]);
  assert.equal(pitched.filter((label) => label === "FIRST").length, 1);
  assert.equal(flat.filter((label) => label === "REFERENZKANTE").length, 1);
  assert.equal(pitched.includes("REFERENZKANTE"), false);
  assert.equal(flat.includes("FIRST"), false);
});

test("semantic copy uses the normal edge annotation renderer while only its edge gets the accent", () => {
  const annotations = readFileSync(
    new URL("../../src/components_v2/canvas/RoofAnnotationsLayer.tsx", import.meta.url),
    "utf8",
  );
  const accentLayer = readFileSync(
    new URL("../../src/components_v2/canvas/RoofReferenceEdgeLayer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(annotations, /const displayLabel = edge\.label/);
  assert.equal((annotations.match(/<Text/g) ?? []).length, 2);
  assert.match(accentLayer, /resolveCanonicalRoofReferenceEdge/);
  assert.match(accentLayer, /plannerTheme\.referenceEdge/);
  assert.match(accentLayer, /listening=\{false\}/);
  assert.doesNotMatch(accentLayer, /<(Rect|Text)\b/);
  assert.doesNotMatch(annotations, /edge\.lengthM\.toFixed\(2\)\} m`/);
});
