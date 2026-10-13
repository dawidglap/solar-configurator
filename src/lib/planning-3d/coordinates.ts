import type { Pt } from "@/types/planner";
import type { Vec3 } from "./types";

/**
 * Canonical 3D convention: image X -> world X (east/right), image Y -> world Z
 * (south/down), and world Y is vertical. This conversion only uses m/px and
 * never the Konva viewport zoom, pan, rotation, or screen coordinates.
 */
export function plannerPointToWorld(
  point: Pt,
  origin: Pt,
  mppImage: number,
  y = 0,
): Vec3 {
  return {
    x: (point.x - origin.x) * mppImage,
    y,
    z: (point.y - origin.y) * mppImage,
  };
}

/** Geographic azimuth: 0=N (-Z), 90=E (+X), 180=S (+Z). */
export function azimuthToWorldDirection(azimuthDeg: number): Readonly<{ x: number; z: number }> {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), z: -Math.cos(radians) };
}

export function averagePoint(points: readonly Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
