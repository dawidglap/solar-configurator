import { resolveRoofFallAzimuth } from "@/components_v2/roof/roofOrientation";
import type { PanelInstance, Pt, RoofArea } from "@/types/planner";
import { averagePoint, azimuthToWorldDirection, plannerPointToWorld } from "./coordinates";
import { triangulatePolygon } from "./triangulate";
import { resolveSurfacePlanning } from "@/lib/planning-core/advanced";
import { computeUsableRoof, getCanonicalRoofVertices } from "@/lib/planning-core/geometry-v2";
import {
  resolveRoofEdgeMarginM,
  resolveRoofEdgeMarginsM,
  resolveRoofSlopeForKind,
} from "@/lib/planning/roofProperties";
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
export const TECHNICAL_MARGIN_CLEARANCE_M = 0.012;

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
  const planning = resolveSurfacePlanning(roof.surfacePlanning);
  const matchesKind = (planning.status === "supported-standard" || planning.status === "supported-advanced") &&
    planning.config.surface.kind === kind;
  const slopeDeg = resolveRoofSlopeForKind(
    kind,
    matchesKind ? planning.config.surface.slopeDeg ?? roof.tiltDeg : roof.tiltDeg,
  );
  const tiltDeg = Math.min(80, Math.max(0, slopeDeg));
  if (tiltDeg === 0) return { kind, tiltDeg: 0 };
  return {
    kind,
    tiltDeg,
    fallAzimuthDeg: matchesKind
      ? planning.config.surface.fallAzimuthDeg ?? resolveRoofFallAzimuth(roof)
      : resolveRoofFallAzimuth(roof),
  };
}

function pointOnRoof(
  point: Pt,
  origin: Pt,
  mppImage: number,
  plane: RoofPlane,
  clearanceM = 0,
): Vec3 {
  const world = plannerPointToWorld(point, origin, mppImage);
  return { ...world, y: heightOnPlane(plane, world.x, world.z) + clearanceM };
}

function normalizeVector(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { x: 1, y: 0, z: 0 };
}

function roofTangentForImageAxis(axis: Pt, plane: RoofPlane): Vec3 {
  const fall = plane.fallAzimuthDeg == null
    ? { x: 0, z: 0 }
    : azimuthToWorldDirection(plane.fallAzimuthDeg);
  return normalizeVector({
    x: axis.x,
    z: axis.y,
    y: -(axis.x * fall.x + axis.y * fall.z) * Math.tan((plane.tiltDeg * Math.PI) / 180),
  });
}

