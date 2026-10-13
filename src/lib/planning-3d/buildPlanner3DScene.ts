import { resolveRoofFallAzimuth } from "@/components_v2/roof/roofOrientation";
import type { PanelInstance, Pt, RoofArea } from "@/types/planner";
import { averagePoint, azimuthToWorldDirection, plannerPointToWorld } from "./coordinates";
import { triangulatePolygon } from "./triangulate";
import type {
  Planner3DBounds,
  Planner3DPanel,
  Planner3DRoof,
  Planner3DSceneModel,
  Planner3DSourceSnapshot,
  Vec3,
} from "./types";

export const TECHNICAL_ROOF_REFERENCE_HEIGHT_M = 1;
export const TECHNICAL_ROOF_THICKNESS_M = 0.12;
export const TECHNICAL_PANEL_CLEARANCE_M = 0.035;
export const TECHNICAL_PANEL_THICKNESS_M = 0.035;
export const TECHNICAL_OBSTACLE_HEIGHT_M = 0.65;
export const TECHNICAL_SNOW_GUARD_WIDTH_M = 0.3;
export const TECHNICAL_SNOW_GUARD_RAIL_HEIGHT_M = 0.28;

type RoofPlane = Readonly<{
  centroid: Readonly<{ x: number; z: number }>;
  referenceHeight: number;
  tiltDeg: number;
  fallAzimuthDeg?: number;
}>;

function heightOnPlane(plane: RoofPlane, x: number, z: number): number {
  if (plane.fallAzimuthDeg == null || plane.tiltDeg === 0) return plane.referenceHeight;
  const fall = azimuthToWorldDirection(plane.fallAzimuthDeg);
  const downhillDistance = (x - plane.centroid.x) * fall.x + (z - plane.centroid.z) * fall.z;
  return plane.referenceHeight - downhillDistance * Math.tan((plane.tiltDeg * Math.PI) / 180);
}

function roofPhysicalProperties(roof: RoofArea): Readonly<{ kind: "pitched" | "flat" | "green"; tiltDeg: number; fallAzimuthDeg?: number }> {
  const kind = roof.roofKind ?? ((roof.tiltDeg ?? 0) > 0 ? "pitched" : "flat");
  if (kind !== "pitched") return { kind, tiltDeg: 0 };
  return {
    kind,
    tiltDeg: Math.max(0, roof.tiltDeg ?? 0),
    fallAzimuthDeg: resolveRoofFallAzimuth(roof),
  };
}

function panelPlanCorners(panel: PanelInstance): readonly [Pt, Pt, Pt, Pt] {
  const radians = (panel.angleDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotate = (x: number, y: number): Pt => ({
    x: panel.cx + x * cosine - y * sine,
    y: panel.cy + x * sine + y * cosine,
  });
  return [
    rotate(-panel.wPx / 2, -panel.hPx / 2),
    rotate(panel.wPx / 2, -panel.hPx / 2),
    rotate(panel.wPx / 2, panel.hPx / 2),
    rotate(-panel.wPx / 2, panel.hPx / 2),
  ];
}

function freezeScene<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freezeScene);
  }
  return value;
}

function calculateBounds(points: readonly Vec3[]): Planner3DBounds {
  if (points.length === 0) return { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 2, z: 2 } };
  return points.reduce<Planner3DBounds>((bounds, point) => ({
    min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y), z: Math.min(bounds.min.z, point.z) },
    max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y), z: Math.max(bounds.max.z, point.z) },
  }), { min: { ...points[0] }, max: { ...points[0] } });
}

