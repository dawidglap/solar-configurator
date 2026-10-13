import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildPlanner3DScene } from "../src/lib/planning-3d/buildPlanner3DScene";
import { triangulatePolygon } from "../src/lib/planning-3d/triangulate";
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

test("scene conversion is deeply read-only and leaves canonical planner JSON invariant", () => {
  const source = {
    mppImage: 0.1,
    roofs: [roof],
    panels: [panel()],
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
