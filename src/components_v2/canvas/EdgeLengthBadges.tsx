// src/components_v2/canvas/EdgeLengthBadges.tsx
'use client';

import React, { useCallback, useMemo } from 'react';
import { roofSegmentLengthM } from '@/lib/planning-core/geometry-v2';

type Pt = { x: number; y: number };
type View = { scale?: number; offsetX?: number; offsetY?: number };

function formatMeters(m: number) {
  if (m < 10) return `${m.toFixed(2)} m`;
  if (m < 100) return `${m.toFixed(1)} m`;
  return `${Math.round(m)} m`;
}

function deg2rad(d: number) { return (d * Math.PI) / 180; }

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
  edgeOffsetPx = 18,
  // opzionali per correzione inclinazione
  tiltDeg,
  fallAzimuthDeg,
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
  /** Geographic downhill direction: 0=N, 90=E, 180=S, 270=W. */
  fallAzimuthDeg?: number;
}) {
  const s  = view.scale  ?? 1;
  const ox = view.offsetX ?? 0;
  const oy = view.offsetY ?? 0;

  // immagine → schermo con rotazione attorno al centro immagine
  const imgToScreen = useCallback((p: Pt) => {
    const cx = imgW / 2, cy = imgH / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const t  = deg2rad(rotateDeg);
    const rx = dx * Math.cos(t) - dy * Math.sin(t);
    const ry = dx * Math.sin(t) + dy * Math.cos(t);
    const x2 = cx + rx, y2 = cy + ry;
    return { left: ox + x2 * s, top: oy + y2 * s };
  }, [imgH, imgW, ox, oy, rotateDeg, s]);

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
      const lenM = roofSegmentLengthM(
        { x: dx, y: dy },
        mpp,
        { tiltDeg, fallAzimuthDeg },
      );
      const text = `K${i + 1} · ${formatMeters(lenM)}`;

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
  }, [points, mpp, imgW, imgH, s, edgeOffsetPx, tiltDeg, fallAzimuthDeg, rotateDeg, imgToScreen]);

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
            color,
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
