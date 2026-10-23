import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRoofAnnotationModel,
  resolveScreenReadableAnnotationRotation,
} from "../../src/components_v2/canvas/roofAnnotationModel";

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

test("edge pills use one German-formatted semantic label and length", () => {
  const model = buildRoofAnnotationModel({
    points: RECTANGLE,
    mppImage: 0.1,
    roofKind: "flat",
    referenceEdgeIndex: 0,
  });

  assert.equal(model.edges[0].label, "REFERENZKANTE · 12,00 m");
  assert.equal(model.edges[1].label, "KANTE 2 · 8,00 m");
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

test("normal mode uses compact non-interactive edge pills with hover-only measurements", () => {
  const annotations = readFileSync(
    new URL("../../src/components_v2/canvas/RoofAnnotationsLayer.tsx", import.meta.url),
    "utf8",
  );
  const accentLayer = readFileSync(
    new URL("../../src/components_v2/canvas/RoofReferenceEdgeLayer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(annotations, /edge\.isReference \? edge\.semanticLabel : `K\$\{edge\.edgeIndex \+ 1\}`/);
  assert.match(annotations, /`Kante \$\{edge\.edgeIndex \+ 1\} · \$\{formatRoofEdgeLengthM\(edge\.lengthM\)\}/);
  assert.match(annotations, /useSharedEdgePills = !selectedZone/);
  assert.match(annotations, /fill="#FFFFFF"/);
  assert.match(annotations, /fill="#000000"/);
  assert.match(annotations, /EDGE_PILL_MIN_WIDTH = 26/);
  assert.match(annotations, /EDGE_PILL_HEIGHT = 20/);
  assert.match(annotations, /fontStyle="600"/);
  assert.match(annotations, /cornerRadius=\{EDGE_PILL_RADIUS \* inverseScale\}/);
  assert.match(annotations, /container\.addEventListener\("pointermove"/);
  assert.match(annotations, /<Group ref=\{groupRef\} listening=\{false\}>/);
  assert.doesNotMatch(annotations, /text="GEFÄLLE"/);
  assert.match(annotations, /showRoofFallArrow =\s*step === "building" &&\s*roofKind === "pitched"/);
  assert.match(annotations, /showRoofFallArrow && \(\s*<RoofAzimuthArrows/);
  assert.doesNotMatch(annotations, /SmallFallArrow/);
  assert.match(accentLayer, /resolveCanonicalRoofReferenceEdge/);
  assert.match(accentLayer, /plannerTheme\.referenceEdge/);
  assert.match(accentLayer, /listening=\{false\}/);
  assert.doesNotMatch(accentLayer, /<(Rect|Text)\b/);
  assert.doesNotMatch(annotations, /edge\.lengthM\.toFixed\(2\)\} m`/);
});

test("trapez mode suppresses edge HUD and its reference accent without touching handles", () => {
  const annotations = readFileSync(
    new URL("../../src/components_v2/canvas/RoofAnnotationsLayer.tsx", import.meta.url),
    "utf8",
  );
  const trapezHandles = readFileSync(
    new URL("../../src/components_v2/canvas/RoofTrapezInteractionOverlay.tsx", import.meta.url),
    "utf8",
  );

  assert.match(annotations, /showEdgeInfo = showLabels && shapeMode !== "trapezio"/);
  assert.match(annotations, /!selectedZone && shapeMode !== "trapezio"/);
  assert.match(trapezHandles, /<RoofHandlesKonva/);
  assert.match(trapezHandles, /onChange=\{\(points\) =>/);
});

test("shared edge pills remain upright after arbitrary viewport rotations", () => {
  for (const canvasRotationDeg of [24, 73, 166, 250]) {
    for (const edgeAngleDeg of [0, 37, 90, 143, 270]) {
      const localRotation = resolveScreenReadableAnnotationRotation(
        edgeAngleDeg,
        canvasRotationDeg,
      );
      const screenRotation = localRotation + canvasRotationDeg;
      assert.ok(screenRotation >= -90 && screenRotation <= 90);
    }
  }
});
