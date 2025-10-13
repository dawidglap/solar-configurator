'use client';

import React from 'react';
import {
  Line as KonvaLine,
  Circle as KonvaCircle,
  Text as KonvaText,
  Group as KonvaGroup,     // ⬅️ nuovo
  Rect as KonvaRect        // ⬅️ nuovo
} from 'react-konva';

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
  mpp,                // ⬅️ nuovo
}: {
  tool: string;
  drawingPoly: Pt[] | null;
  rectDraft: Pt[] | null;
  mouseImg: Pt | null;
  stroke: string;
  areaLabel: (pts: Pt[]) => string | null;
  mpp?: number;       // ⬅️ nuovo
}) {
  // palette UI
  const PREVIEW = '#7c3aed'; // viola (segmento in movimento)
  const ACCEPT  = '#16a34a'; // verde (segmenti fissati)
  const GUIDE   = '#a78bfa'; // guida snap
  const HANDLE_BG = '#ffffff';

    // ... in cima ai colori già esistenti
const DANGER   = '#ef4444';  // rosso (segmento in movimento)
const DANGER_OK= '#dc2626';  // rosso scuro (segmenti fissati)

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

    // — misure live sul segmento attivo —
let angleDeg = 0;
let lenPx = 0;
if (mouseImg) {
  const dx = target.x - last.x;
  const dy = target.y - last.y;
  angleDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
  lenPx = Math.hypot(dx, dy);
}
const lenLabel = (() => {
  if (!mouseImg) return '';
  if (mpp) {
    const m = lenPx * mpp;
    return m >= 2 ? `${(Math.round(m * 10) / 10).toFixed(1)} m` : `${Math.round(m * 100)} cm`;
  }
  return `${Math.round(lenPx)} px`;
})();

// — stato "vicino al primo punto" per hint chiusura —
const closeToFirst = mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS);




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

        {/* etichetta lunghezza + angolo sul segmento attivo */}
{/* etichetta lunghezza + angolo (piccola + offset fuori dal segmento) */}
{mouseImg && (() => {
  // midpoint del segmento
  const mx0 = (last.x + target.x) / 2;
  const my0 = (last.y + target.y) / 2;

  // normale unitaria al segmento
  const dx = target.x - last.x;
  const dy = target.y - last.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny =  dx / len;

  // offset di 12px lungo la normale (sposta la label fuori dal segmento)
  const OFF = 12;
  const mx = mx0 + nx * OFF;
  const my = my0 + ny * OFF;

  // dimensioni ridotte ~2/5 (40%)
  const SCALE = 0.3;
  const W  = 70 * SCALE;     // prima 70
  const H  = 18 * SCALE;     // prima 18
  const FS = 10 * SCALE;     // font size
  const CR = 9  * SCALE;     // corner radius

  return (
    <KonvaGroup x={mx} y={my} listening={false}>
      <KonvaRect
        x={-W / 2}
        y={-H / 2}
        width={W}
        height={H}
        cornerRadius={CR}
        fill="#ffffff"
        shadowColor="rgba(0,0,0,0.25)"
        shadowBlur={2 * SCALE}
        shadowOpacity={0.8}
      />
      <KonvaText
        text={`${lenLabel}  •  ${angleDeg}°`}
        fontSize={FS}
        fill="#111827"
        width={W}
        height={H}
        offsetX={W / 2}
        offsetY={H / 2}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </KonvaGroup>
  );
})()}


{/* handle dei vertici fissati */}
{pts.map((p, i) => (
  <KonvaCircle
    key={i}
    x={p.x}
    y={p.y}
    radius={3.2}
    fill="#ffffff"
    stroke={ACCEPT}
    strokeWidth={1.4}
    listening={false}
  />
))}


{/* primo punto: hint chiusura */}
{pts.length >= 1 && (
  <KonvaCircle
    x={pts[0].x}
    y={pts[0].y}
    radius={closeToFirst ? 5 : 3.2}
    fill="#ffffff"
    stroke={closeToFirst ? '#16a34a' : '#9ca3af'}
    strokeWidth={closeToFirst ? 1.5 : 1}
    shadowColor="rgba(0,0,0,0.25)"
    shadowBlur={2}
    shadowOpacity={0.8}
    listening={false}
  />
)}


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




