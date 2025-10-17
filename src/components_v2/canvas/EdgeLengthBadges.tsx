// src/components_v2/canvas/EdgeLengthBadges.tsx
'use client';

import React, { useMemo } from 'react';

type Pt = { x: number; y: number };
type View = { scale?: number; offsetX?: number; offsetY?: number };

// px immagine -> px schermo
function toScreen(p: Pt, view: View) {
  const s  = view.scale  ?? 1;
  const ox = view.offsetX ?? 0;
  const oy = view.offsetY ?? 0;
  return { left: ox + p.x * s, top: oy + p.y * s };
}

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
  const vParPlan  = vpx.x * fallUnit.x + vpx.y * fallUnit.y;            // px
  const vPerpPlan = vpx.x * (-fallUnit.y) + vpx.y * (fallUnit.x);       // px

  const cosT = Math.max(0.1736, Math.cos(deg2rad(tiltDeg)));            // clamp ≥ cos 80°
  const vParTrue  = vParPlan / cosT;                                    // de-foreshortening
  const vPerpTrue = vPerpPlan;

  const trueLenPx = Math.hypot(vParTrue, vPerpTrue);
  return trueLenPx * mpp;
}

/**
 * Badge lunghezza per ogni lato.
 * Ora opzionalmente corregge per inclinazione e direzione gronda.
 */
export default function EdgeLengthBadges({
  points,
  mpp,               // metri per pixel (immagine)
  view,
  color = '#3b82f6', // blue-500
  fontSize = 9,
  edgeOffsetPx = 10,
  // ⬇️ nuovi opzionali
  tiltDeg,
  eavesAzimuthDeg,
}: {
  points: Pt[];
  mpp: number;
  view: View;
  color?: string;
  fontSize?: number;
  edgeOffsetPx?: number;
  /** inclinazione falda in gradi (se assente: misura in pianta) */
  tiltDeg?: number;
  /** azimut della GRONDA in gradi (come salvato nello store) */
  eavesAzimuthDeg?: number;
}) {
  const s = view.scale ?? 1;

  const fallUnit = useMemo(() => {
    if (typeof eavesAzimuthDeg !== 'number') return null;
    // tua convenzione canvas: eavesCanvasDeg = -(az) + 90
    const eavesCanvasDeg = -(eavesAzimuthDeg) + 90;
    const fallDeg = normDeg(eavesCanvasDeg - 90); // perpendicolare alla gronda
    const th = deg2rad(fallDeg);
    return { x: Math.cos(th), y: Math.sin(th) };
  }, [eavesAzimuthDeg]);

  const items = useMemo(() => {
    if (!points || points.length < 2 || !mpp) return [];
    const out: {
      key: string;
      left: number;
      top: number;
      text: string;
      deg: number;
    }[] = [];

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-3) continue;

      const lenM = correctedLenM({ x: dx, y: dy }, mpp, tiltDeg, fallUnit);
      const text = formatMeters(lenM);

      // punto medio + offset normale (indipendente dallo zoom)
      const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nx = -dy / L, ny = dx / L;
      const offsetImg = edgeOffsetPx / s;
      const pOff: Pt = { x: mid.x + nx * offsetImg, y: mid.y + ny * offsetImg };

      // angolo lungo il lato + “upright”
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;

      const { left, top } = toScreen(pOff, view);
      out.push({ key: `${i}-${i + 1}`, left, top, text, deg });
    }
    return out;
  }, [points, mpp, view.scale, view.offsetX, view.offsetY, s, edgeOffsetPx, tiltDeg, fallUnit]);

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
            border: `0px solid ${color}`,
            color: '#fff',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize,
            lineHeight: 1.1,
            boxShadow: '0 0 0.5px rgba(0,0,0,0.15)',
            whiteSpace: 'nowrap',
          }}
        >
          {it.text}
        </div>
      ))}
    </>
  );
}
