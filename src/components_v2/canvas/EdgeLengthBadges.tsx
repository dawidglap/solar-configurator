// src/components_v2/canvas/EdgeLengthBadges.tsx
'use client';

import React, { useMemo } from 'react';

type Pt = { x: number; y: number };
type View = { scale?: number; offsetX?: number; offsetY?: number };

function formatMeters(m: number) {
  if (m < 10) return `${m.toFixed(2)} m`;
  if (m < 100) return `${m.toFixed(1)} m`;
  return `${Math.round(m)} m`;
}

function normDeg(d: number) { const x = d % 360; return x < 0 ? x + 360 : x; }
function deg2rad(d: number) { return (d * Math.PI) / 180; }

/** lunghezza reale lato corretta per inclinazione (se disponibili tilt+gronda) */
function correctedLenM(
  vpx: { x:number; y:number },
  mpp: number,
  tiltDeg?: number,
  fallUnit?: { x:number; y:number } | null
) {
  const planLenPx = Math.hypot(vpx.x, vpx.y);
  if (!tiltDeg || !fallUnit) return planLenPx * mpp;

  // componente parallela/perpendicolare alla “caduta” (perp. alla gronda)
  const vParPlan  = vpx.x * fallUnit.x + vpx.y * fallUnit.y;      // px
  const vPerpPlan = vpx.x * (-fallUnit.y) + vpx.y * (fallUnit.x); // px

  const cosT = Math.max(0.1736, Math.cos(deg2rad(tiltDeg)));      // ≥ cos 80°
  const vParTrue  = vParPlan / cosT;                               // de-foreshortening
  const vPerpTrue = vPerpPlan;

  const trueLenPx = Math.hypot(vParTrue, vPerpTrue);
  return trueLenPx * mpp;
}

/**
 * Badge lunghezza per ogni lato.
 * - Corregge le lunghezze per inclinazione/gronda (opzionale)
 * - Allinea posizione e rotazione dei badge alla rotazione del Group Konva
 */
export default function EdgeLengthBadges({
  points,
  mpp,
  view,
  imgW,
  imgH,
  rotateDeg = 0,          // ← rotazione applicata al Group Konva
  color = '#3b82f6',
  fontSize = 9,
  edgeOffsetPx = 10,
  // opzionali per correzione inclinazione
  tiltDeg,
  eavesAzimuthDeg,
}: {
  points: Pt[];
  mpp: number;
  view: View;
  imgW: number;
  imgH: number;
  rotateDeg?: number;
  color?: string;
  fontSize?: number;
  edgeOffsetPx?: number;
  tiltDeg?: number;
  /** azimut della GRONDA in gradi (come salvato nello store, non “+180 UI”) */
  eavesAzimuthDeg?: number;
}) {
  const s  = view.scale  ?? 1;
  const ox = view.offsetX ?? 0;
  const oy = view.offsetY ?? 0;

  // vettore unitario “caduta” (perp. alla gronda) in coordinate immagine
  const fallUnit = useMemo(() => {
    if (typeof eavesAzimuthDeg !== 'number') return null;
    const eavesCanvasDeg = -(eavesAzimuthDeg) + 90;       // convenzione canvas
    const fallDeg = normDeg(eavesCanvasDeg - 90);         // perpendicolare
    const th = deg2rad(fallDeg);
    return { x: Math.cos(th), y: Math.sin(th) };
  }, [eavesAzimuthDeg]);

  // immagine → schermo con rotazione attorno al centro immagine
  const imgToScreen = (p: Pt) => {
    const cx = imgW / 2, cy = imgH / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const t  = deg2rad(rotateDeg);
    const rx = dx * Math.cos(t) - dy * Math.sin(t);
    const ry = dx * Math.sin(t) + dy * Math.cos(t);
    const x2 = cx + rx, y2 = cy + ry;
    return { left: ox + x2 * s, top: oy + y2 * s };
  };

  const items = useMemo(() => {
    if (!points || points.length < 2 || !mpp || !imgW || !imgH) return [];
    const out: { key: string; left: number; top: number; text: string; deg: number }[] = [];

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;

      // lunghezza corretta (se tilt/gronda disponibili)
      const lenM = correctedLenM({ x: dx, y: dy }, mpp, tiltDeg, fallUnit);
      const text = formatMeters(lenM);

      // punto medio + offset normale (in SPAZIO IMMAGINE)
      const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nx = -dy / L, ny =  dx / L;
      const offsetImg = edgeOffsetPx / s;
      const pOff: Pt = { x: mid.x + nx * offsetImg, y: mid.y + ny * offsetImg };

      // angolo del lato SU SCHERMO = angolo immagine + rotateDeg
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + rotateDeg;
      if (deg > 90 || deg < -90) deg += 180;  // upright

      const { left, top } = imgToScreen(pOff);
      out.push({ key: `${i}-${i + 1}`, left, top, text, deg });
    }
    return out;
  }, [points, mpp, imgW, imgH, s, ox, oy, edgeOffsetPx, tiltDeg, fallUnit, rotateDeg]);

  return (
    <>
      {items.map((it) => (
        <div
          key={it.key}
          className="pointer-events-none absolute select-none"
          style={{
            left: it.left,
            top: it.top,
            transform: `translate(-50%, -50%) rotate(${it.deg}deg)`,
            transformOrigin: 'center',
            background: 'transparent',
            color: '#fff',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            textShadow: '0 0 2px rgba(0,0,0,0.45)',
          }}
        >
          {it.text}
        </div>
      ))}
    </>
  );
}
