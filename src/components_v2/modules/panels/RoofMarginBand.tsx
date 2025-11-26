'use client';

import React from 'react';
import { Group, Line as KonvaLine } from 'react-konva';

type Pt = { x: number; y: number };

export function RoofMarginBand({
  polygon,
  marginPx,
  color = 'rgba(255, 0, 0, 0.35)', // rosso tenue
}: {
  polygon: Pt[];
  marginPx: number;            // in px immagine
  color?: string;
}) {
  if (!polygon?.length || !marginPx || marginPx <= 0) return null;

  const flat = React.useMemo(
    () => polygon.flatMap((p) => [p.x, p.y]),
    [polygon]
  );

  const clipFunc = React.useCallback((ctx: any) => {
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
    ctx.closePath();
  }, [polygon]);

  return (
    <Group listening={false} clipFunc={clipFunc}>
      <KonvaLine
        points={flat}
        closed
        stroke={color}
        strokeWidth={marginPx * 2}   // metà resta fuori, metà dentro → banda interna = marginPx
        lineJoin="round"
        lineCap="round"
        opacity={1}
        listening={false}
      />
    </Group>
  );
}
