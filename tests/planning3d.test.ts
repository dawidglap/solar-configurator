import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildPlanner3DScene } from "../src/lib/planning-3d/buildPlanner3DScene";
import { distance3D } from "../src/lib/planning-3d/coordinates";
import { triangulatePolygon } from "../src/lib/planning-3d/triangulate";
import { computeUsableRoof, roofSegmentLengthM } from "../src/lib/planning-core/geometry-v2";
import type { PanelInstance, RoofArea } from "../src/types/planner";

const roof: RoofArea = {
  id: "roof-1",
  name: "Test",
  roofKind: "pitched",
  tiltDeg: 20,
  fallAzimuthDeg: 180,
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
};

function panel(overrides: Partial<PanelInstance> = {}): PanelInstance {
  return {
    id: "panel-1",
    roofId: "roof-1",
    cx: 50,
    cy: 40,
    wPx: 10,
    hPx: 20,
    angleDeg: 0,
    orientation: "portrait",
    panelId: "spec-1",
    ...overrides,
  };
}

function build(overrides: Partial<Parameters<typeof buildPlanner3DScene>[0]> = {}) {
  return buildPlanner3DScene({
    mppImage: 0.1,
    roofs: [roof],
    panels: [panel()],
    panelSpecs: [{ id: "spec-1", brand: "SOLA", model: "Physical", wp: 430, widthM: 1, heightM: 2, priceChf: 0 }],
    standardMarginM: 0,
    obstacles: [],
    snowGuards: [],
    ...overrides,
  });
}

test("converts canonical image metres without depending on viewport state", () => {
  const scene = build();
  const xs = scene.roofs[0].vertices.map((point) => point.x);
  const zs = scene.roofs[0].vertices.map((point) => point.z);
  assert.equal(Math.max(...xs) - Math.min(...xs), 10);
  assert.equal(Math.max(...zs) - Math.min(...zs), 8);
  assert.equal(scene.coordinateConvention, "image-x-to-world-x,image-y-to-world-z,vertical-to-world-y");
});

test("pitched roof falls in the canonical geographic direction at the configured angle", () => {
  const scene = build();
  const north = scene.roofs[0].vertices[0];
  const south = scene.roofs[0].vertices[3];
  assert.ok(north.y > south.y);
  assert.ok(Math.abs((north.y - south.y) / 8 - Math.tan(20 * Math.PI / 180)) < 1e-10);

  const northFacing = build({ roofs: [{ ...roof, fallAzimuthDeg: 0 }] });
  assert.ok(northFacing.roofs[0].vertices[0].y < northFacing.roofs[0].vertices[3].y);
});

test("standard module corners rest parallel above the pitched roof", () => {
  const scene = build();
  const panelCorners = scene.panels[0].corners;
  const roofVertices = scene.roofs[0].vertices;
  const roofDropPerZ = (roofVertices[3].y - roofVertices[0].y) / (roofVertices[3].z - roofVertices[0].z);
  const panelDropPerZ = (panelCorners[3].y - panelCorners[0].y) / (panelCorners[3].z - panelCorners[0].z);
  assert.ok(Math.abs(roofDropPerZ - panelDropPerZ) < 1e-10);
  assert.ok(Math.abs(distance3D(panelCorners[0], panelCorners[1]) - 1) < 1e-10);
  assert.ok(Math.abs(distance3D(panelCorners[1], panelCorners[2]) - 2) < 1e-10);
});

test("39 degree roof reconstructs a 6.56 m surface edge from its top-down projection", () => {
  const pitch = 39;
  const trueLengthM = 6.56;
  const projectedLengthM = trueLengthM * Math.cos(pitch * Math.PI / 180);
  const mppImage = 0.01;
  const projectedPx = projectedLengthM / mppImage;
  const realCaseRoof: RoofArea = {
    id: "roof-1",
    name: "39 degree acceptance",
    roofKind: "pitched",
    tiltDeg: pitch,
    fallAzimuthDeg: 180,
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: projectedPx }, { x: 0, y: projectedPx }],
  };
  const scene = build({ mppImage, roofs: [realCaseRoof], panels: [] });
  const surfaceLength = distance3D(scene.roofs[0].vertices[0], scene.roofs[0].vertices[3]);
  const projectedLength = Math.hypot(
    scene.roofs[0].vertices[0].x - scene.roofs[0].vertices[3].x,
    scene.roofs[0].vertices[0].z - scene.roofs[0].vertices[3].z,
  );
  assert.ok(Math.abs(projectedLength - projectedLengthM) < 1e-10);
  assert.ok(Math.abs(surfaceLength - trueLengthM) < 1e-10);
});

