import { legacyRectIntersectsPolygon, legacyRectIntersectsSegment } from "./collision";
import { computeLegacyStandardCandidates } from "./generateLegacyStandardCandidates";
import type {
  LegacyPoint,
  LegacyStandardLayoutInput,
  LegacyStandardLayoutResult,
} from "./types";

export const LEGACY_STANDARD_ENGINE_VERSION = "legacy-v1" as const;

export function computeLegacyStandardLayout(
  input: LegacyStandardLayoutInput,
): LegacyStandardLayoutResult {
  const candidates = computeLegacyStandardCandidates(input.generation);

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

export function resolveLegacyStandardCanvasAngle(input: {
  roofPolygon: LegacyPoint[];
  legacyRoofAzimuthDeg?: number;
  gridAngleDeg?: number;
}): number {
  const eavesCanvasDeg = -(input.legacyRoofAzimuthDeg ?? 0) + 90;
  let polygonAngleDeg = 0;
  let longestLengthSquared = -1;

  for (let index = 0; index < input.roofPolygon.length; index += 1) {
    const next = (index + 1) % input.roofPolygon.length;
    const dx = input.roofPolygon[next].x - input.roofPolygon[index].x;
    const dy = input.roofPolygon[next].y - input.roofPolygon[index].y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared > longestLengthSquared) {
      longestLengthSquared = lengthSquared;
      polygonAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }

  const normalize = (degrees: number) => {
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  };
  const difference = Math.abs(normalize(eavesCanvasDeg - polygonAngleDeg));
  const smallestDifference = difference > 180 ? 360 - difference : difference;
  const baseCanvasAngleDeg =
    smallestDifference > 5 ? polygonAngleDeg : eavesCanvasDeg;

  return baseCanvasAngleDeg + (input.gridAngleDeg || 0);
}
