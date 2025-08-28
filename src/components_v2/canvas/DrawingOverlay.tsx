'use client';

import React from 'react';
import { Line as KonvaLine, Circle as KonvaCircle, Text as KonvaText } from 'react-konva';

type Pt = { x: number; y: number };

function toFlat(pts: Pt[]) {
  return pts.flatMap((p) => [p.x, p.y]);
}
function centroid(pts: Pt[]) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const n = pts.length || 1;
  return { x: sx / n, y: sy / n };
}
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

export default function DrawingOverlay({
  tool,
  drawingPoly,
  rectDraft,
  mouseImg,
  stroke,
  areaLabel, // (pts) => string | null
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
            <KonvaCircle key={i} x={p.x} y={p.y} radius={3.2} fill="#fff" stroke={stroke} strokeWidth={1.2} />
          ))}
          {drawingPoly.length >= 3 && (
            <KonvaText
              x={centroid(drawingPoly).x}
              y={centroid(drawingPoly).y}
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
          {/* A solo */}
          {rectDraft.length === 1 && (
            <KonvaCircle x={rectDraft[0].x} y={rectDraft[0].y} radius={3.2} fill="#fff" stroke={stroke} strokeWidth={1.2} />
          )}

          {/* A-B linea base + preview rettangolo */}
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
                      x={centroid(preview).x}
                      y={centroid(preview).y}
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
