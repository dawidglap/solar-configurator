'use client';

import React from 'react';
import { Line as KonvaLine, Circle as KonvaCircle, Text as KonvaText } from 'react-konva';

type Pt = { x: number; y: number };

// ───────────────────────────────────────────────────────────
// Utils base
// ───────────────────────────────────────────────────────────
function toFlat(pts: Pt[]) {
  return pts.flatMap((p) => [p.x, p.y]);
}
function centroid(pts: Pt[]) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const n = pts.length || 1;
  return { x: sx / n, y: sy / n };
}
function dist2(a: Pt, b: Pt) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// ───────────────────────────────────────────────────────────
// SNAP UTILS: parallelo / perpendicolare + guide
// (export per poter riusare la stessa logica nel click handler del parent)
// ───────────────────────────────────────────────────────────
function norm(p: Pt) { const d = Math.hypot(p.x, p.y) || 1; return { x: p.x / d, y: p.y / d }; }
function sub(a: Pt, b: Pt) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Pt, b: Pt) { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Pt, k: number) { return { x: a.x * k, y: a.y * k }; }
function angleBetween(u: Pt, v: Pt) {
  const ang = Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x);
  let deg = Math.abs((ang * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

export function snapParallelPerp(
  origin: Pt,
  pointer: Pt,
  refDir?: Pt,
  tolDeg = 12
): {
  pt: Pt;
  snapped: boolean;
  kind: null | 'parallel' | 'perpendicular';
  guide?: { a: Pt; b: Pt };
} {
  const v = sub(pointer, origin);
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { pt: pointer, snapped: false, kind: null };

  const ref = refDir && (refDir.x || refDir.y) ? refDir : { x: 1, y: 0 };
  const refN = norm(ref);
  const vN   = norm(v);

  const deg = angleBetween(vN, refN);

  let snapped = false;
  let kind: null | 'parallel' | 'perpendicular' = null;
  let dir = vN;

  if (deg <= tolDeg || Math.abs(deg - 180) <= tolDeg) {
    dir = refN;
    snapped = true;
    kind = 'parallel';
  } else if (Math.abs(deg - 90) <= tolDeg) {
    dir = { x: -refN.y, y: refN.x };
    snapped = true;
    kind = 'perpendicular';
  }

  if (!snapped) return { pt: pointer, snapped, kind };

  const pt = add(origin, mul(dir, len));
  const guide = { a: add(origin, mul(dir, -10000)), b: add(origin, mul(dir, 10000)) };
  return { pt, snapped, kind, guide };
}

// ───────────────────────────────────────────────────────────
// Rettangolo 3-click (come avevi)
// ───────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────

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
  // colori UI (Canva-like)
  const PREVIEW = '#7c3aed';     // viola (segmento in movimento)
  const ACCEPT  = '#16a34a';     // verde (segmenti confermati)
  const GUIDE   = '#a78bfa';     // guida più chiara
  const HANDLE_BG = '#ffffff';

  const SNAP_TOL_DEG = 12;
  const CLOSE_RADIUS = 12; // px per magnete sul primo punto

  // ── DRAW POLYGON (con snap + guide)
  const renderDrawRoof = () => {
    if (!drawingPoly || drawingPoly.length === 0) return null;

    const pts = drawingPoly;
    const last = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
    const refDir = prev ? { x: last.x - prev.x, y: last.y - prev.y } : { x: 1, y: 0 };

    // 1) calcola endpoint "target" a partire dal mouse
    let target = mouseImg ?? last;

    // 2) Verbindungshilfe: magnete per chiudere sul primo punto
    let connectFirst = false;
    if (mouseImg && pts.length >= 3) {
      const d2 = dist2(mouseImg, pts[0]);
      if (d2 <= CLOSE_RADIUS * CLOSE_RADIUS) {
        target = pts[0];
        connectFirst = true;
      }
    }

    // 3) Snap parallelo/perpendicolare se NON stai chiudendo
    let snapGuide: { a: Pt; b: Pt } | undefined;
    if (!connectFirst && mouseImg) {
      const snap = snapParallelPerp(last, mouseImg, refDir, SNAP_TOL_DEG);
      target = snap.pt;
      if (snap.snapped && snap.guide) snapGuide = snap.guide;
    }

    // 4) Segmenti già “accettati” = verdi
    const acceptedFlat = pts.length >= 2 ? toFlat(pts) : undefined;

    return (
      <>
        {/* guide di snap (tratteggiata) */}
        {snapGuide && (
          <KonvaLine
            points={[snapGuide.a.x, snapGuide.a.y, snapGuide.b.x, snapGuide.b.y]}
            stroke={GUIDE}
            strokeWidth={1}
            dash={[6, 6]}
            listening={false}
          />
        )}

        {/* polilinea dei segmenti già fissati (verde) */}
        {acceptedFlat && (
          <KonvaLine
            points={acceptedFlat}
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

        {/* highlight sul primo punto quando sei in magnete */}
        {connectFirst && (
          <KonvaCircle
            x={pts[0].x}
            y={pts[0].y}
            radius={6}
            stroke={PREVIEW}
            strokeWidth={2}
            listening={false}
          />
        )}

        {/* area live solo se hai almeno un poligono “chiudibile” in preview non serve; qui lasciamo quando hai >=3 punti fissati */}
        {pts.length >= 3 && (
          <KonvaText
            x={centroid(pts).x}
            y={centroid(pts).y}
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

  // ── DRAW RECT (preview come avevi)
  const renderDrawRect = () => {
    if (!rectDraft || rectDraft.length === 0) return null;

    return (
      <>
        {/* A solo */}
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

        {/* A-B base + preview */}
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
    );
  };

  return (
    <>
      {tool === 'draw-roof' && renderDrawRoof()}
      {tool === 'draw-rect' && renderDrawRect()}
    </>
  );
}