test("surface-aware 39 degree panels preserve catalog size, row pitch and top-down footprint", () => {
  const pitch = 39;
  const cosine = Math.cos(pitch * Math.PI / 180);
  const mppImage = 0.01;
  const widthM = 1.134;
  const heightM = 1.762;
  const gapM = 0.019;
  const realCaseRoof: RoofArea = {
    id: "roof-1",
    name: "39 degree panel acceptance",
    roofKind: "pitched",
    tiltDeg: pitch,
    fallAzimuthDeg: 180,
    points: [{ x: 0, y: 0 }, { x: 1034, y: 0 }, { x: 1034, y: 510 }, { x: 0, y: 510 }],
  };
  const projectedWidthPx = widthM / mppImage;
  const projectedHeightPx = heightM * cosine / mppImage;
  const rowPitchPx = (heightM + gapM) * cosine / mppImage;
  const standard = {
    layoutMode: "standard" as const,
    moduleTiltMode: "inherit-roof" as const,
    effectiveTiltDeg: pitch,
    geometrySpace: "roof-surface-v1" as const,
  };
  const panels = [
    panel({ id: "row-1", cx: 100, cy: 100, wPx: projectedWidthPx, hPx: projectedHeightPx, standard }),
    panel({ id: "row-2", cx: 100, cy: 100 + rowPitchPx, wPx: projectedWidthPx, hPx: projectedHeightPx, standard }),
  ];
  const scene = build({
    mppImage,
    roofs: [realCaseRoof],
    panels,
    panelSpecs: [{ id: "spec-1", brand: "AIKO", model: "A445-MAH54Tm", wp: 445, widthM, heightM, priceChf: 0 }],
  });
  const first = scene.panels[0].corners;
  assert.ok(Math.abs(distance3D(first[0], first[1]) - widthM) < 1e-10);
  assert.ok(Math.abs(distance3D(first[1], first[2]) - heightM) < 1e-10);
  assert.ok(Math.abs(Math.abs(first[1].x - first[0].x) - projectedWidthPx * mppImage) < 1e-10);
  assert.ok(Math.abs(Math.abs(first[2].z - first[1].z) - projectedHeightPx * mppImage) < 1e-10);
  const center = (corners: readonly { x: number; y: number; z: number }[]) => corners.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4, z: sum.z + point.z / 4 }),
    { x: 0, y: 0, z: 0 },
  );
  assert.ok(Math.abs(distance3D(center(scene.panels[0].corners), center(scene.panels[1].corners)) - (heightM + gapM)) < 1e-10);
});

test("surface distance matches SOLA measurements for flat, 15°, 39°, steep and arbitrary edges", () => {
  const vectors = [
    { x: 0, y: 120 },
    { x: 120, y: 0 },
    { x: 72, y: 96 },
  ];
  for (const pitch of [0, 15, 39, 85]) {
    for (const vector of vectors) {
      const testRoof: RoofArea = {
        id: "roof-1",
        name: "basis test",
        roofKind: pitch === 0 ? "flat" : "pitched",
        tiltDeg: pitch,
        fallAzimuthDeg: 180,
        points: [
          { x: 0, y: 0 },
          { x: vector.x, y: vector.y },
          { x: vector.x + 30, y: vector.y - 20 },
          { x: 30, y: -20 },
        ],
      };
      const scene = build({ roofs: [testRoof], panels: [] });
      const actual = distance3D(scene.roofs[0].vertices[0], scene.roofs[0].vertices[1]);
      const expected = roofSegmentLengthM(vector, 0.1, {
        tiltDeg: pitch === 0 ? 0 : pitch,
        fallAzimuthDeg: 180,
      });
      assert.ok(Math.abs(actual - expected) < 1e-9, `${pitch}° ${JSON.stringify(vector)}`);
      assert.ok(Math.abs(
        Math.hypot(
          scene.roofs[0].vertices[1].x - scene.roofs[0].vertices[0].x,
          scene.roofs[0].vertices[1].z - scene.roofs[0].vertices[0].z,
        ) - Math.hypot(vector.x, vector.y) * 0.1,
      ) < 1e-9);
    }
  }
});

