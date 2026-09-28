export type SnowProtectionPoint = {
  x: number;
  y: number;
};

export type SnowProtectionSegment = {
  roofId: string;
  p1: SnowProtectionPoint;
  p2: SnowProtectionPoint;
};

export type SnowProtectionRoofSummary = {
  roofId: string;
  lengthM: number;
};

export type SnowProtectionSummary = {
  totalLengthM: number;
  byRoof: SnowProtectionRoofSummary[];
};

export type ManualSnowProtectionSegment = {
  id: string;
  roofId?: string;
  lengthM: number;
};

export type SnowProtectionConfiguration = {
  quantityMode: "geometry" | "manual";
  manualSegments: ManualSnowProtectionSegment[];
};

type SnowProtectionSummaryInput = {
  snowGuards: readonly unknown[] | null | undefined;
  mppImage: unknown;
  roofIds?: readonly unknown[] | null;
};

type ResolvedSnowProtectionSummaryInput = SnowProtectionSummaryInput & {
  snowProtection: unknown;
};

const SUMMARY_DECIMAL_PLACES = 12;

function normalizeSummaryMetres(value: number): number {
  return Number(value.toFixed(SUMMARY_DECIMAL_PLACES));
}

export function normalizeSnowProtectionConfiguration(
  value: unknown,
): SnowProtectionConfiguration {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const rawSegments = Array.isArray(candidate.manualSegments)
    ? candidate.manualSegments
    : Array.isArray(candidate.segments)
      ? candidate.segments
      : [];
  const manualSegments = rawSegments.flatMap((raw): ManualSnowProtectionSegment[] => {
    if (!raw || typeof raw !== "object") return [];
    const segment = raw as Record<string, unknown>;
    const lengthM = Number(segment.lengthM);
    if (
      typeof segment.id !== "string" ||
      !segment.id ||
      !Number.isFinite(lengthM) ||
      lengthM < 0
    ) {
      return [];
    }
    return [{
      id: segment.id,
      ...(typeof segment.roofId === "string" && segment.roofId
        ? { roofId: segment.roofId }
        : {}),
      lengthM,
    }];
  });

  return {
    quantityMode:
      candidate.quantityMode === "manual" ||
      (candidate.quantityMode !== "geometry" && manualSegments.length > 0)
        ? "manual"
        : "geometry",
    manualSegments,
  };
}

function isFinitePoint(value: unknown): value is SnowProtectionPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}

function isSnowProtectionSegment(value: unknown): value is SnowProtectionSegment {
  if (!value || typeof value !== "object") return false;
  const segment = value as Record<string, unknown>;
  return (
    typeof segment.roofId === "string" &&
    segment.roofId.length > 0 &&
    isFinitePoint(segment.p1) &&
    isFinitePoint(segment.p2)
  );
}

/**
 * Canonical physical length for one persisted Schneefang segment.
 *
 * Segment coordinates live in snapshot-image space, so only the immutable
 * image scale participates in the conversion. Canvas zoom, pan and rotation
 * are intentionally not inputs.
 */
export function snowProtectionSegmentLengthM(
  segment: Pick<SnowProtectionSegment, "p1" | "p2">,
  mppImage: number,
): number {
  if (!(mppImage > 0) || !Number.isFinite(mppImage)) return 0;
  if (!isFinitePoint(segment.p1) || !isFinitePoint(segment.p2)) return 0;

  return Math.hypot(
    segment.p2.x - segment.p1.x,
    segment.p2.y - segment.p1.y,
  ) * mppImage;
}

/**
 * Builds the project-wide and per-roof Schneefang quantity from canonical
 * geometry. No stored segment total is read. Segment geometry stays at full
 * precision; the returned aggregate only removes sub-picometre float noise.
 */
