import type { RoofArea } from "@/types/planner";
import { resolveCanonicalRoofReferenceEdge } from "@/lib/planning-core/geometry-v2";
import { resolveRoofFallAzimuth } from "../../roof/roofOrientation";

export function imageVectorFromGeographicAzimuth(azimuthDeg: number): {
  x: number;
  y: number;
} {
  const radians = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

function geographicAzimuthFromImageVector(vector: { x: number; y: number }): number {
  return normalizeAzimuth((Math.atan2(vector.x, -vector.y) * 180) / Math.PI);
}

function signedPolygonArea(points: readonly { x: number; y: number }[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

/**
 * Resolves one physical downhill direction for a pitched roof.
 *
 * A canonical geographic fall direction is authoritative. Legacy/manual roofs
 * without one use the normal of FIRST that points towards the roof interior.
 * The interior choice is independent from FIRST's endpoint order.
 */
export function resolvePitchedRoofDownhillAzimuth(
  roof: Pick<RoofArea, "points" | "referenceEdgeIndex" | "fallAzimuthDeg" | "azimuthDeg" | "source">,
): number | undefined {
  const canonical = resolveRoofFallAzimuth(roof);
  if (canonical !== undefined) return canonical;

  const first = resolveCanonicalRoofReferenceEdge({
    points: roof.points,
    requestedIndex: roof.referenceEdgeIndex,
    roofKind: "pitched",
  });
  if (!first) return undefined;

  const normalA = { x: -first.direction.y, y: first.direction.x };
  const useA = signedPolygonArea(roof.points) >= 0;
  return geographicAzimuthFromImageVector(useA
    ? normalA
    : { x: -normalA.x, y: -normalA.y });
}

/** Explicit physical directions override the legacy panel-rotation fallback. */
export function resolveModuleSlopeArrowAzimuth(input: {
  panelRotationCanvasDeg: number;
  physicalArrowAzimuthDeg?: number;
}): number | undefined {
  return resolvePanelLocalArrowAzimuth(
    input.physicalArrowAzimuthDeg ?? input.panelRotationCanvasDeg,
  );
}

export type BlockArrowMember = {
  id: string;
  blockKey?: string;
  cx: number;
  cy: number;
};

/**
 * Resolves the physical downhill direction for opposing module pairs.
 *
 * The result is deliberately derived from geometry rather than slot order or
 * the directed reference-edge tangent: each arrow points from the common
 * block centre towards its own module centre. Reversing an edge's endpoints
 * therefore cannot invert the physical East/West semantics.
 */
export function resolveOutwardBlockArrowAzimuths(
  members: readonly BlockArrowMember[],
): ReadonlyMap<string, number> {
  const byBlock = new Map<string, BlockArrowMember[]>();
  for (const member of members) {
    if (!member.blockKey) continue;
    const group = byBlock.get(member.blockKey);
    if (group) group.push(member);
    else byBlock.set(member.blockKey, [member]);
  }

  const result = new Map<string, number>();
  for (const group of byBlock.values()) {
    if (group.length < 2) continue;
    const center = group.reduce(
      (sum, member) => ({
        x: sum.x + member.cx / group.length,
        y: sum.y + member.cy / group.length,
      }),
      { x: 0, y: 0 },
    );
    for (const member of group) {
      const dx = member.cx - center.x;
      const dy = member.cy - center.y;
      if (Math.hypot(dx, dy) <= 1e-9) continue;
      // Canvas/image vector for geographic azimuth a is (sin(a), -cos(a)).
      result.set(member.id, normalizeAzimuth((Math.atan2(dx, -dy) * 180) / Math.PI));
    }
  }
  return result;
}

/**
 * Legacy flat-roof fallback: a panel is rendered around its centre with its
 * forward/top on local -Y, so its canvas rotation is also the arrow azimuth.
 * Schrägdach must instead pass its explicit physical roof-downhill azimuth via
 * resolveModuleSlopeArrowAzimuth; panel rotation is not slope semantics there.
 */
export function resolvePanelLocalArrowAzimuth(panelRotationCanvasDeg: number): number | undefined {
  return Number.isFinite(panelRotationCanvasDeg)
    ? normalizeAzimuth(panelRotationCanvasDeg)
    : undefined;
}