test("D-Dome faces use persisted identity and descend away from their shared ridge", () => {
  const flatRoof = { ...roof, roofKind: "flat" as const, tiltDeg: 0, fallAzimuthDeg: undefined };
  const left = panel({
    id: "left", cx: 44,
    advanced: { layoutMode: "advanced", systemId: "k2-d-dome-6.10-classic", adapterVersion: "07-481-08@2023-05-05", advancedEngineVersion: "advanced-block-v1", geometryEngineVersion: "geometry-v2", blockKey: "block-a", slotIndex: 0, nominalTiltDeg: 10, effectiveTiltDeg: 10, moduleFaceAzimuthDeg: 270 },
  });
  const right = panel({
    id: "right", cx: 56,
    advanced: { ...left.advanced!, slotIndex: 1, moduleFaceAzimuthDeg: 90 },
  });
  const scene = build({ roofs: [flatRoof], panels: [left, right] });
  const leftInner = Math.max(...scene.panels[0].corners.filter((corner) => corner.x > -0.6).map((corner) => corner.y));
  const leftOuter = Math.min(...scene.panels[0].corners.filter((corner) => corner.x < -0.6).map((corner) => corner.y));
  const rightInner = Math.max(...scene.panels[1].corners.filter((corner) => corner.x < 0.6).map((corner) => corner.y));
  const rightOuter = Math.min(...scene.panels[1].corners.filter((corner) => corner.x > 0.6).map((corner) => corner.y));
  assert.ok(leftInner > leftOuter);
  assert.ok(rightInner > rightOuter);
  assert.equal(scene.panels[0].blockKey, "block-a");
  assert.equal(scene.panels[1].slotIndex, 1);
});

test("South system uses persisted face azimuth and effective tilt", () => {
  const south = panel({
    advanced: { layoutMode: "advanced", systemId: "generic-south", adapterVersion: "advanced-block-v1/generic-v1", advancedEngineVersion: "advanced-block-v1", geometryEngineVersion: "geometry-v2", blockKey: "south-a", slotIndex: 0, nominalTiltDeg: 15, effectiveTiltDeg: 15, moduleFaceAzimuthDeg: 180 },
  });
  const scene = build({ roofs: [{ ...roof, roofKind: "flat", tiltDeg: 0 }], panels: [south] });
  assert.equal(scene.panels[0].tiltDeg, 15);
  assert.equal(scene.panels[0].faceAzimuthDeg, 180);
  assert.ok(scene.panels[0].corners[0].y > scene.panels[0].corners[3].y);
});

test("obstacle footprint and SnowGuard physical width are preserved", () => {
  const scene = build({
    obstacles: [{ id: "obstacle", roofId: "roof-1", points: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }] }],
    snowGuards: [{ id: "snow", roofId: "roof-1", p1: { x: 10, y: 60 }, p2: { x: 90, y: 60 } }],
  });
  assert.equal(scene.obstacles[0].base.length, 4);
  assert.ok(Math.abs(scene.obstacles[0].top[0].y - scene.obstacles[0].base[0].y - 0.65) < 1e-10);
  assert.equal(scene.snowGuards[0].widthM, 0.3);
  assert.equal(scene.snowGuards[0].end.x - scene.snowGuards[0].start.x, 8);
});

test("ear clipping triangulates a concave roof without a bounding-box replacement", () => {
  const polygon = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 2, z: 2 }, { x: 0, z: 4 }];
  const triangles = triangulatePolygon(polygon);
  assert.equal(triangles.length, polygon.length - 2);
  const triangleArea = triangles.reduce((sum, [a, b, c]) => sum + Math.abs(
    (polygon[a].x * (polygon[b].z - polygon[c].z) + polygon[b].x * (polygon[c].z - polygon[a].z) + polygon[c].x * (polygon[a].z - polygon[b].z)) / 2,
  ), 0);
  assert.equal(triangleArea, 12);
});

