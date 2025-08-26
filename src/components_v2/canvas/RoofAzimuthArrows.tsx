'use client';

import React, { useMemo } from 'react';
import { Group as KonvaGroup, Arrow as KonvaArrow } from 'react-konva';

type Pt = { x: number; y: number };
type View = { scale?: number; offsetX?: number; offsetY?: number };

// ---------- helpers ----------
function polygonBBox(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function centroid(pts: Pt[]) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  const n = Math.max(pts.length, 1);
  return { x: x / n, y: y / n };
}

function norm(v: { x: number; y: number }) {
  const L = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / L, y: v.y / L };
}

/** Azimut: 0 = Nord (su), 90 = Est (destra) in coordinate immagine (y verso il basso). */
function azimuthToDir(azDeg: number) {
  const r = (azDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) }; // N=(0,-1), E=(1,0), S=(0,1), W=(-1,0)
}

/** Bordo con y-media minima → “gronda più bassa” nell'immagine */
function lowestEdgeAzimuth(pts: Pt[]): number {
  if (pts.length < 2) return 90; // fallback: Est
  let bestI = 0, bestY = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ymid = (a.y + b.y) / 2;
    if (ymid < bestY) { bestY = ymid; bestI = i; }
  }
  const a = pts[bestI], b = pts[(bestI + 1) % pts.length];
  // azimut da bordo in coordinate immagine
  const az = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI; // atan2(dx, -dy)
  return ((az % 360) + 360) % 360;
}

export default function RoofAzimuthArrows({
  points,
  view,
  azimuthDeg,           // opzionale: se assente, stimiamo dal bordo “basso”
  tiltDeg,              // opzionale: se < flatEpsDeg → niente frecce (tetto piano)
  flatEpsDeg = 2,       // soglia “piatto”
  invert = false,       // opzionale: inverti il verso (↺) senza toccare i punti
  color = '#7c3aed',
  opacity = 0.8,
  stepPx = 56,          // spaziatura frecce (px SCHERMO)
  lenPx = 26,           // lunghezza (px SCHERMO)
  headPx = 6,           // punta (px SCHERMO)
}: {
  points: Pt[];
  view: View;
  azimuthDeg?: number;
  tiltDeg?: number;
  flatEpsDeg?: number;
  invert?: boolean;
  color?: string;
  opacity?: number;
  stepPx?: number;
  lenPx?: number;
  headPx?: number;
}) {
  if (!points || points.length < 3) return null;

  // 1) tetto piatto? → non disegniamo frecce
  if (!(typeof tiltDeg === 'number') || tiltDeg < flatEpsDeg) return null;

  const s = view.scale ?? 1;

  const arrows = useMemo(() => {
    const bbox = polygonBBox(points);
    const c = centroid(points);

    const baseAz =
      typeof azimuthDeg === 'number' ? azimuthDeg : lowestEdgeAzimuth(points);
    const effAz = invert ? (baseAz + 180) % 360 : baseAz;
    const d = norm(azimuthToDir(effAz)); // verso di scorrimento frecce

    // distanza “lunga” per coprire il poligono
    const R = Math.hypot(bbox.w, bbox.h) * 0.8;

    // costanti su schermo → converti in px immagine
    const stepImg = stepPx / s;
    const lenImg = lenPx / s;
    const headImg = headPx / s;

    const count = Math.ceil((2 * R) / stepImg);
    const list: {
      points: number[]; // [x1,y1,x2,y2]
      pointerLen: number;
    }[] = [];

    for (let k = -count; k <= count; k++) {
      const baseX = c.x + d.x * (k * stepImg);
      const baseY = c.y + d.y * (k * stepImg);
      const tipX = baseX + d.x * lenImg;
      const tipY = baseY + d.y * lenImg;
      list.push({ points: [baseX, baseY, tipX, tipY], pointerLen: headImg });
    }
    return list;
  }, [points, azimuthDeg, tiltDeg, flatEpsDeg, invert, s, stepPx, lenPx, headPx]);

  return (
    <KonvaGroup
      listening={false}
      opacity={opacity}
      clipFunc={(ctx) => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
      }}
    >
      {arrows.map((a, i) => (
        <KonvaArrow
          key={i}
          points={a.points}
          pointerLength={a.pointerLen}
          pointerWidth={a.pointerLen}
          stroke={color}
          fill={color}
          strokeWidth={1.5 / (view.scale ?? 1)}
        />
      ))}
    </KonvaGroup>
  );
}
