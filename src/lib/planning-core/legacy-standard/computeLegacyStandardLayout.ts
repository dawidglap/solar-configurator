import { legacyRectIntersectsPolygon, legacyRectIntersectsSegment } from "./collision";
import {
  computeLegacyStandardCandidates,
  computeMaximizedLegacyStandardCandidates,
} from "./generateLegacyStandardCandidates";
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

function normalizedPhase(value: number): number {
  const phase = value % 1;
  return phase < 0 ? phase + 1 : phase;
}

function optimizedCandidates(current: number | undefined): number[] {
  const values = [normalizedPhase(current ?? 0)];
  for (let index = 0; index < 8; index += 1) values.push(index / 8);
  return values.filter((value, index) =>
    values.findIndex((candidate) => Math.abs(candidate - value) < 1e-9) === index,
  );
}

/** Pure deterministic optimizer reserved for the explicit Vollbelegung action. */
export function computeMaximumLegacyStandardLayout(
  input: LegacyStandardLayoutInput,
): LegacyStandardLayoutResult & { phaseX: number; phaseY: number; candidatesEvaluated: number } {
  const phasesX = optimizedCandidates(input.generation.phaseX);
  const phasesY = optimizedCandidates(input.generation.phaseY);
  let best: (LegacyStandardLayoutResult & { phaseX: number; phaseY: number }) | null = null;
  let evaluated = 0;

  for (const phaseY of phasesY) {
    for (const phaseX of phasesX) {
      evaluated += 1;
      const candidates = computeMaximizedLegacyStandardCandidates({
        ...input.generation,
        phaseX,
        phaseY,
      });
      let reservedZone = 0;
      let snowGuard = 0;
      const placements = candidates.filter((candidate) => {
        if (input.filterPolicy.reservedZones && input.reservedZones.some((zone) =>
          legacyRectIntersectsPolygon(candidate, zone.points))) {
          reservedZone += 1;
          return false;
        }
        if (input.filterPolicy.snowGuards && input.snowGuards.some((guard) =>
          legacyRectIntersectsSegment(candidate, guard.p1, guard.p2))) {
          snowGuard += 1;
          return false;
        }
        return true;
      });
      const candidate = {
        engineVersion: LEGACY_STANDARD_ENGINE_VERSION,
        candidates,
        placements,
        count: placements.length,
        rejected: { reservedZone, snowGuard },
        phaseX,
        phaseY,
      };
      if (!best || candidate.count > best.count) best = candidate;
    }
  }
  return { ...best!, candidatesEvaluated: evaluated };
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
