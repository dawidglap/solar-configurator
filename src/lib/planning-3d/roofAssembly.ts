export const ROOF_CONNECTIVITY_TOLERANCE_M = 0.002;

type PlanPoint = Readonly<{ x: number; z: number }>;

export type RoofAssemblyFacet = Readonly<{
  id: string;
  planVertices: readonly PlanPoint[];
  heightAtNeutral: (point: PlanPoint) => number;
}>;

export type RoofAssemblyConnection = Readonly<{
  roofAId: string;
  roofBId: string;
  start: PlanPoint;
  end: PlanPoint;
  errorBeforeM: number;
  errorAfterM: number;
}>;

export type RoofAssemblyResult = Readonly<{
  elevationOffsetsM: ReadonlyMap<string, number>;
  connections: readonly RoofAssemblyConnection[];
}>;

type SharedSegment = Readonly<{ start: PlanPoint; end: PlanPoint }>;

function subtract(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x - b.x, z: a.z - b.z };
}

function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function dot(a: PlanPoint, b: PlanPoint): number {
  return a.x * b.x + a.z * b.z;
}

function cross(a: PlanPoint, b: PlanPoint): number {
  return a.x * b.z - a.z * b.x;
}

function pointOnLine(origin: PlanPoint, direction: PlanPoint, distanceAlong: number): PlanPoint {
  return {
    x: origin.x + direction.x * distanceAlong,
    z: origin.z + direction.z * distanceAlong,
  };
}

function sharedCollinearSegment(
  a0: PlanPoint,
  a1: PlanPoint,
  b0: PlanPoint,
  b1: PlanPoint,
  toleranceM: number,
): SharedSegment | undefined {
  const aVector = subtract(a1, a0);
  const bVector = subtract(b1, b0);
  const aLength = Math.hypot(aVector.x, aVector.z);
  const bLength = Math.hypot(bVector.x, bVector.z);
  if (aLength <= toleranceM || bLength <= toleranceM) return undefined;
  const aDirection = { x: aVector.x / aLength, z: aVector.z / aLength };
  const bDirection = { x: bVector.x / bLength, z: bVector.z / bLength };
  if (Math.abs(cross(aDirection, bDirection)) > toleranceM / Math.min(aLength, bLength)) {
    return undefined;
  }
  const b0FromA = subtract(b0, a0);
  const b1FromA = subtract(b1, a0);
  if (
    Math.abs(cross(aDirection, b0FromA)) > toleranceM ||
    Math.abs(cross(aDirection, b1FromA)) > toleranceM
  ) return undefined;

  const bStart = dot(b0FromA, aDirection);
  const bEnd = dot(b1FromA, aDirection);
  const overlapStart = Math.max(0, Math.min(bStart, bEnd));
  const overlapEnd = Math.min(aLength, Math.max(bStart, bEnd));
  if (overlapEnd - overlapStart <= toleranceM) return undefined;
  return {
    start: pointOnLine(a0, aDirection, overlapStart),
    end: pointOnLine(a0, aDirection, overlapEnd),
  };
}

function sharedSegments(
  first: RoofAssemblyFacet,
  second: RoofAssemblyFacet,
  toleranceM: number,
): SharedSegment[] {
  const result: SharedSegment[] = [];
  first.planVertices.forEach((a0, aIndex) => {
    const a1 = first.planVertices[(aIndex + 1) % first.planVertices.length];
    second.planVertices.forEach((b0, bIndex) => {
      const b1 = second.planVertices[(bIndex + 1) % second.planVertices.length];
      const shared = sharedCollinearSegment(a0, a1, b0, b1, toleranceM);
      if (!shared) return;
      const duplicate = result.some((candidate) =>
        (distance(candidate.start, shared.start) <= toleranceM && distance(candidate.end, shared.end) <= toleranceM) ||
        (distance(candidate.start, shared.end) <= toleranceM && distance(candidate.end, shared.start) <= toleranceM),
      );
      if (!duplicate) result.push(shared);
    });
  });
  return result;
}

type Constraint = Readonly<{
  roofAId: string;
  roofBId: string;
  valueM: number;
}>;

