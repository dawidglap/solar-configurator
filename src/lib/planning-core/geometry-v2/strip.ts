import type { MetricPoint, MetricPolygon } from "./types";

export const SNOW_GUARD_WIDTH_M = 0.3;

/**
 * Rectangle with flat ends whose long axis is exactly start -> end.
 * `width` uses the same coordinate unit as the supplied points.
 */
export function createButtEndedStripPolygon(input: {
  start: MetricPoint;
  end: MetricPoint;
  width: number;
}): MetricPolygon {
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (
    !Number.isFinite(input.width) ||
    input.width <= 0 ||
    !Number.isFinite(length) ||
    length <= 1e-12
  ) return [];

  const halfWidth = input.width / 2;
  const normal = {
    x: (-dy / length) * halfWidth,
    y: (dx / length) * halfWidth,
  };
  return [
    { x: input.start.x + normal.x, y: input.start.y + normal.y },
    { x: input.end.x + normal.x, y: input.end.y + normal.y },
    { x: input.end.x - normal.x, y: input.end.y - normal.y },
    { x: input.start.x - normal.x, y: input.start.y - normal.y },
  ];
}
