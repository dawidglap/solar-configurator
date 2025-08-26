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

// azimuth (0=N, 90=E, 180=S, 270=W) da un vettore in coordinate immagine (y cresce verso il basso)
function azimuthDegFromVector(dx: number, dy: number) {
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // vedi analisi: y down
  if (deg < 0) deg += 360;
  return deg;
}

function compass8(deg: number) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  const idx = Math.round(deg / 45);
  return dirs[idx];
}

export default function AzimuthBadge({
  points,
  view,
  color = '#111',         // testo
  bg    = 'rgba(255,255,255,0.9)', // pill trasparente
}: {
  points: Pt[];
  view: View;
  color?: string;
  bg?: string;
}) {
  const data = useMemo(() => {
    if (!points || points.length < 2) return null;

    // 1) prendi il lato più lungo come “direzione tetto”
    let bestLen = -1;
    let best = { a: points[0], b: points[1] };
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L > bestLen) { bestLen = L; best = { a, b }; }
    }

    const dx = best.b.x - best.a.x;
    const dy = best.b.y - best.a.y;
    const az  = azimuthDegFromVector(dx, dy);
    const dir = compass8(az);

    // 2) posizioniamo il badge appena “sopra” il centroide
    let cx = 0, cy = 0;
    for (const p of points) { cx += p.x; cy += p.y; }
    cx /= points.length; cy /= points.length;

    const s  = view.scale ?? 1;
    const offPx = 16;                 // 16px schermo verso l’alto
    const offImg = offPx / s;
    const pos = toScreen({ x: cx, y: cy - offImg }, view);

    return { az, dir, left: pos.left, top: pos.top };
  }, [points, view.scale, view.offsetX, view.offsetY]);

  if (!data) return null;

  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-full select-none rounded-full border px-2 py-0.5 text-[11px] shadow-sm"
      style={{
        left: data.left,
        top: data.top,
        background: bg,
        borderColor: 'rgba(0,0,0,0.15)',
        color,
        whiteSpace: 'nowrap',
      }}
      title="Ausrichtung (geschätzt aus der Polygonlage)"
    >
      Ausrichtung: {Math.round(data.az)}° ({data.dir})
    </div>
  );
}
