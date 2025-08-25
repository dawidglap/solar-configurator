'use client';

import { Group as KonvaGroup, Line as KonvaLine, Text as KonvaText } from 'react-konva';

type Pt = { x: number; y: number };
export type RoofArea = {
  id: string;
  name: string;
  points: Pt[];
};

function toFlat(pts: Pt[]) {
  return pts.flatMap((p) => [p.x, p.y]);
}

function polygonAreaPx2(pts: Pt[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

function polygonCentroid(pts: Pt[]) {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0,
    sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

function areaLabel(pts: Pt[], mppImage?: number | null) {
  if (!mppImage) return null;
  const areaPx2 = polygonAreaPx2(pts);
  const m2 = areaPx2 * (mppImage * mppImage);
  return `${Math.round(m2)} m²`;
}

export default function RoofsLayer({
  roofs,
  selectedId,
  onSelect,
  mppImage,
  stroke = '#0ea5e9',
  fill = 'rgba(14,165,233,0.18)',
}: {
  roofs: RoofArea[];
  selectedId?: string;
  onSelect: (id: string) => void;
  mppImage?: number | null;
  stroke?: string;
  fill?: string;
}) {
  return (
    <>
      {roofs.map((r) => {
        const flat = toFlat(r.points);
        const sel = r.id === selectedId;
        const c = polygonCentroid(r.points);
        const label = areaLabel(r.points, mppImage);

        return (
          <KonvaGroup key={r.id}>
            <KonvaLine
              points={flat}
              closed
              stroke={stroke}
              strokeWidth={sel ? 2.5 : 1.5}
              lineJoin="round"
              lineCap="round"
              fill={fill}
              onClick={() => onSelect(r.id)}
            />
            {label && (
              <KonvaText
                x={c.x}
                y={c.y}
                text={label}
                fontSize={12}
                fill="#111"
                offsetX={18}
                offsetY={-6}
                listening={false}
                // @ts-ignore
                shadowColor="white"
                shadowBlur={2}
                shadowOpacity={0.9}
              />
            )}
          </KonvaGroup>
        );
      })}
    </>
  );
}