export function buildPlanner3DScene(snapshot: Planner3DSourceSnapshot): Planner3DSceneModel {
  if (!Number.isFinite(snapshot.mppImage) || snapshot.mppImage <= 0) {
    throw new Error("A positive mppImage is required for the 3D scene");
  }
  const allRoofPoints = snapshot.roofs.flatMap((roof) => roof.points);
  const origin = averagePoint(allRoofPoints);
  const planes = new Map<string, RoofPlane>();

  const roofs: Planner3DRoof[] = snapshot.roofs.flatMap((roof) => {
    if (roof.points.length < 3) return [];
    const physical = roofPhysicalProperties(roof);
    const centroidWorld = plannerPointToWorld(averagePoint(roof.points), origin, snapshot.mppImage);
    const plane: RoofPlane = {
      centroid: { x: centroidWorld.x, z: centroidWorld.z },
      referenceHeight: TECHNICAL_ROOF_REFERENCE_HEIGHT_M,
      tiltDeg: physical.tiltDeg,
      fallAzimuthDeg: physical.fallAzimuthDeg,
    };
    planes.set(roof.id, plane);
    const vertices = roof.points.map((point) => {
      const world = plannerPointToWorld(point, origin, snapshot.mppImage);
      return { ...world, y: heightOnPlane(plane, world.x, world.z) };
    });
    return [{
      id: roof.id,
      kind: physical.kind,
      vertices,
      triangles: triangulatePolygon(vertices),
      thicknessM: TECHNICAL_ROOF_THICKNESS_M,
      selected: roof.id === snapshot.selectedRoofId,
      tiltDeg: physical.tiltDeg,
      fallAzimuthDeg: physical.fallAzimuthDeg,
    }];
  });

  const selectedPanels = new Set(snapshot.selectedPanelIds ?? []);
  const panels: Planner3DPanel[] = snapshot.panels.flatMap((panel) => {
    const plane = planes.get(panel.roofId);
    if (!plane) return [];
    const planCorners = panelPlanCorners(panel);
    const worldCorners = planCorners.map((point) => plannerPointToWorld(point, origin, snapshot.mppImage));
    const center = plannerPointToWorld({ x: panel.cx, y: panel.cy }, origin, snapshot.mppImage);
    const faceAzimuthDeg = panel.advanced?.moduleFaceAzimuthDeg;
    // Standard Schrägdach modules remain parallel to their owner roof. Only an
    // Advanced mounting system supplies an independent physical face and tilt.
    const ownTiltDeg = panel.advanced?.effectiveTiltDeg;
    const followsRoof = ownTiltDeg == null;
    const tiltDeg = followsRoof ? plane.tiltDeg : ownTiltDeg;
    const face = faceAzimuthDeg == null ? undefined : azimuthToWorldDirection(faceAzimuthDeg);
    const centerHeight = heightOnPlane(plane, center.x, center.z) + TECHNICAL_PANEL_CLEARANCE_M;
    const corners = worldCorners.map((corner): Vec3 => ({
      ...corner,
      y: followsRoof
        ? heightOnPlane(plane, corner.x, corner.z) + TECHNICAL_PANEL_CLEARANCE_M
        : centerHeight - ((corner.x - center.x) * (face?.x ?? 0) + (corner.z - center.z) * (face?.z ?? 0)) * Math.tan((tiltDeg * Math.PI) / 180),
    })) as [Vec3, Vec3, Vec3, Vec3];
    return [{
      id: panel.id,
      roofId: panel.roofId,
      corners,
      thicknessM: TECHNICAL_PANEL_THICKNESS_M,
      selected: selectedPanels.has(panel.id),
      tiltDeg,
      faceAzimuthDeg,
      blockKey: panel.advanced?.blockKey,
      slotIndex: panel.advanced?.slotIndex,
    }];
  });

  const obstacles = snapshot.obstacles.flatMap((obstacle) => {
    const plane = planes.get(obstacle.roofId);
    if (!plane || obstacle.points.length < 3) return [];
    const base = obstacle.points.map((point) => {
      const world = plannerPointToWorld(point, origin, snapshot.mppImage);
      return { ...world, y: heightOnPlane(plane, world.x, world.z) + 0.02 };
    });
    const top = base.map((point) => ({ ...point, y: point.y + TECHNICAL_OBSTACLE_HEIGHT_M }));
    return [{ id: obstacle.id, roofId: obstacle.roofId, base, top, triangles: triangulatePolygon(base), displayHeightM: TECHNICAL_OBSTACLE_HEIGHT_M }];
  });

  const snowGuards = snapshot.snowGuards.flatMap((guard) => {
    const plane = planes.get(guard.roofId);
    if (!plane) return [];
    const convert = (point: Pt): Vec3 => {
      const world = plannerPointToWorld(point, origin, snapshot.mppImage);
      return { ...world, y: heightOnPlane(plane, world.x, world.z) + 0.05 };
    };
    return [{ id: guard.id, roofId: guard.roofId, start: convert(guard.p1), end: convert(guard.p2), widthM: TECHNICAL_SNOW_GUARD_WIDTH_M, railHeightM: TECHNICAL_SNOW_GUARD_RAIL_HEIGHT_M }];
  });

  const points = [
    ...roofs.flatMap((roof) => roof.vertices),
    ...panels.flatMap((panel) => panel.corners),
    ...obstacles.flatMap((obstacle) => obstacle.top),
    ...snowGuards.flatMap((guard) => [guard.start, guard.end]),
  ];
  return freezeScene({
    coordinateConvention: "image-x-to-world-x,image-y-to-world-z,vertical-to-world-y",
    referenceHeightStrategy: "per-roof-centroid-neutral-height",
    roofs,
    panels,
    obstacles,
    snowGuards,
    bounds: calculateBounds(points),
  });
}