test("3D Randabstand reuses canonical uniform and per-edge usable-roof geometry", () => {
  const flatRoof: RoofArea = {
    id: "roof-1",
    name: "Margin",
    roofKind: "flat",
    tiltDeg: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  };
  const uniform = build({ roofs: [{ ...flatRoof, edgeMarginM: 1 }], panels: [] });
  assert.equal(uniform.marginBands.length, 1);
  assert.equal(uniform.marginBands[0].marginM, 1);
  assert.equal(uniform.marginBands[0].usableComponents.length, 1);
  const uniformHole = uniform.marginBands[0].usableComponents[0];
  assert.ok(Math.abs(Math.max(...uniformHole.map((point) => point.x)) - Math.min(...uniformHole.map((point) => point.x)) - 8) < 1e-9);
  assert.ok(Math.abs(Math.max(...uniformHole.map((point) => point.z)) - Math.min(...uniformHole.map((point) => point.z)) - 8) < 1e-9);

  const edgeMarginsM = [0.5, 1, 1.5, 2];
  const perEdgeRoof: RoofArea = {
    ...flatRoof,
    edgeMarginMode: "perEdge",
    edgeStableIds: ["e1", "e2", "e3", "e4"],
    edgeMarginsM: { e1: 0.5, e2: 1, e3: 1.5, e4: 2 },
  };
  const perEdge = build({ roofs: [perEdgeRoof], panels: [], standardMarginM: 0.2 });
  assert.deepEqual(perEdge.marginBands[0].edgeMarginsM, edgeMarginsM);
  const canonical = computeUsableRoof({
    roofPolygonM: flatRoof.points.map((point) => ({ x: point.x * 0.1, y: point.y * 0.1 })),
    marginM: 0.2,
    edgeMarginsM,
  });
  assert.equal(canonical.status, "valid");
  const canonicalComponent = canonical.components[0];
  const renderedComponent = perEdge.marginBands[0].usableComponents[0];
  const span = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
  assert.ok(Math.abs(span(renderedComponent.map((point) => point.x)) - span(canonicalComponent.map((point) => point.x))) < 1e-9);
  assert.ok(Math.abs(span(renderedComponent.map((point) => point.z)) - span(canonicalComponent.map((point) => point.y))) < 1e-9);
});

test("scene conversion is deeply read-only and leaves canonical planner JSON invariant", () => {
  const source = {
    mppImage: 0.1,
    roofs: [roof],
    panels: [panel()],
    panelSpecs: [{ id: "spec-1", brand: "SOLA", model: "Physical", wp: 430, widthM: 1, heightM: 2, priceChf: 0 }],
    standardMarginM: 0,
    obstacles: [],
    snowGuards: [],
    selectedRoofId: "roof-1",
    selectedPanelIds: ["panel-1"],
  };
  const before = JSON.stringify(source);
  const scene = buildPlanner3DScene(source);
  assert.equal(JSON.stringify(source), before);
  assert.ok(Object.isFrozen(scene));
  assert.ok(Object.isFrozen(scene.panels));
  assert.ok(Object.isFrozen(scene.panels[0].corners[0]));
});

test("adapter handles 100 and 200 panel layouts in one batched scene model", () => {
  for (const count of [100, 200]) {
    const panels = Array.from({ length: count }, (_, index) => panel({ id: `p-${index}`, cx: 5 + (index % 20) * 4, cy: 5 + Math.floor(index / 20) * 6 }));
    assert.equal(build({ panels }).panels.length, count);
  }
});

test("3D layer has no planner-store or mutation API imports", () => {
  const files = ["Planner3DView.tsx", "Planner3DCanvas.tsx"];
  const forbidden = /usePlannerV2Store|updateRoof|updatePanel|movePanel|deletePanel|addPanel|setObstacle|commitRoofLayout|savePlannerToDb/;
  files.forEach((file) => {
    const source = readFileSync(join(process.cwd(), "src/components_v2/three", file), "utf8");
    assert.doesNotMatch(source, forbidden, file);
  });
  const shell = readFileSync(join(process.cwd(), "src/components_v2/layout/PlannerShell.tsx"), "utf8");
  assert.match(shell, /useState<"2d" \| "3d">\("2d"\)/);
});
