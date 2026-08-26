import type {
  LegacyPoint,
  LegacyReservedZone,
  LegacySnowGuard,
  LegacyStandardFilterPolicy,
} from "@/lib/planning-core/legacy-standard";
import { resolveLegacyStandardCanvasAngle } from "@/lib/planning-core/legacy-standard";

export const STANDARD_AUTO_LAYOUT_SPACING_M = 0.02;

export type StandardAutoLayoutApplicationPolicy = {
  filterPolicy: LegacyStandardFilterPolicy;
  nonEmpty: "replace";
  empty: "preserve";
};

export const STANDARD_AUTO_LAYOUT_POLICY: StandardAutoLayoutApplicationPolicy = {
  filterPolicy: { reservedZones: true, snowGuards: true },
  nonEmpty: "replace",
  empty: "preserve",
};

export function resolveStandardAutoLayoutCommitAction(
  placementCount: number,
): "replace" | "preserve" {
  return placementCount > 0
    ? STANDARD_AUTO_LAYOUT_POLICY.nonEmpty
    : STANDARD_AUTO_LAYOUT_POLICY.empty;
}

export function applyStandardAutoLayoutPanelCommit<T extends { roofId: string }>(args: {
  existingPanels: readonly T[];
  generatedPanels: readonly T[];
  roofId: string;
}): T[] {
  const action = resolveStandardAutoLayoutCommitAction(args.generatedPanels.length);

  if (action === "preserve") return [...args.existingPanels];
  return [
    ...args.existingPanels.filter((panel) => panel.roofId !== args.roofId),
    ...args.generatedPanels,
  ];
}

export function resolveStandardAutoLayoutSpacingM(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : STANDARD_AUTO_LAYOUT_SPACING_M;
}

export function resolveStandardAutoLayoutCanvasAngle(input: {
  roofId: string;
  roofPolygon: LegacyPoint[];
  legacyRoofAzimuthDeg?: number;
  gridAngleDeg?: number;
  perRoofAngles?: Readonly<Record<string, number | undefined>> | null;
}): number {
  const roofOverrideDeg = input.perRoofAngles?.[input.roofId];
  if (typeof roofOverrideDeg === "number") return roofOverrideDeg;

  return resolveLegacyStandardCanvasAngle({
    roofPolygon: input.roofPolygon,
    legacyRoofAzimuthDeg: input.legacyRoofAzimuthDeg,
    gridAngleDeg: input.gridAngleDeg,
  });
}

type ZoneLike = {
  roofId: string;
  type?: unknown;
  points?: LegacyPoint[];
};

type SnowGuardLike = {
  roofId: string;
  p1: LegacyPoint;
  p2: LegacyPoint;
};

export function selectLegacyStandardObstacles(
  zones: readonly ZoneLike[] | null | undefined,
  snowGuards: readonly SnowGuardLike[] | null | undefined,
  roofId: string,
): { reservedZones: LegacyReservedZone[]; snowGuards: LegacySnowGuard[] } {
  const safeZones = Array.isArray(zones) ? zones : [];
  const safeSnowGuards = Array.isArray(snowGuards) ? snowGuards : [];
  const reservedZones = safeZones
    .filter((zone) => {
      if (zone.roofId !== roofId) return false;
      const type = String(zone.type || "").toLowerCase();
      return type === "riservata" || type === "hindernis" || type === "reserved";
    })
    .map((zone) => ({ points: zone.points ?? [] }));

  return {
    reservedZones,
    snowGuards: safeSnowGuards
      .filter((guard) => guard.roofId === roofId)
      .map((guard) => ({ p1: guard.p1, p2: guard.p2 })),
  };
}