function physicalStandardPanelCorners(input: {
  panel: PanelInstance;
  center: Vec3;
  plane: RoofPlane;
  widthM: number;
  heightM: number;
}): [Vec3, Vec3, Vec3, Vec3] {
  const radians = (input.panel.angleDeg * Math.PI) / 180;
  const u = roofTangentForImageAxis({ x: Math.cos(radians), y: Math.sin(radians) }, input.plane);
  const mappedV = roofTangentForImageAxis({ x: -Math.sin(radians), y: Math.cos(radians) }, input.plane);
  const projection = u.x * mappedV.x + u.y * mappedV.y + u.z * mappedV.z;
  const v = normalizeVector({
    x: mappedV.x - u.x * projection,
    y: mappedV.y - u.y * projection,
    z: mappedV.z - u.z * projection,
  });
  const corner = (uSign: number, vSign: number): Vec3 => ({
    x: input.center.x + u.x * input.widthM * uSign / 2 + v.x * input.heightM * vSign / 2,
    y: input.center.y + u.y * input.widthM * uSign / 2 + v.y * input.heightM * vSign / 2,
    z: input.center.z + u.z * input.widthM * uSign / 2 + v.z * input.heightM * vSign / 2,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
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
  const allRoofPoints = snapshot.roofs.flatMap((roof) => getCanonicalRoofVertices(roof.points));
  const origin = averagePoint(allRoofPoints);
  const planes = new Map<string, RoofPlane>();
  const roofPoints = new Map<string, readonly Pt[]>();

  const roofs: Planner3DRoof[] = snapshot.roofs.flatMap((roof) => {
    const canonicalPoints = getCanonicalRoofVertices(roof.points).map(({ x, y }) => ({ x, y }));
    if (canonicalPoints.length < 3) return [];
    const physical = roofPhysicalProperties(roof);
    const centroidWorld = plannerPointToWorld(averagePoint(canonicalPoints), origin, snapshot.mppImage);
    const plane: RoofPlane = {
      centroid: { x: centroidWorld.x, z: centroidWorld.z },
      referenceHeight: TECHNICAL_ROOF_REFERENCE_HEIGHT_M,
      tiltDeg: physical.tiltDeg,
      fallAzimuthDeg: physical.fallAzimuthDeg,
    };
    planes.set(roof.id, plane);
    roofPoints.set(roof.id, canonicalPoints);
    const vertices = canonicalPoints.map((point) => pointOnRoof(point, origin, snapshot.mppImage, plane));
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

  const marginBands = snapshot.roofs.flatMap((roof) => {
    const plane = planes.get(roof.id);
    const canonicalPoints = roofPoints.get(roof.id);
    if (!plane || !canonicalPoints) return [];
    const marginM = resolveRoofEdgeMarginM(roof, snapshot.standardMarginM);
    const edgeMarginsM = resolveRoofEdgeMarginsM(roof, marginM);
    const hasMargin = edgeMarginsM
      ? edgeMarginsM.some((value) => value > 0)
      : marginM > 0;
    if (!hasMargin) return [];
    const usable = computeUsableRoof({
      roofPolygonM: canonicalPoints.map((point) => ({
        x: point.x * snapshot.mppImage,
        y: point.y * snapshot.mppImage,
      })),
      marginM,
      edgeMarginsM,
    });
    if (usable.status === "invalid") return [];
    const toRoofPoint = (pointM: Pt) => pointOnRoof(
      { x: pointM.x / snapshot.mppImage, y: pointM.y / snapshot.mppImage },
      origin,
      snapshot.mppImage,
      plane,
      TECHNICAL_MARGIN_CLEARANCE_M,
    );
    return [{
      roofId: roof.id,
      outer: canonicalPoints.map((point) => pointOnRoof(
        point,
        origin,
        snapshot.mppImage,
        plane,
        TECHNICAL_MARGIN_CLEARANCE_M,
      )),
      usableComponents: usable.components.map((component) => component.map(toRoofPoint)),
      marginM,
      edgeMarginsM,
    }];
  });

  const selectedPanels = new Set(snapshot.selectedPanelIds ?? []);
  const panelSpecs = new Map(snapshot.panelSpecs.map((spec) => [spec.id, spec]));
  const panels: Planner3DPanel[] = snapshot.panels.flatMap((panel) => {
    const plane = planes.get(panel.roofId);
    if (!plane) return [];
    const planCorners = panelPlanCorners(panel);
    const worldCorners = planCorners.map((point) => plannerPointToWorld(point, origin, snapshot.mppImage));
    const center = pointOnRoof(
      { x: panel.cx, y: panel.cy },
      origin,
      snapshot.mppImage,
      plane,
      TECHNICAL_PANEL_CLEARANCE_M,
    );
    const faceAzimuthDeg = panel.advanced?.moduleFaceAzimuthDeg;
    // Standard Schrägdach modules remain parallel to their owner roof. Only an
    // Advanced mounting system supplies an independent physical face and tilt.
    const ownTiltDeg = panel.advanced?.effectiveTiltDeg;
    const followsRoof = ownTiltDeg == null;
    const tiltDeg = followsRoof ? plane.tiltDeg : ownTiltDeg;
    const face = faceAzimuthDeg == null ? undefined : azimuthToWorldDirection(faceAzimuthDeg);
    const spec = panelSpecs.get(panel.panelId);
    const widthM = spec
      ? (panel.orientation === "portrait" ? spec.widthM : spec.heightM)
      : panel.wPx * snapshot.mppImage;
    const heightM = spec
      ? (panel.orientation === "portrait" ? spec.heightM : spec.widthM)
      : panel.hPx * snapshot.mppImage;
    const corners = followsRoof
      ? physicalStandardPanelCorners({ panel, center, plane, widthM, heightM })
      : worldCorners.map((corner): Vec3 => ({
          ...corner,
          y: center.y - ((corner.x - center.x) * (face?.x ?? 0) + (corner.z - center.z) * (face?.z ?? 0)) * Math.tan((tiltDeg * Math.PI) / 180),
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
      return pointOnRoof(point, origin, snapshot.mppImage, plane, 0.02);
    });
    const top = base.map((point) => ({ ...point, y: point.y + TECHNICAL_OBSTACLE_HEIGHT_M }));
    return [{ id: obstacle.id, roofId: obstacle.roofId, base, top, triangles: triangulatePolygon(base), displayHeightM: TECHNICAL_OBSTACLE_HEIGHT_M }];
  });

  const snowGuards = snapshot.snowGuards.flatMap((guard) => {
    const plane = planes.get(guard.roofId);
    if (!plane) return [];
    const convert = (point: Pt): Vec3 => {
      return pointOnRoof(point, origin, snapshot.mppImage, plane, 0.05);
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
    marginBands,
    obstacles,
    snowGuards,
    bounds: calculateBounds(points),
  });
}
