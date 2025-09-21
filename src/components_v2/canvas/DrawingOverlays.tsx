'use client';

import React from 'react';
import { Line as KonvaLine, Circle as KonvaCircle, Text as KonvaText } from 'react-konva';
import { snapParallelPerp, isNear, Pt } from './utils/snap';

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
  // palette UI
  const PREVIEW = '#7c3aed'; // viola (segmento in movimento)
  const ACCEPT  = '#16a34a'; // verde (segmenti fissati)
  const GUIDE   = '#a78bfa'; // guida snap
  const HANDLE_BG = '#ffffff';

  const SNAP_TOL_DEG = 12;
  const CLOSE_RADIUS = 12;

  // —— DRAW-ROOF (con snap in preview e guida)
  const renderDrawRoof = () => {
    if (!drawingPoly || drawingPoly.length === 0) return null;

    const pts = drawingPoly;
    const last = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
    const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

    let target = mouseImg ?? last;
    let snapGuide: { a: Pt; b: Pt } | undefined;

    // magnete per chiudere sul primo punto
    if (mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS)) {
      target = pts[0];
    } else if (mouseImg) {
      // snap parallelo/perpendicolare sul segmento precedente
      const { pt, guide } = snapParallelPerp(last, mouseImg, refDir, SNAP_TOL_DEG);
      target = pt;
      if (guide) snapGuide = guide;
    }

    return (
      <>
        {/* guida snap (tratteggiata) */}
        {snapGuide && (
          <KonvaLine
            points={[snapGuide.a.x, snapGuide.a.y, snapGuide.b.x, snapGuide.b.y]}
            stroke={GUIDE}
            strokeWidth={1}
            dash={[6, 6]}
            listening={false}
          />
        )}

        {/* segmenti già confermati (verde) */}
        {pts.length >= 2 && (
          <KonvaLine
            points={toFlat(pts)}
            stroke={ACCEPT}
            strokeWidth={2}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {/* segmento in anteprima (viola) */}
        {mouseImg && (
          <KonvaLine
            points={[last.x, last.y, target.x, target.y]}
            stroke={PREVIEW}
            strokeWidth={2}
            dash={[6, 6]}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {/* handle dei vertici fissati */}
        {pts.map((p, i) => (
          <KonvaCircle
            key={i}
            x={p.x}
            y={p.y}
            radius={3.2}
            fill={HANDLE_BG}
            stroke={ACCEPT}
            strokeWidth={1.4}
            listening={false}
          />
        ))}

        {/* area live (se già >=3 punti fissati) */}
        {pts.length >= 3 && (
          <KonvaText
            x={polygonCentroid(pts).x}
            y={polygonCentroid(pts).y}
            text={areaLabel(pts) ?? ''}
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
    );
  };

  // —— DRAW-RECT (preview classico)
  const renderDrawRect = () => {
    if (!rectDraft || rectDraft.length === 0) return null;

    return (
      <>
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
              return (
                <>
                  <KonvaLine
                    points={toFlat(preview)}
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
    );
  };

  return (
    <>
      {tool === 'draw-roof' && renderDrawRoof()}
      {tool === 'draw-rect' && renderDrawRect()}
    </>
  );
}
