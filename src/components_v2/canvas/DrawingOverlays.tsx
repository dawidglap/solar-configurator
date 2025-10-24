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

type Guide = { a: Pt; b: Pt };
type SnapResult = { pt: Pt; guides: Guide[]; mode?: string | null };

// —— soglie “soft”
const SNAP_BASE_TOL = 6;        // px: acquisizione base
const SNAP_RELEASE_RATIO = 1.15; // isteresi: rilascio = tol * 1.15
const SNAP_MIN_SEG_NO_SNAP = 14; // px: sotto questa lunghezza niente snap
const SNAP_FULL_STRENGTH_LEN = 80; // px: oltre questo, tol non cresce più

function computeSmartSnap(opts: {
  pts: Pt[];
  mouse: Pt;
  screenBaseDeg: number;   // = -canvasRotateDeg
  tolPx?: number;          // opzionale; default SNAP_BASE_TOL
  stickMode?: string|null;
}): SnapResult {
  const { pts, mouse, screenBaseDeg, tolPx = SNAP_BASE_TOL, stickMode } = opts;
  const guides: Guide[] = [];
  const first = pts[0];
  const last  = pts[pts.length - 1];
  const hasPrev = pts.length >= 2;

  // ——— 0) niente snap su segmenti molto corti (micro-movimenti precisi)
  if (hasPrev) {
    const segLen = Math.hypot(mouse.x - last.x, mouse.y - last.y);
    if (segLen < SNAP_MIN_SEG_NO_SNAP) {
      return { pt: mouse, guides, mode: null };
    }
  }

  // ——— 1) tolleranza dinamica in base alla lunghezza del segmento corrente
  let dynTol = tolPx;
  if (hasPrev) {
    const segLen = Math.hypot(mouse.x - last.x, mouse.y - last.y);
    const k = Math.min(1, Math.max(0.4, segLen / SNAP_FULL_STRENGTH_LEN)); // 0.4…1.0
    dynTol = tolPx * k;
  }

  // helpers assi schermo (espressi in spazio immagine)
  const th = deg2rad(screenBaseDeg);
  const ax = Math.cos(th), ay = Math.sin(th); // orizzonte schermo (in immagine)
  const bx = -ay,          by = ax;           // verticale schermo

  const cands: { mode: string; pt: Pt; err: number; guide?: Guide; weight?: number }[] = [];

  // helper comuni
  const pushProj = (mode: string, o: Pt, ux: number, uy: number) => {
    const vx = mouse.x - o.x, vy = mouse.y - o.y;
    const t = vx * ux + vy * uy;
    const p = { x: o.x + t * ux, y: o.y + t * uy };
    const err = Math.abs(vx * (-uy) + vy * ux);
    cands.push({ mode, pt: p, err, guide: { a: o, b: p } });
  };
  const infiniteGuideThrough = (o: Pt, ux: number, uy: number): Guide => {
    const L = 1e6; return { a: { x: o.x - ux * L, y: o.y - uy * L }, b: { x: o.x + ux * L, y: o.y + uy * L } };
  };
  const projectOnAxisThrough = (p: Pt, o: Pt, ux: number, uy: number): Pt => {
    const vx = p.x - o.x, vy = p.y - o.y; const t = vx * ux + vy * uy; return { x: o.x + t * ux, y: o.y + t * uy };
  };
  const distanceToAxis = (p: Pt, o: Pt, ux: number, uy: number): number => {
    const vx = p.x - o.x, vy = p.y - o.y; return Math.abs(vx * (-uy) + vy * ux);
  };

  // ——— 2) PRIORITÀ AL SEGMENTO PRECEDENTE
  if (hasPrev) {
    const prev = pts[pts.length - 2];
    const dx = last.x - prev.x, dy = last.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,  uy = dy / len;     // dir prev
    const px = -uy,       py = ux;           // perpendicolare
    pushProj('parallel-prev', last, ux, uy);
    pushProj('perp-prev',     last, px, py);
  }

  // ——— 3) ASSI SCHERMO (più “leggeri”)
  {
    const ref = hasPrev ? last : (first ?? mouse);
    pushProj('parallel-screen', ref, ax, ay);
    pushProj('perp-screen',     ref, bx, by);
  }

  // ——— 4) ALLINEAMENTO A PRIMO PUNTO (orizz/vert di schermo)
  if (first) {
    const pH = projectOnAxisThrough(mouse, first, ax, ay);
    const eH = distanceToAxis(mouse, first, ax, ay);
    cands.push({ mode: 'h-first', pt: pH, err: eH, guide: infiniteGuideThrough(first, ax, ay) });

    const pV = projectOnAxisThrough(mouse, first, bx, by);
    const eV = distanceToAxis(mouse, first, bx, by);
    cands.push({ mode: 'v-first', pt: pV, err: eV, guide: infiniteGuideThrough(first, bx, by) });
  }

  // ——— 5) ALLINEAMENTO A QUALSIASI PUNTO (più “leggero” ancora)
  for (const p of pts) {
    const pH = projectOnAxisThrough(mouse, p, ax, ay);
    const eH = distanceToAxis(mouse, p, ax, ay);
    cands.push({ mode: 'h-any', pt: pH, err: eH, guide: infiniteGuideThrough(p, ax, ay) });

    const pV = projectOnAxisThrough(mouse, p, bx, by);
    const eV = distanceToAxis(mouse, p, bx, by);
    cands.push({ mode: 'v-any', pt: pV, err: eV, guide: infiniteGuideThrough(p, bx, by) });
  }

  // ——— 6) piccola penalità a candidati “meno importanti”
  for (const c of cands) {
    let w = 1;
    if (c.mode.includes('screen')) w *= 1.15;   // assi schermo: meno aggressivi
    if (c.mode.endsWith('any'))   w *= 1.20;    // allineamento a punti qualsiasi: ancora meno
    c.err *= w;
  }

  // ordina per errore
  cands.sort((a, b) => a.err - b.err);
  const best = cands[0];

  // ——— 7) ISTERESI più morbida
  if (stickMode) {
    const same = cands.find(c => c.mode === stickMode);
    if (same && same.err <= dynTol * SNAP_RELEASE_RATIO) {
      if (same.guide) guides.push(same.guide);
      return { pt: same.pt, guides, mode: stickMode };
    }
  }

  // ——— 8) Accetta solo se dentro tolleranza dinamica
  if (best && best.err <= dynTol) {
    if (best.guide) guides.push(best.guide);
    return { pt: best.pt, guides, mode: best.mode };
  }

  // nessuno snap
  return { pt: mouse, guides, mode: null };
}


