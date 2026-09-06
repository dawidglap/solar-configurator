import {
  getCanonicalRoofEdges,
  resolveRoofReferenceEdgeIndex,
} from "@/lib/planning-core/geometry-v2";

export type BuildingRevealPoint = { x: number; y: number };

export type SonnendachRevealRoof = {
  id: string;
  points: BuildingRevealPoint[];
  sourceIndex: number;
  buildingId?: string;
  roofKind?: "pitched" | "flat" | "green";
  referenceEdgeIndex?: number;
  recommended?: boolean;
  sourceRank?: number;
  suitability?: string;
  irradiationKwhM2?: number;
  yearlyPvYieldKwh?: number;
};

export type BuildingRevealInsets = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type BuildingRevealCamera = {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
};

export type BuildingRevealTarget = BuildingRevealCamera & {
  primaryRoofId: string;
  referenceEdgeIndex: number;
};

const EPSILON = 1e-9;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalize180(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function normalizedSuitability(value: string | undefined): number | undefined {
  const text = value?.trim().toLocaleLowerCase("de-CH");
  if (!text) return undefined;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  if (text.includes("hervorragend") || text.includes("excellent")) return 5;
  if (text.includes("sehr gut") || text.includes("sehrgut") || text.includes("très bon")) return 4;
  if (text.includes("gut") || text.includes("good") || text.includes("bon")) return 3;
  if (text.includes("mittel") || text.includes("medium") || text.includes("moyen")) return 2;
  if (
    text.includes("genügend") ||
    text.includes("genuegend") ||
    text.includes("gering") ||
    text.includes("schlecht") ||
    text.includes("low")
  ) return 1;
  return undefined;
}

function hasUsableGeometry(roof: SonnendachRevealRoof): boolean {
  return getCanonicalRoofEdges(roof.points).length >= 3;
}

function compareDescendingOptional(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

/**
 * Selects the primary source roof without consulting panels or current UI
 * selection. Source recommendation/rank wins, followed by actual Sonnendach
 * suitability/energy metadata and finally stable source order.
 */
export function resolvePrimarySonnendachRoof(
  roofs: readonly SonnendachRevealRoof[],
): SonnendachRevealRoof | undefined {
  const candidates = roofs.filter(hasUsableGeometry);
  if (!candidates.length) return undefined;

  return [...candidates].sort((a, b) => {
    if (Boolean(a.recommended) !== Boolean(b.recommended)) {
      return a.recommended ? -1 : 1;
    }

    const rankA = finite(a.sourceRank) ? a.sourceRank : undefined;
    const rankB = finite(b.sourceRank) ? b.sourceRank : undefined;
    if (rankA !== undefined || rankB !== undefined) {
      if (rankA === undefined) return 1;
      if (rankB === undefined) return -1;
      if (Math.abs(rankA - rankB) > EPSILON) return rankA - rankB;
    }

    const suitability = compareDescendingOptional(
      normalizedSuitability(a.suitability),
      normalizedSuitability(b.suitability),
    );
    if (Math.abs(suitability) > EPSILON) return suitability;

    const irradiation = compareDescendingOptional(a.irradiationKwhM2, b.irradiationKwhM2);
    if (Math.abs(irradiation) > EPSILON) return irradiation;

    const yieldScore = compareDescendingOptional(a.yearlyPvYieldKwh, b.yearlyPvYieldKwh);
    if (Math.abs(yieldScore) > EPSILON) return yieldScore;

    if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Returns the horizontal-equivalent rotation nearest to the current camera. */
export function resolveHorizontalReferenceRotation(
  edgeCanvasAngleDeg: number,
  currentRotationDeg = 0,
): number {
  const base = -edgeCanvasAngleDeg;
  const candidates = [-2, -1, 0, 1, 2].map((turn) =>
    normalize180(base + turn * 180),
  );
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(normalize180(best - currentRotationDeg));
    const candidateDistance = Math.abs(normalize180(candidate - currentRotationDeg));
    if (candidateDistance < bestDistance - EPSILON) return candidate;
    if (Math.abs(candidateDistance - bestDistance) <= EPSILON) {
      return Math.abs(candidate) < Math.abs(best) ? candidate : best;
    }
    return best;
  });
}

function rotateAround(
  point: BuildingRevealPoint,
  center: BuildingRevealPoint,
  rotationDeg: number,
): BuildingRevealPoint {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  };
}

function boundsOf(points: readonly BuildingRevealPoint[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function computeBuildingRevealTarget(input: {
  roofs: readonly SonnendachRevealRoof[];
  image: { width: number; height: number };
  viewport: { width: number; height: number };
  insets: BuildingRevealInsets;
  currentRotationDeg?: number;
  minScale: number;
  maxScale: number;
  fillFraction?: number;
}): BuildingRevealTarget | undefined {
  const validRoofs = input.roofs.filter(hasUsableGeometry);
  const primary = resolvePrimarySonnendachRoof(validRoofs);
  if (!primary) return undefined;
  if (!(input.image.width > 0 && input.image.height > 0)) return undefined;

  const roofKind = primary.roofKind ?? "pitched";
  const referenceEdgeIndex = resolveRoofReferenceEdgeIndex({
    points: primary.points,
    requestedIndex: primary.referenceEdgeIndex,
    roofKind,
  });
  if (referenceEdgeIndex == null) return undefined;
  const referenceEdge = getCanonicalRoofEdges(primary.points).find(
    (edge) => edge.edgeIndex === referenceEdgeIndex,
  );
  if (!referenceEdge) return undefined;

  const rotationDeg = resolveHorizontalReferenceRotation(
    referenceEdge.canvasAngleDeg,
    input.currentRotationDeg ?? 0,
  );
  const imageCenter = { x: input.image.width / 2, y: input.image.height / 2 };
  const buildingRoofs = primary.buildingId
    ? validRoofs.filter((roof) => roof.buildingId === primary.buildingId)
    : validRoofs;
  const rotatedPoints = buildingRoofs.flatMap((roof) =>
    roof.points.map((point) => rotateAround(point, imageCenter, rotationDeg)),
  );
  const bounds = boundsOf(rotatedPoints);
  const boundsWidth = Math.max(EPSILON, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(EPSILON, bounds.maxY - bounds.minY);

  const usableWidth = Math.max(
    1,
    input.viewport.width - input.insets.left - input.insets.right,
  );
  const usableHeight = Math.max(
    1,
    input.viewport.height - input.insets.top - input.insets.bottom,
  );
  const fillFraction = Math.max(0.4, Math.min(0.78, input.fillFraction ?? 0.66));
  const rawScale = Math.min(
    (usableWidth * fillFraction) / boundsWidth,
    (usableHeight * fillFraction) / boundsHeight,
  );
  const scale = Math.max(input.minScale, Math.min(input.maxScale, rawScale));
  const usableCenter = {
    x: input.insets.left + usableWidth / 2,
    y: input.insets.top + usableHeight / 2,
  };
  const boundsCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  return {
    primaryRoofId: primary.id,
    referenceEdgeIndex,
    scale,
    offsetX: usableCenter.x - boundsCenter.x * scale,
    offsetY: usableCenter.y - boundsCenter.y * scale,
    rotationDeg,
  };
}

export function easeInOutCubic(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateBuildingRevealCamera(
  from: BuildingRevealCamera,
  to: BuildingRevealCamera,
  progress: number,
): BuildingRevealCamera {
  const t = easeInOutCubic(progress);
  const rotationDelta = normalize180(to.rotationDeg - from.rotationDeg);
  return {
    scale: from.scale + (to.scale - from.scale) * t,
    offsetX: from.offsetX + (to.offsetX - from.offsetX) * t,
    offsetY: from.offsetY + (to.offsetY - from.offsetY) * t,
    rotationDeg: normalize180(from.rotationDeg + rotationDelta * t),
  };
}
