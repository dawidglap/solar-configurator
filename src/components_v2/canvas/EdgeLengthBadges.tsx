'use client';

import React, { useMemo } from 'react';

type Pt = { x: number; y: number };
type View = { scale?: number; offsetX?: number; offsetY?: number };

function toScreen(p: Pt, view: View) {
  const s  = view.scale  ?? 1;
  const ox = view.offsetX ?? 0;
  const oy = view.offsetY ?? 0;
  return { left: ox + p.x * s, top: oy + p.y * s };
}

function formatMeters(m: number) {
  if (m < 10) return `${m.toFixed(1)} m`;
  if (m < 100) return `${m.toFixed(1)} m`;
  return `${Math.round(m)} m`;
}

/**
 * Etichette lunghezza lato (in m) per il poligono selezionato.
 * Disegno HTML assoluto così restano sempre piccole e leggibili.
 */
export default function EdgeLengthBadges({
  points,
  mpp,
  view,
  color = '#7c3aed',           // viola premium
}: {
  points: Pt[];
  mpp: number;
  view: View;
  color?: string;
}) {
  const s = view.scale ?? 1;

  const items = useMemo(() => {
    if (!points || points.length < 2) return [];
    const out: {
      key: string;
      left: number;
      top: number;
      text: string;
    }[] = [];

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      // mid-point
      const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      // offset perpendicolare costante (in px schermo)
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L;
      const ny =  dx / L;

      const offsetScreen = 12;             // 12px sullo schermo
      const offsetImg = offsetScreen / s;  // convertito in px immagine
      const pOff: Pt = { x: mid.x + nx * offsetImg, y: mid.y + ny * offsetImg };

      const { left, top } = toScreen(pOff, view);
      const meters = L * mpp;

      out.push({
        key: `${i}-${i + 1}`,
        left,
        top,
        text: formatMeters(meters),
      });
    }
    return out;
  }, [points, mpp, view.scale, view.offsetX, view.offsetY, s]);

  return (
    <>
      {items.map((it) => (
        <div
          key={it.key}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 select-none rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm"
          style={{
            left: it.left,
            top: it.top,
            background: 'rgba(255,255,255,0.95)',
            borderColor: color,
            color: '#111',
          }}
        >
          {it.text}
        </div>
      ))}
    </>
  );
}
