import { computeAutoLayoutRects } from "../../../components_v2/modules/layout";
import { legacyRectIntersectsPolygon, legacyRectIntersectsSegment } from "./collision";
import type {
  LegacyStandardCandidate,
  LegacyStandardLayoutInput,
  LegacyStandardLayoutResult,
} from "./types";

export const LEGACY_STANDARD_ENGINE_VERSION = "legacy-v1" as const;

/**
 * Phase 1A compatibility boundary: the frozen generation formulas still live in
 * components_v2/modules/layout.ts, which is itself pure TypeScript. A later,
 * separately approved phase can invert that dependency behind its legacy export.
 */
export function computeLegacyStandardLayout(
  input: LegacyStandardLayoutInput,
): LegacyStandardLayoutResult {
  const candidates: LegacyStandardCandidate[] = computeAutoLayoutRects({
    polygon: input.roofPolygon,
    mppImage: input.mppImage,
    azimuthDeg: input.canvasAngleDeg,
    orientation: input.orientation,
    panelSizeM: {
      w: input.panelSizeM.widthM,
      h: input.panelSizeM.heightM,
    },
    spacingM: input.spacingM,
    marginM: input.marginM,
    phaseX: input.phaseX,
    phaseY: input.phaseY,
    anchorX: input.anchorX,
    anchorY: input.anchorY,
    coverageRatio: input.coverageRatio,
  });

  let reservedZoneRejections = 0;
  let snowGuardRejections = 0;

  const placements = candidates.filter((candidate) => {
    if (
      input.filterPolicy.reservedZones &&
      input.reservedZones.some((zone) =>
        legacyRectIntersectsPolygon(candidate, zone.points),
      )
    ) {
      reservedZoneRejections += 1;
      return false;
    }

    if (
      input.filterPolicy.snowGuards &&
      input.snowGuards.some((guard) =>
        legacyRectIntersectsSegment(candidate, guard.p1, guard.p2),
      )
    ) {
      snowGuardRejections += 1;
      return false;
    }

    return true;
  });

  return {
    engineVersion: LEGACY_STANDARD_ENGINE_VERSION,
    candidates,
    placements,
    count: placements.length,
    rejected: {
      reservedZone: reservedZoneRejections,
      snowGuard: snowGuardRejections,
    },
  };
}
