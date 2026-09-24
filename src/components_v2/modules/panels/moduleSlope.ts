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

/** Explicit flat-system directions override the panel-local fallback. */
export function resolveModuleSlopeArrowAzimuth(input: {
  panelRotationCanvasDeg: number;
  physicalArrowAzimuthDeg?: number;
}): number | undefined {
  return resolvePanelLocalArrowAzimuth(
    input.physicalArrowAzimuthDeg ?? input.panelRotationCanvasDeg,
  );
}

/**
 * Resolves the physical FIRST-to-Traufe direction independently from any
 * panel orientation. The canonical FIRST frame has local +Y facing into the
 * roof; the Konva arrow azimuth for that direction is frame + 180 degrees.
 */
export function resolvePitchedRoofArrowAzimuth(input: {
  roofPolygon: Array<{ x: number; y: number }>;
  referenceEdgeIndex?: number;
}): number | undefined {
  const firstFrameDeg = resolveStandardFirstFrameCanvasAngle({
    roofPolygon: input.roofPolygon,
    referenceEdgeIndex: input.referenceEdgeIndex,
  });
  return firstFrameDeg == null ? undefined : normalizeAzimuth(firstFrameDeg + 180);
}

export type BlockArrowMember = {
  id: string;
  blockKey?: string;
  slotIndex?: number;
  cx: number;
  cy: number;
};

/**
 * Resolves the two opposing East-West directions from the selected physical
 * Referenzkante. Panel positions and rotations deliberately do not participate.
 */
export function resolveReferenceEdgeOpposingArrowAzimuths(input: {
  members: readonly BlockArrowMember[];
  roofPolygon: Array<{ x: number; y: number }>;
  referenceEdgeIndex?: number;
}): ReadonlyMap<string, number> {
  const edge = resolveCanonicalRoofReferenceEdge({
    points: input.roofPolygon,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: "flat",
  });
  if (!edge) return new Map();
  const result = new Map<string, number>();
  for (const member of input.members) {
    if (!Number.isInteger(member.slotIndex)) continue;
    result.set(
      member.id,
      normalizeAzimuth(edge.geographicAzimuthDeg + ((member.slotIndex as number) % 2) * 180),
    );
  }
  return result;
}

/** South-facing flat systems use the inward normal of the Referenzkante. */
export function resolveFlatSouthArrowAzimuth(input: {
  roofPolygon: Array<{ x: number; y: number }>;
  referenceEdgeIndex?: number;
}): number | undefined {
  const edge = resolveCanonicalRoofReferenceEdge({
    points: input.roofPolygon,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: "flat",
  });
  if (!edge) return undefined;
  return resolveRoofEdgeInwardNormal({
    roofPoints: input.roofPolygon,
    edge,
  })?.geographicAzimuthDeg;
}

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
 * Legacy fallback for documents without a canonical roof/system arrow source.
 * New pitched and supported flat-system paths pass physicalArrowAzimuthDeg.
 */
export function resolvePanelLocalArrowAzimuth(panelRotationCanvasDeg: number): number | undefined {
  return Number.isFinite(panelRotationCanvasDeg)
    ? normalizeAzimuth(panelRotationCanvasDeg)
    : undefined;
}

/**
 * D-Dome is the flat-system exception whose downhill arrow is rigidly attached
 * to each module face. The generated slot rotations already encode the two
 * opposed downhill directions, so subsequent whole-layout rotations must use
 * the current panel rotation instead of re-resolving from the Referenzkante.
 */
export function resolveDDomeLocalArrowAzimuth(
  panelRotationCanvasDeg: number,
): number | undefined {
  return resolvePanelLocalArrowAzimuth(panelRotationCanvasDeg);
}
import {
  resolveCanonicalRoofReferenceEdge,
} from "@/lib/planning-core/geometry-v2";
import { resolveRoofEdgeInwardNormal } from "@/lib/planning-core/advanced";
import { resolveStandardFirstFrameCanvasAngle } from "../legacyStandardApplicationPolicy";
