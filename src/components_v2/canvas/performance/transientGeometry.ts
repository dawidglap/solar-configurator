export type InteractionPoint = { x: number; y: number };

export function translateInteractionPoints<T extends InteractionPoint>(
  points: readonly T[],
  delta: InteractionPoint,
): InteractionPoint[] {
  return points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));
}
