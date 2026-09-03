"use client";

import React from "react";
import { Group, Line, Rect } from "react-konva";

type Pt = { x: number; y: number };

export function RoofMarginBand({
  polygon,
  marginPx,
  innerPolygons = [],
  scale = 1,
}: {
  polygon: Pt[];
  marginPx: number; // in px immagine
  innerPolygons?: Pt[][];
  scale?: number;
}) {
  const isVisible = polygon.length >= 3 && Number.isFinite(marginPx) && marginPx > 0;

  const bounds = React.useMemo(
    () => {
      const firstPoint = polygon[0] ?? { x: 0, y: 0 };
      return polygon.reduce(
        (result, point) => ({
          minX: Math.min(result.minX, point.x),
          minY: Math.min(result.minY, point.y),
          maxX: Math.max(result.maxX, point.x),
          maxY: Math.max(result.maxY, point.y),
        }),
        {
          minX: firstPoint.x,
          minY: firstPoint.y,
          maxX: firstPoint.x,
          maxY: firstPoint.y,
        },
      );
    },
    [polygon],
  );

  const clipFunc = React.useCallback<
    NonNullable<React.ComponentProps<typeof Group>["clipFunc"]>
  >(
    (ctx) => {
      const addPolygon = (points: Pt[]) => {
        if (points.length < 3) return;
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.closePath();
      };
      addPolygon(polygon);
      innerPolygons.forEach(addPolygon);
      return ["evenodd"] as [CanvasFillRule];
    },
    [innerPolygons, polygon],
  );

  const inverseScale = 1 / Math.max(scale, 0.01);
  const hatchSpacing = 14 * inverseScale;
  const hatchStrokeWidth = 1.1 * inverseScale;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const span = width + height;
  const hatchLines = React.useMemo(() => {
    const result: Array<{ key: string; points: number[] }> = [];
    for (let offset = -height; offset <= width; offset += hatchSpacing) {
      result.push({
        key: `down-${offset}`,
        points: [bounds.minX + offset, bounds.minY, bounds.minX + offset + height, bounds.maxY],
      });
      result.push({
        key: `up-${offset}`,
        points: [bounds.minX + offset, bounds.maxY, bounds.minX + offset + height, bounds.minY],
      });
    }
    return result;
  }, [bounds.maxY, bounds.minX, bounds.minY, hatchSpacing, height, width]);

  if (!isVisible) return null;

  return (
    <Group listening={false} clipFunc={clipFunc}>
      <Rect
        x={bounds.minX - span}
        y={bounds.minY - span}
        width={width + span * 2}
        height={height + span * 2}
        fill="rgba(239, 68, 68, 0.16)"
        listening={false}
      />
      {hatchLines.map((line) => (
        <Line
          key={line.key}
          points={line.points}
          stroke="rgba(248, 113, 113, 0.62)"
          strokeWidth={hatchStrokeWidth}
          listening={false}
        />
      ))}
    </Group>
  );
}
