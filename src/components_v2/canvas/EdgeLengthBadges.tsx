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

/**
 * Badge lunghezza per ogni lato (ispirazione Reonic).
 * Overlay HTML ruotato lungo l’edge, super minimal.
 */
export default function EdgeLengthBadges({
  points,
  mpp,              // metri per pixel (immagine)
  view,
  color = '#3b82f6', // blu premium (tailwind blue-500)
  fontSize = 9,      // molto piccolo
  edgeOffsetPx = 10, // distanza dal lato in px SCHERMO (indipendente dallo zoom)
}: {
  points: Pt[];
  mpp: number;
  view: View;
  color?: string;
  fontSize?: number;
  edgeOffsetPx?: number;
}) {
  const s = view.scale ?? 1;

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

      const lenM = L * mpp;
      const text = formatMeters(lenM);

      // punto medio
      const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

      // normale unitaria (per staccare il badge dalla linea)
      const nx = -dy / L;
      const ny =  dx / L;
      const offsetImg = edgeOffsetPx / s; // px img equivalenti
      const pOff: Pt = { x: mid.x + nx * offsetImg, y: mid.y + ny * offsetImg };

      // angolo lungo il lato + “upright”
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;

      const { left, top } = toScreen(pOff, view);
      out.push({ key: `${i}-${i + 1}`, left, top, text, deg });
    }
    return out;
  }, [points, mpp, view.scale, view.offsetX, view.offsetY, s, edgeOffsetPx]);

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
            // stile super-minimal ispirato Reonic
            background: 'transparent',
            border: `0px solid ${color}`,
            color: '#fff', // slate-900
            borderRadius: 3,
            padding: '1px 4px',     // piccolissimo
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
