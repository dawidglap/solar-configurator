import type {
  LegacyPoint,
  LegacyReservedZone,
  LegacySnowGuard,
  LegacyStandardFilterPolicy,
} from "@/lib/planning-core/legacy-standard";

export type LegacyStandardCommitMode = "replace" | "append";
export type LegacyStandardEmptyMode = "preserve" | "clear";
export type LegacyStandardCommitAction =
  | LegacyStandardCommitMode
  | LegacyStandardEmptyMode;

export type LegacyStandardApplicationPolicy = {
  filterPolicy: LegacyStandardFilterPolicy;
  nonEmpty: LegacyStandardCommitMode;
  empty: LegacyStandardEmptyMode;
};

export const TOP_TOOLBAR_LEGACY_POLICY: LegacyStandardApplicationPolicy = {
  filterPolicy: { reservedZones: true, snowGuards: true },
  nonEmpty: "replace",
  empty: "preserve",
};

export const MODULES_PANEL_LEGACY_POLICY: LegacyStandardApplicationPolicy = {
  filterPolicy: { reservedZones: true, snowGuards: false },
  nonEmpty: "replace",
  empty: "clear",
};

export const TOOL_HOTKEYS_LEGACY_POLICY: LegacyStandardApplicationPolicy = {
  filterPolicy: { reservedZones: true, snowGuards: false },
  nonEmpty: "append",
  empty: "preserve",
};

export function resolveLegacyStandardCommitAction(
  policy: LegacyStandardApplicationPolicy,
  placementCount: number,
): LegacyStandardCommitAction {
  return placementCount > 0 ? policy.nonEmpty : policy.empty;
}

export function applyLegacyStandardPanelCommit<T extends { roofId: string }>(args: {
  existingPanels: readonly T[];
  generatedPanels: readonly T[];
  roofId: string;
  policy: LegacyStandardApplicationPolicy;
}): T[] {
  const action = resolveLegacyStandardCommitAction(
    args.policy,
    args.generatedPanels.length,
  );

  if (action === "preserve") return [...args.existingPanels];
  if (action === "clear") {
    return args.existingPanels.filter((panel) => panel.roofId !== args.roofId);
  }
  if (action === "append") {
    return [...args.existingPanels, ...args.generatedPanels];
  }
  return [
    ...args.existingPanels.filter((panel) => panel.roofId !== args.roofId),
    ...args.generatedPanels,
  ];
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