export function summarizeSnowProtection({
  snowGuards,
  mppImage,
  roofIds,
}: SnowProtectionSummaryInput): SnowProtectionSummary {
  const scale =
    typeof mppImage === "number" && Number.isFinite(mppImage) && mppImage > 0
      ? mppImage
      : 0;
  const knownRoofIds = Array.isArray(roofIds)
    ? [
        ...new Set(
          roofIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : null;
  const knownRoofSet = knownRoofIds ? new Set(knownRoofIds) : null;
  const lengthByRoof = new Map<string, number>(
    (knownRoofIds ?? []).map((roofId) => [roofId, 0]),
  );

  if (scale > 0 && Array.isArray(snowGuards)) {
    for (const candidate of snowGuards) {
      if (!isSnowProtectionSegment(candidate)) continue;
      if (knownRoofSet && !knownRoofSet.has(candidate.roofId)) continue;

      const lengthM = snowProtectionSegmentLengthM(candidate, scale);
      lengthByRoof.set(
        candidate.roofId,
        (lengthByRoof.get(candidate.roofId) ?? 0) + lengthM,
      );
    }
  }

  const byRoof = [...lengthByRoof].map(([roofId, lengthM]) => ({
    roofId,
    lengthM: normalizeSummaryMetres(lengthM),
  }));

  return {
    totalLengthM: normalizeSummaryMetres(
      byRoof.reduce((total, roof) => total + roof.lengthM, 0),
    ),
    byRoof,
  };
}

export function summarizeManualSnowProtection(
  manualSegments: readonly ManualSnowProtectionSegment[],
  roofIds?: readonly unknown[] | null,
): SnowProtectionSummary {
  const knownRoofIds = Array.isArray(roofIds)
    ? [
        ...new Set(
          roofIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : null;
  const knownRoofSet = knownRoofIds ? new Set(knownRoofIds) : null;
  const onlyRoofId = knownRoofIds?.length === 1 ? knownRoofIds[0] : undefined;
  const lengthByRoof = new Map<string, number>(
    (knownRoofIds ?? []).map((roofId) => [roofId, 0]),
  );

  for (const segment of manualSegments) {
    if (!Number.isFinite(segment.lengthM) || segment.lengthM < 0) continue;
    const roofId = segment.roofId || onlyRoofId;
    if (!roofId || (knownRoofSet && !knownRoofSet.has(roofId))) continue;
    lengthByRoof.set(
      roofId,
      (lengthByRoof.get(roofId) ?? 0) + segment.lengthM,
    );
  }

  const byRoof = [...lengthByRoof].map(([roofId, lengthM]) => ({
    roofId,
    lengthM: normalizeSummaryMetres(lengthM),
  }));

  return {
    totalLengthM: normalizeSummaryMetres(
      byRoof.reduce((total, roof) => total + roof.lengthM, 0),
    ),
    byRoof,
  };
}

/**
 * Explicit precedence contract: a persisted manual mode is an override of
 * geometric quantity. Geometry and manual quantities are never added.
 */
export function resolveSnowProtectionSummary({
  snowProtection,
  snowGuards,
  mppImage,
  roofIds,
}: ResolvedSnowProtectionSummaryInput): SnowProtectionSummary {
  const configuration = normalizeSnowProtectionConfiguration(snowProtection);
  if (configuration.quantityMode === "manual") {
    return summarizeManualSnowProtection(configuration.manualSegments, roofIds);
  }
  return summarizeSnowProtection({ snowGuards, mppImage, roofIds });
}

/**
 * Resolves current and legacy planning document shapes used by the API.
 */
export function deriveSnowProtectionSummaryFromPlanning(
  planning: unknown,
): SnowProtectionSummary {
  const doc = planning && typeof planning === "object"
    ? planning as Record<string, any>
    : {};
  const data = doc.data && typeof doc.data === "object" ? doc.data : {};
  const planner = data.planner && typeof data.planner === "object"
    ? data.planner
    : {};

  const snowGuards = Array.isArray(planner.snowGuards)
    ? planner.snowGuards
    : Array.isArray(data.snowGuards)
      ? data.snowGuards
      : [];
  const layers = Array.isArray(planner.layers)
    ? planner.layers
    : Array.isArray(data.layers)
      ? data.layers
      : [];
  const roofIds = layers
    .map((layer: any) => layer?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
  const mppImage =
    planner?.snapshot?.mppImage ??
    data?.snapshot?.mppImage ??
    data?.snapshotMppImage ??
    data?.mppImage;

  const snowProtection =
    planner.snowProtection ??
    data.snowProtection ??
    (Array.isArray(planner.snowSegments)
      ? { manualSegments: planner.snowSegments }
      : Array.isArray(data.snowSegments)
        ? { manualSegments: data.snowSegments }
        : undefined);

  return resolveSnowProtectionSummary({
    snowProtection,
    snowGuards,
    mppImage,
    roofIds,
  });
}

/**
 * Adds the CRM-facing contract to a planning resource without mutating the
 * persisted geometry or trusting a client-provided aggregate.
 */
export function withSnowProtectionSummary<
  T extends Record<string, any>,
>(planningResource: T, geometrySource: unknown = planningResource): T & {
  summary: Record<string, any> & { snowProtection: SnowProtectionSummary };
} {
  return {
    ...planningResource,
    summary: {
      ...(planningResource.summary && typeof planningResource.summary === "object"
        ? planningResource.summary
        : {}),
      snowProtection: deriveSnowProtectionSummaryFromPlanning(geometrySource),
    },
  };
}
