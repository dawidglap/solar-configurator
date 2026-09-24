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
  /** Stable physical face identity persisted on Advanced panel instances. */
  moduleFaceAzimuthDeg?: number;
  cx: number;
  cy: number;
};

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
    // An East-West/D-Dome block has exactly two faces sharing one ridge.
    // Keep the established centre-to-module geometry for complete pairs so
    // their initial rendering is unchanged. A user may deliberately delete
    // either physical module, however; in that partial state the survivor's
    // persisted face azimuth is authoritative and must not be re-inferred or
    // renumbered from the remaining array membership.
    if (group.length !== 2) {
      for (const member of group) {
        if (Number.isFinite(member.moduleFaceAzimuthDeg)) {
          result.set(member.id, normalizeAzimuth(member.moduleFaceAzimuthDeg!));
        }
      }
      continue;
    }
    const center = {
      x: (group[0].cx + group[1].cx) / 2,
      y: (group[0].cy + group[1].cy) / 2,
    };
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

import {
  resolveCanonicalRoofReferenceEdge,
} from "@/lib/planning-core/geometry-v2";
import { resolveRoofEdgeInwardNormal } from "@/lib/planning-core/advanced";
import { resolveStandardFirstFrameCanvasAngle } from "../legacyStandardApplicationPolicy";