function connectedComponents(
  facets: readonly RoofAssemblyFacet[],
  segments: readonly (SharedSegment & { roofAId: string; roofBId: string })[],
): string[][] {
  const neighbours = new Map(facets.map((facet) => [facet.id, new Set<string>()]));
  segments.forEach((segment) => {
    neighbours.get(segment.roofAId)?.add(segment.roofBId);
    neighbours.get(segment.roofBId)?.add(segment.roofAId);
  });
  const visited = new Set<string>();
  return facets.flatMap((facet) => {
    if (visited.has(facet.id)) return [];
    const component: string[] = [];
    const queue = [facet.id];
    visited.add(facet.id);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      neighbours.get(current)?.forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push(next);
      });
    }
    return [component];
  });
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) continue;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => Number.isFinite(row[size]) ? row[size] : 0);
}

function solveComponentOffsets(component: readonly string[], constraints: readonly Constraint[]): Map<string, number> {
  const offsets = new Map<string, number>();
  if (!component.length) return offsets;
  offsets.set(component[0], 0);
  if (component.length === 1) return offsets;
  const unknownIds = component.slice(1);
  const indexById = new Map(unknownIds.map((id, index) => [id, index]));
  const size = unknownIds.length;
  const normal = Array.from({ length: size }, () => Array(size).fill(0) as number[]);
  const right = Array(size).fill(0) as number[];
  constraints.forEach((constraint) => {
    const coefficients = new Map<number, number>();
    const aIndex = indexById.get(constraint.roofAId);
    const bIndex = indexById.get(constraint.roofBId);
    if (aIndex !== undefined) coefficients.set(aIndex, -1);
    if (bIndex !== undefined) coefficients.set(bIndex, 1);
    coefficients.forEach((leftValue, leftIndex) => {
      right[leftIndex] += leftValue * constraint.valueM;
      coefficients.forEach((rightValue, rightIndex) => {
        normal[leftIndex][rightIndex] += leftValue * rightValue;
      });
    });
  });
  const solved = solveLinearSystem(normal, right);
  unknownIds.forEach((id, index) => offsets.set(id, solved[index] ?? 0));
  return offsets;
}

/** Derives render-only vertical offsets while preserving every facet's plan geometry and slope. */
export function assembleConnectedRoofFacets(
  facets: readonly RoofAssemblyFacet[],
  neutralHeightM: number,
  toleranceM = ROOF_CONNECTIVITY_TOLERANCE_M,
): RoofAssemblyResult {
  const byId = new Map(facets.map((facet) => [facet.id, facet]));
  const segments: Array<SharedSegment & { roofAId: string; roofBId: string }> = [];
  for (let firstIndex = 0; firstIndex < facets.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < facets.length; secondIndex += 1) {
      sharedSegments(facets[firstIndex], facets[secondIndex], toleranceM).forEach((segment) => {
        segments.push({ ...segment, roofAId: facets[firstIndex].id, roofBId: facets[secondIndex].id });
      });
    }
  }
  const constraints = segments.flatMap((segment): Constraint[] => {
    const first = byId.get(segment.roofAId)!;
    const second = byId.get(segment.roofBId)!;
    return [segment.start, segment.end].map((point) => ({
      roofAId: segment.roofAId,
      roofBId: segment.roofBId,
      valueM: first.heightAtNeutral(point) - second.heightAtNeutral(point),
    }));
  });
  const rawOffsets = new Map<string, number>();
  connectedComponents(facets, segments).forEach((component) => {
    const componentSet = new Set(component);
    solveComponentOffsets(
      component,
      constraints.filter((constraint) =>
        componentSet.has(constraint.roofAId) && componentSet.has(constraint.roofBId)),
    ).forEach((offset, id) => rawOffsets.set(id, offset));
  });
  const elevationOffsetsM = new Map(
    facets.map((facet) => [facet.id, neutralHeightM + (rawOffsets.get(facet.id) ?? 0)]),
  );
  const connections = segments.map((segment): RoofAssemblyConnection => {
    const first = byId.get(segment.roofAId)!;
    const second = byId.get(segment.roofBId)!;
    const before = (point: PlanPoint) => first.heightAtNeutral(point) - second.heightAtNeutral(point);
    const after = (point: PlanPoint) =>
      before(point) +
      (elevationOffsetsM.get(segment.roofAId) ?? neutralHeightM) -
      (elevationOffsetsM.get(segment.roofBId) ?? neutralHeightM);
    return {
      roofAId: segment.roofAId,
      roofBId: segment.roofBId,
      start: segment.start,
      end: segment.end,
      errorBeforeM: Math.max(Math.abs(before(segment.start)), Math.abs(before(segment.end))),
      errorAfterM: Math.max(Math.abs(after(segment.start)), Math.abs(after(segment.end))),
    };
  });
  return { elevationOffsetsM, connections };
}