// ——— DRAW-RESERVED (poligono libero, rosso pieno + maniglie quadrate)
const renderDrawReserved = () => {
  if (!drawingPoly || drawingPoly.length === 0) return null;

  const pts = drawingPoly;
  const last = pts[pts.length - 1];
  const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
  const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

  let target = mouseImg ?? last;
  let snapGuide: { a: Pt; b: Pt } | undefined;

  // magnete chiusura sul primo punto
  const closeToFirst = mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS);
  if (mouseImg && closeToFirst) {
    target = pts[0];
  } else if (mouseImg) {
    const { pt, guide } = snapParallelPerp(last, mouseImg, refDir, SNAP_TOL_DEG);
    target = pt;
    if (guide) snapGuide = guide;
  }

  // stile
  const STROKE      = '#FF2D2D';            // rosso pieno
  const STROKE_OK   = '#DC2626';            // rosso scuro per segmenti già fissati
  const STROKE_W    = 0.5;
  const FILL_PRE    = 'rgba(255,45,45,0.08)'; // fill leggero quando >=3 punti

  // maniglie quadrate mini
  const HANDLE_SIZE     = 3;
  const HALF            = HANDLE_SIZE / 2;
  const HANDLE_FILL     = 'rgba(255,255,255,0.65)';
  const HANDLE_STROKE   = 'rgba(0,0,0,0.4)';
  const HANDLE_STROKE_W = 0.5;

  return (
    <>
      {/* guida snap (puoi lasciarla tratteggiata o toglierla del tutto; qui la metto tenue e NON tratteggiata) */}
      {snapGuide && (
        <KonvaLine
          points={[snapGuide.a.x, snapGuide.a.y, snapGuide.b.x, snapGuide.b.y]}
          stroke="rgba(239,68,68,0.35)"   // rosso tenue
          strokeWidth={1}
          listening={false}
        />
      )}

      {/* segmenti già confermati: rosso scuro, linea piena */}
      {pts.length >= 2 && (
        <KonvaLine
          points={toFlat(pts)}
          stroke={STROKE_OK}
          strokeWidth={STROKE_W}
          lineJoin="round"
          lineCap="round"
          listening={false}
        />
      )}

      {/* segmento in anteprima: rosso pieno, linea piena */}
      {mouseImg && (
        <KonvaLine
          points={[last.x, last.y, target.x, target.y]}
          stroke={STROKE}
          strokeWidth={STROKE_W}
          lineJoin="round"
          lineCap="round"
          listening={false}
        />
      )}

      {/* fill leggero quando già 3+ punti (anteprima area) */}
      {pts.length >= 3 && (
        <KonvaLine
          points={toFlat(pts)}
          closed
          stroke="transparent"
          fill={FILL_PRE}
          listening={false}
        />
      )}

      {/* maniglie quadrate sui vertici fissati */}
      {pts.map((p, i) => (
        <KonvaRect
          key={i}
          x={p.x - HALF}
          y={p.y - HALF}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          cornerRadius={2}
          fill={HANDLE_FILL}
          stroke={HANDLE_STROKE}
          strokeWidth={HANDLE_STROKE_W}
          listening={false}
        />
      ))}

      {/* primo punto: hint chiusura (quadrato leggermente più grande quando vicino) */}
      {pts.length >= 1 && (
        <KonvaRect
          x={pts[0].x - (closeToFirst ? 4.5 : HALF)}
          y={pts[0].y - (closeToFirst ? 4.5 : HALF)}
          width={closeToFirst ? 9 : HANDLE_SIZE}
          height={closeToFirst ? 9 : HANDLE_SIZE}
          cornerRadius={2}
          fill="#ffffff"
          stroke={closeToFirst ? STROKE_OK : 'rgba(156,163,175,1)'}
          strokeWidth={closeToFirst ? 1.5 : 1}
          listening={false}
        />
      )}
    </>
  );
};



  return (
    <>
      {tool === 'draw-roof' && renderDrawRoof()}
      {tool === 'draw-rect' && renderDrawRect()}
      {tool === 'draw-reserved' && renderDrawReserved()}

    </>
  );
}