// —— helpers geometrici per gli assi arbitrari (ax,ay)
function projectOnAxisThrough(p: Pt, o: Pt, ax: number, ay: number): Pt {
  const vx = p.x - o.x, vy = p.y - o.y;
  const t = vx * ax + vy * ay;
  return { x: o.x + t * ax, y: o.y + t * ay };
}
function distanceToAxis(p: Pt, o: Pt, ax: number, ay: number): number {
  const vx = p.x - o.x, vy = p.y - o.y;
  // distanza ortogonale alla retta con dir (ax,ay)
  return Math.abs(vx * (-ay) + vy * ax);
}
function infiniteGuideThrough(o: Pt, ax: number, ay: number): Guide {
  const L = 1e6;
  return { a: { x: o.x - ax * L, y: o.y - ay * L }, b: { x: o.x + ax * L, y: o.y + ay * L } };
}

export default function DrawingOverlays({
  tool,
  drawingPoly,
  rectDraft,
  mouseImg,
  stroke,
  areaLabel,
  mpp,
  /** angolo base tetto (resta usato per draw-roof) */
  roofSnapDeg,
  /** ⬅️ NUOVO: angolo di rotazione attuale del contentGroup (Rotation HUD) */
  canvasRotateDeg = 0,
}: {
  tool: string;
  drawingPoly: Pt[] | null;
  rectDraft: Pt[] | null;
  mouseImg: Pt | null;
  stroke: string;
  areaLabel: (pts: Pt[]) => string | null;
  mpp?: number;
  roofSnapDeg?: number;
  canvasRotateDeg?: number;
}) {
  // palette UI essenziale
  const PREVIEW = '#7c3aed';
  const ACCEPT  = '#16a34a';
  const GUIDE   = 'rgba(255,255,255,0.75)';

  const SNAP_TOL_DEG = 4;
  const CLOSE_RADIUS = 4;

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
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

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
            radius={3.2}
            fill="#ffffff"
            stroke={'#9ca3af'}
            strokeWidth={1}
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

  // ——— DRAW-RESERVED con smart snap allineato allo SCHERMO (Rotation HUD)
  const renderDrawReserved = () => {
    if (!drawingPoly || drawingPoly.length === 0) return null;

    const pts = drawingPoly;
    const last = pts[pts.length - 1];

    // Orizzontale schermo espresso nello spazio immagine:
    // se il gruppo è ruotato di +canvasRotateDeg, allora l’orizzontale schermo = -canvasRotateDeg.
    const screenBaseDeg = - (canvasRotateDeg || 0);

    // 1) calcolo punto “snapped” + guide
    let snapped = mouseImg ?? last;
    let guides: Guide[] = [];
let stickModeRef = (renderDrawReserved as any)._stickMode as string | null | undefined;

if (mouseImg) {
  const res = computeSmartSnap({
    pts,
    mouse: mouseImg,
    screenBaseDeg,
    tolPx: SNAP_BASE_TOL, // 6px base; il compute farà il resto
    stickMode: stickModeRef ?? null,
  });
  snapped = res.pt;
  guides  = res.guides;
  (renderDrawReserved as any)._stickMode = res.mode || null;
} else {
  (renderDrawReserved as any)._stickMode = null;
}


    // 2) aggiungo SEMPRE le due guide infinite per il primo punto (orizz/vert di schermo)
    if (pts.length >= 1) {
      const p0 = pts[0];
      const th = deg2rad(screenBaseDeg);
      const ax = Math.cos(th), ay = Math.sin(th);     // orizz schermo
      const bx = -ay,          by = ax;               // vert  schermo
      guides.push(infiniteGuideThrough(p0, ax, ay));
      guides.push(infiniteGuideThrough(p0, bx, by));
    }

    // stile minimal
    const STROKE_CONF = '#22c55e';    // segmenti confermati
    const STROKE_ACT  = '#ef4444';    // segmento attivo
    const STROKE_W    = 1;

    return (
      <>
        {/* guide (tratteggiate bianche) */}
        {guides.map((g, i) => (
          <KonvaLine
            key={'g'+i}
            points={[g.a.x, g.a.y, g.b.x, g.b.y]}
            stroke={GUIDE}
            dash={[3, 3]}
            strokeWidth={0.75}
            listening={false}
          />
        ))}

        {/* segmenti già confermati */}
        {pts.length >= 2 && (
          <KonvaLine
            points={toFlat(pts)}
            stroke={STROKE_CONF}
            strokeWidth={STROKE_W}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {/* segmento attivo */}
        {mouseImg && (
          <KonvaLine
            points={[last.x, last.y, snapped.x, snapped.y]}
            stroke={STROKE_ACT}
            strokeWidth={STROKE_W}
            lineJoin="round"
            lineCap="round"
            listening={false}
          />
        )}

        {/* fill live essenziale (poligono chiuso se già 2+ segmenti) */}
        {pts.length >= 2 && mouseImg && (
          <KonvaLine
            points={toFlat([...pts, snapped])}
            closed
            stroke="transparent"
            fill="rgba(239,68,68,0.10)" // rosso tenue 10%
            listening={false}
          />
        )}

        {/* piccoli marker sui vertici */}
        {pts.map((p, i) => (
          <KonvaRect
            key={i}
            x={p.x - 3}
            y={p.y - 3}
            width={6}
            height={6}
            cornerRadius={2}
            fill="#ffffff"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.5}
            listening={false}
          />
        ))}
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
