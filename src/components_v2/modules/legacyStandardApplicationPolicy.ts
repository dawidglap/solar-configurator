import type {
  LegacyPoint,
  LegacyReservedZone,
  LegacySnowGuard,
  LegacyStandardFilterPolicy,
} from "@/lib/planning-core/legacy-standard";
import { resolveLegacyStandardCanvasAngle } from "@/lib/planning-core/legacy-standard";
import {
  getCanonicalLeftEndOfEdge,
  getCanonicalRoofEdges,
  resolveRoofReferenceEdgeIndex,
} from "@/lib/planning-core/geometry-v2";

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

export function resolveStandardAutoLayoutSpacingAxes(input: {
  spacingM: unknown;
  spacingXM?: unknown;
  spacingYM?: unknown;
}): { x: number; y: number } {
  const fallback = resolveStandardAutoLayoutSpacingM(input.spacingM);
  return {
    x:
      typeof input.spacingXM === "number" && Number.isFinite(input.spacingXM)
        ? input.spacingXM
        : fallback,
    y:
      typeof input.spacingYM === "number" && Number.isFinite(input.spacingYM)
        ? input.spacingYM
        : fallback,
  };
}

export function resolveStandardAutoLayoutCanvasAngle(input: {
  roofId: string;
  roofPolygon: LegacyPoint[];
  legacyRoofAzimuthDeg?: number;
  gridAngleDeg?: number;
  perRoofAngles?: Readonly<Record<string, number | undefined>> | null;
  referenceEdgeIndex?: number;
}): number {
  const roofOverrideDeg = input.perRoofAngles?.[input.roofId];
  if (typeof roofOverrideDeg === "number") return roofOverrideDeg;

  const edges = getCanonicalRoofEdges(input.roofPolygon);
  const referenceIndex = resolveRoofReferenceEdgeIndex({
    points: input.roofPolygon,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: "pitched",
  });
  const edge = referenceIndex == null ? undefined : edges[referenceIndex];
  if (edge) {
    const left = getCanonicalLeftEndOfEdge(edge);
    const right = left === edge.start ? edge.end : edge.start;
    return (
      (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI +
      (typeof input.gridAngleDeg === "number" ? input.gridAngleDeg : 0)
    );
  }

  return resolveLegacyStandardCanvasAngle({
    roofPolygon: input.roofPolygon,
    legacyRoofAzimuthDeg: input.legacyRoofAzimuthDeg,
    gridAngleDeg: input.gridAngleDeg,
  });
}

export type StandardAutoLayoutReferenceFrame = {
  origin: LegacyPoint;
  alongFirst: LegacyPoint;
  downhill: LegacyPoint;
};

/**
 * Defines the application-level traversal frame for a new Standard layout.
 * Geometry generation remains legacy-v1; only deterministic materialization
 * order is adapted to the roof's physical First/fall semantics.
 */
export function resolveStandardAutoLayoutReferenceFrame(input: {
  roofPolygon: LegacyPoint[];
  referenceEdgeIndex?: number;
  fallAzimuthDeg?: number;
}): StandardAutoLayoutReferenceFrame | undefined {
  const edges = getCanonicalRoofEdges(input.roofPolygon);
  const referenceIndex = resolveRoofReferenceEdgeIndex({
    points: input.roofPolygon,
    requestedIndex: input.referenceEdgeIndex,
    roofKind: "pitched",
  });
  const edge = referenceIndex == null ? undefined : edges[referenceIndex];
  if (!edge) return undefined;

  const origin = getCanonicalLeftEndOfEdge(edge);
  const other = origin === edge.start ? edge.end : edge.start;
  const length = Math.hypot(other.x - origin.x, other.y - origin.y);
  if (!(length > 0)) return undefined;
  const alongFirst = {
    x: (other.x - origin.x) / length,
    y: (other.y - origin.y) / length,
  };
  const rightNormal = { x: -alongFirst.y, y: alongFirst.x };
  const fallAzimuthDeg = input.fallAzimuthDeg;
  if (typeof fallAzimuthDeg !== "number" || !Number.isFinite(fallAzimuthDeg)) {
    return { origin, alongFirst, downhill: rightNormal };
  }

  const radians = (fallAzimuthDeg * Math.PI) / 180;
  const requestedFall = { x: Math.sin(radians), y: -Math.cos(radians) };
  const useRightNormal =
    rightNormal.x * requestedFall.x + rightNormal.y * requestedFall.y >= 0;
  return {
    origin,
    alongFirst,
    downhill: useRightNormal
      ? rightNormal
      : { x: -rightNormal.x, y: -rightNormal.y },
  };
}

export function orderStandardAutoLayoutPlacements<
  T extends { cx: number; cy: number },
>(
  placements: readonly T[],
  input: {
    roofPolygon: LegacyPoint[];
    referenceEdgeIndex?: number;
    fallAzimuthDeg?: number;
  },
): T[] {
  const frame = resolveStandardAutoLayoutReferenceFrame(input);
  if (!frame) return [...placements];
  const project = (point: T) => {
    const dx = point.cx - frame.origin.x;
    const dy = point.cy - frame.origin.y;
    return {
      downhill: dx * frame.downhill.x + dy * frame.downhill.y,
      along: dx * frame.alongFirst.x + dy * frame.alongFirst.y,
    };
  };
  return [...placements].sort((a, b) => {
    const pa = project(a);
    const pb = project(b);
    const downhillDifference = pa.downhill - pb.downhill;
    if (Math.abs(downhillDifference) > 1e-6) return downhillDifference;
    return pa.along - pb.along;
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
