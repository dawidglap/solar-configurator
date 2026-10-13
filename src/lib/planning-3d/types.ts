import type { PanelInstance, Pt, RoofArea } from "@/types/planner";

export type Planner3DZone = Readonly<{
  id: string;
  roofId: string;
  points: readonly Pt[];
}>;

export type Planner3DSnowGuardSource = Readonly<{
  id: string;
  roofId: string;
  p1: Pt;
  p2: Pt;
}>;

export type Planner3DSourceSnapshot = Readonly<{
  mppImage: number;
  roofs: readonly RoofArea[];
  panels: readonly PanelInstance[];
  obstacles: readonly Planner3DZone[];
  snowGuards: readonly Planner3DSnowGuardSource[];
  selectedRoofId?: string;
  selectedPanelIds?: readonly string[];
}>;

export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Triangle = readonly [number, number, number];

export type Planner3DRoof = Readonly<{
  id: string;
  kind: "pitched" | "flat" | "green";
  vertices: readonly Vec3[];
  triangles: readonly Triangle[];
  thicknessM: number;
  selected: boolean;
  tiltDeg: number;
  fallAzimuthDeg?: number;
}>;

export type Planner3DPanel = Readonly<{
  id: string;
  roofId: string;
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  thicknessM: number;
  selected: boolean;
  tiltDeg: number;
  faceAzimuthDeg?: number;
  blockKey?: string;
  slotIndex?: number;
}>;

export type Planner3DObstacle = Readonly<{
  id: string;
  roofId: string;
  base: readonly Vec3[];
  top: readonly Vec3[];
  triangles: readonly Triangle[];
  displayHeightM: number;
}>;

export type Planner3DSnowGuard = Readonly<{
  id: string;
  roofId: string;
  start: Vec3;
  end: Vec3;
  widthM: number;
  railHeightM: number;
}>;

export type Planner3DBounds = Readonly<{
  min: Vec3;
  max: Vec3;
}>;

export type Planner3DSceneModel = Readonly<{
  coordinateConvention: "image-x-to-world-x,image-y-to-world-z,vertical-to-world-y";
  referenceHeightStrategy: "per-roof-centroid-neutral-height";
  roofs: readonly Planner3DRoof[];
  panels: readonly Planner3DPanel[];
  obstacles: readonly Planner3DObstacle[];
  snowGuards: readonly Planner3DSnowGuard[];
  bounds: Planner3DBounds;
}>;
