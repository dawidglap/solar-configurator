'use client';

import React from 'react';
import {
  Line as KonvaLine,
  Circle as KonvaCircle,
  Text as KonvaText,
  Group as KonvaGroup,
  Rect as KonvaRect
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
const deg2rad = (d: number) => (d * Math.PI) / 180;

export default function DrawingOverlays({
  tool,
  drawingPoly,
  rectDraft,
  mouseImg,
  stroke,
  areaLabel,
  mpp,
  /** ⬇️ nuovo: angolo base del tetto in COORDINATE CANVAS (come baseGridDeg) */
  roofSnapDeg,
}: {
  tool: string;
  drawingPoly: Pt[] | null;
  rectDraft: Pt[] | null;
  mouseImg: Pt | null;
  stroke: string;
  areaLabel: (pts: Pt[]) => string | null;
  mpp?: number;
  roofSnapDeg?: number; // ⬅️ nuovo
}) {
  // palette UI
  const PREVIEW = '#7c3aed';
  const ACCEPT  = '#16a34a';
  const GUIDE   = 'rgba(255,255,255,0.50)';
  const HANDLE_BG = '#ffffff';

  const DANGER    = '#ef4444';
  const DANGER_OK = '#dc2626';

  const SNAP_TOL_DEG = 4;
  const CLOSE_RADIUS = 4;

  const guideAxisColor = 'rgba(255,255,255,0.50)'; // rosso tenue per assi guida
  const guideAxisW = 0.75;

  // —— DRAW-ROOF (immutato)
  const renderDrawRoof = () => {
    if (!drawingPoly || drawingPoly.length === 0) return null;

    const pts = drawingPoly;
    const last = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
    const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : undefined;

    let target = mouseImg ?? last;
    let snapGuide: { a: Pt; b: Pt } | undefined;

    if (mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS)) {
      target = pts[0];
    } else if (mouseImg) {
      const { pt, guide } = snapParallelPerp(last, mouseImg, refDir, SNAP_TOL_DEG);
      target = pt;
      if (guide) snapGuide = guide;
    }

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

    const closeToFirst = mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS);

    return (
      <>
        {snapGuide && (
          <KonvaLine
            points={[snapGuide.a.x, snapGuide.a.y, snapGuide.b.x, snapGuide.b.y]}
            stroke={GUIDE}
            strokeWidth={1}
            dash={[2, 2]}
            listening={false}
          />
        )}

        {pts.length >= 2 && (
          <KonvaLine
            points={toFlat(pts)}
            stroke={ACCEPT}
            strokeWidth={1}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {mouseImg && (
          <KonvaLine
            points={[last.x, last.y, target.x, target.y]}
            stroke={PREVIEW}
            strokeWidth={0.5}
            // dash={[6, 6]}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {mouseImg && (() => {
          const mx0 = (last.x + target.x) / 2;
          const my0 = (last.y + target.y) / 2;
          const dx = target.x - last.x;
          const dy = target.y - last.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny =  dx / len;

          const OFF = 12;
          const mx = mx0 + nx * OFF;
          const my = my0 + ny * OFF;

          const SCALE = 0.3;
          const W  = 70 * SCALE;
          const H  = 18 * SCALE;
          const FS = 10 * SCALE;
          const CR = 9  * SCALE;

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
                text={`${len >= 1 ? (mpp ? (len*mpp >= 2 ? `${(Math.round((len*mpp) * 10) / 10).toFixed(1)} m` : `${Math.round(len*mpp*100)} cm`) : `${Math.round(len)} px`) : ''}  •  ${angleDeg}°`}
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

        {pts.map((p, i) => (
          <KonvaCircle
            key={i}
            x={p.x}
            y={p.y}
            radius={1.6}
            fill="#ffffff"
            stroke={ACCEPT}
            strokeWidth={1.0}
            listening={false}
          />
        ))}

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

        {pts.length >= 3 && (
          <KonvaText
            x={polygonCentroid(pts).x}
            y={polygonCentroid(pts).y}
            text={areaLabel(pts) ?? ''}
            fontSize={6}
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

  // —— DRAW-RECT (immutato)
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

  // ——— DRAW-RESERVED con assi guida dal primo punto
  const renderDrawReserved = () => {
    if (!drawingPoly || drawingPoly.length === 0) return null;

    const pts = drawingPoly;
    const last = pts[pts.length - 1];

    // 1) asse del tetto (se disponibile)
    const baseDir =
      typeof roofSnapDeg === 'number'
        ? { x: Math.cos(deg2rad(roofSnapDeg)), y: Math.sin(deg2rad(roofSnapDeg)) }
        : undefined;

    // 2) refDir: se ho già due punti uso il segmento precedente,
    //            altrimenti uso l’asse tetto per mostrare subito snap parallelo/perpendicolare
    const refDir =
      pts.length >= 2
        ? { x: last.x - pts[pts.length - 2].x, y: last.y - pts[pts.length - 2].y }
        : baseDir;

    let target = mouseImg ?? last;
    let snapGuide: { a: Pt; b: Pt } | undefined;

    const closeToFirst =
      mouseImg && pts.length >= 3 && isNear(mouseImg, pts[0], CLOSE_RADIUS);

    if (mouseImg && closeToFirst) {
      target = pts[0];
    } else if (mouseImg) {
      const { pt, guide } = snapParallelPerp(last, mouseImg, refDir, SNAP_TOL_DEG);
      target = pt;
      if (guide) snapGuide = guide;
    }

    // stile
    const STROKE      = '#FF2D2D';
    const STROKE_OK   = '#DC2626';
    const STROKE_W    = 0.5;
    const FILL_PRE    = 'rgba(255,45,45,0.08)';

    // maniglie quadrate mini
    const HANDLE_SIZE     = 3;
    const HALF            = HANDLE_SIZE / 2;
    const HANDLE_FILL     = 'rgba(255,255,255,0.65)';
    const HANDLE_STROKE   = 'rgba(0,0,0,0.4)';
    const HANDLE_STROKE_W = 0.5;

    // 3) assi guida visuali già dal primo punto (se ho roofSnapDeg)
    const AXIS_LEN = 200;
    const axisLines = (() => {
      if (!(baseDir && pts.length === 1)) return null;
      const p = last;
      const d = baseDir;
      const perp = { x: -d.y, y: d.x };
      const a1 = [p.x - d.x * AXIS_LEN, p.y - d.y * AXIS_LEN, p.x + d.x * AXIS_LEN, p.y + d.y * AXIS_LEN];
      const a2 = [p.x - perp.x * AXIS_LEN, p.y - perp.y * AXIS_LEN, p.x + perp.x * AXIS_LEN, p.y + perp.y * AXIS_LEN];
      return (
        <>
          <KonvaLine points={a1} stroke={guideAxisColor} dash={[2, 2]} strokeWidth={guideAxisW} listening={false} />
          <KonvaLine points={a2} stroke={guideAxisColor} dash={[2, 2]} strokeWidth={guideAxisW} listening={false} />
        </>
      );
    })();

    return (
      <>
        {/* assi guida dal primo punto */}
        {axisLines}

        {/* guida snap dinamica */}
        {snapGuide && (
          <KonvaLine
            points={[snapGuide.a.x, snapGuide.a.y, snapGuide.b.x, snapGuide.b.y]}
            stroke={guideAxisColor}
            dash={[2, 2]}
            strokeWidth={1}
            listening={false}
          />
        )}

        {/* segmenti confermati */}
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

        {/* segmento attivo */}
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

        {/* fill live */}
        {pts.length >= 3 && (
          <KonvaLine
            points={toFlat(pts)}
            closed
            stroke="transparent"
            fill={FILL_PRE}
            listening={false}
          />
        )}

        {/* maniglie quadrate */}
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

        {/* hint chiusura sul primo punto */}
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
