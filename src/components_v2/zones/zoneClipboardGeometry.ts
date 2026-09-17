import { translateRoofOwnedPolygon, type MetricPoint } from "@/lib/planning-core/geometry-v2";
import type { Zone } from "../state/slices/zonesSlice";

const PASTE_STEP_M = 0.2;
const MAX_SEARCH_STEPS = 12;

/**
 * Finds a deterministic, visible, roof-contained translation in physical
 * metres. The preferred cascade is down/right; if that leaves the owning
 * polygon, nearby lattice translations are tried without ever changing roof.
 */
export function findContainedObstaclePaste(input: {
  points: readonly MetricPoint[];
  ownerRoofPoints: readonly MetricPoint[];
  mppImage: number;
  pasteCount: number;
}): MetricPoint[] | undefined {
  if (!(input.mppImage > 0) || !Number.isFinite(input.mppImage)) return undefined;
  const stepPx = PASTE_STEP_M / input.mppImage;
  const preferredStep = Math.max(1, input.pasteCount + 1);
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = -MAX_SEARCH_STEPS; x <= MAX_SEARCH_STEPS; x += 1) {
    for (let y = -MAX_SEARCH_STEPS; y <= MAX_SEARCH_STEPS; y += 1) {
      if (x === 0 && y === 0) continue;
      candidates.push({ x, y });
    }
  }
  candidates.sort((first, second) => {
    const firstPreferred = (first.x - preferredStep) ** 2 + (first.y - preferredStep) ** 2;
    const secondPreferred = (second.x - preferredStep) ** 2 + (second.y - preferredStep) ** 2;
    const firstMagnitude = first.x ** 2 + first.y ** 2;
    const secondMagnitude = second.x ** 2 + second.y ** 2;
    return firstPreferred - secondPreferred ||
      firstMagnitude - secondMagnitude ||
      first.x - second.x ||
      first.y - second.y;
  });
  for (const candidate of candidates) {
    const translated = translateRoofOwnedPolygon({
      points: input.points,
      delta: { x: candidate.x * stepPx, y: candidate.y * stepPx },
      ownerRoofPoints: input.ownerRoofPoints,
    });
    if (translated.valid) return translated.points;
  }
  return undefined;
}

export function createContainedObstaclePaste(input: {
  source: Zone;
  ownerRoofPoints: readonly MetricPoint[];
  mppImage: number;
  pasteCount: number;
  createId: () => string;
}): Zone | undefined {
  const points = findContainedObstaclePaste({
    points: input.source.points,
    ownerRoofPoints: input.ownerRoofPoints,
    mppImage: input.mppImage,
    pasteCount: input.pasteCount,
  });
  if (!points) return undefined;
  return {
    ...input.source,
    id: input.createId(),
    roofId: input.source.roofId,
    points,
    ...(input.source.edgeReference
      ? { edgeReference: { ...input.source.edgeReference } }
      : {}),
  };
}
