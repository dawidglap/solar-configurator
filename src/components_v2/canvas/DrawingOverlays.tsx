'use client';

import React from 'react';
import { Line as KonvaLine, Circle as KonvaCircle, Text as KonvaText } from 'react-konva';

// tipi minimi (compatibili col tuo Canvas)
export type Pt = { x: number; y: number };

function rectFrom3(A: Pt, B: Pt, C: Pt): Pt[] {
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-6) return [A, B, B, A];
  const nx = -vy / len, ny = vx / len;
  const hx = C.x - B.x, hy = C.y - B.y;
  const h = hx * nx + hy * ny;
  const off = { x: nx * h, y: ny * h };
  const D = { x: A.x + off.x, y: A.y + off.y };
  const C2 = { x: B.x + off.x, y: B.y + off.y };
  return [A, B, C2, D];
}

function polygonCentroid(pts: Pt[]) {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}

const toFlat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);

export default function DrawingOverlays({
  tool,
  drawingPoly,
  rectDraft,
  mouseImg,
  stroke,
  areaLabel,
}: {
  tool: string;
  drawingPoly: Pt[] | null;
  rectDraft: Pt[] | null;
  mouseImg: Pt | null;
  stroke: string;
  areaLabel: (pts: Pt[]) => string | null;
}) {
  return (
    <>
      {/* POLIGONO (rubber band) */}
      {tool === 'draw-roof' && drawingPoly && drawingPoly.length > 0 && (
        <>
          <KonvaLine
            points={toFlat([...drawingPoly, mouseImg ?? drawingPoly[drawingPoly.length - 1]])}
            stroke={stroke}
            strokeWidth={1.5}
            dash={[6, 6]}
            lineJoin="round"
            lineCap="round"
          />
          {drawingPoly.map((p, i) => (
            <KonvaCircle
              key={i}
              x={p.x}
              y={p.y}
              radius={3.2}
              fill="#fff"
              stroke={stroke}
              strokeWidth={1.2}
            />
          ))}
          {drawingPoly.length >= 3 && (
            <KonvaText
              x={polygonCentroid(drawingPoly).x}
              y={polygonCentroid(drawingPoly).y}
              text={areaLabel(drawingPoly) ?? ''}
              fontSize={12}
              fill="#fff"
              offsetX={18}
              offsetY={-6}
              listening={false}
              // @ts-ignore
              shadowColor="white"
              shadowBlur={2}
              shadowOpacity={0.9}
            />
          )}
        </>
      )}

      {/* RETTANGOLO 3-CLICK (preview) */}
      {tool === 'draw-rect' && rectDraft && rectDraft.length > 0 && (
        <>
          {/* A */}
          {rectDraft.length === 1 && (
            <KonvaCircle
              x={rectDraft[0].x}
              y={rectDraft[0].y}
              radius={3.2}
              fill="#fff"
              stroke={stroke}
              strokeWidth={1.2}
            />
          )}
          {/* A-B */}
          {rectDraft.length === 2 && (
            <>
              <KonvaLine
                points={toFlat(rectDraft)}
                stroke={stroke}
                strokeWidth={1.5}
                dash={[6, 6]}
                lineJoin="round"
                lineCap="round"
              />
              {mouseImg && (() => {
                const preview = rectFrom3(rectDraft[0], rectDraft[1], mouseImg);
                const flat = toFlat(preview);
                return (
                  <>
                    <KonvaLine
                      points={flat}
                      closed
                      stroke={stroke}
                      strokeWidth={1.5}
                      lineJoin="round"
                      lineCap="round"
                      dash={[6, 6]}
                    />
                    <KonvaText
                      x={polygonCentroid(preview).x}
                      y={polygonCentroid(preview).y}
                      text={areaLabel(preview) ?? ''}
                      fontSize={12}
                      fill="#fff"
                      offsetX={18}
                      offsetY={-6}
                      listening={false}
                      // @ts-ignore
                      shadowColor="white"
                      shadowBlur={2}
                      shadowOpacity={0.9}
                    />
                  </>
                );
              })()}
            </>
          )}
        </>
      )}
    </>
  );
}
